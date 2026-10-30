import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { eq, inArray, sql } from 'drizzle-orm';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createDb, schema } from './db/index.js';
import { missingFields, parseId, pickColumns, registerCrud } from './routes/crud.js';
import { registerInvoiceRoutes } from './routes/invoices.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerScanRoutes } from './routes/scan.js';
import { registerClientLogRoutes } from './routes/clientLog.js';
import { registerStatsRoutes } from './routes/stats.js';
import { registerHaRoutes } from './routes/ha.js';
import { registerCameraRoutes } from './routes/cameras.js';
import { registerStorageRoutes } from './routes/storage.js';
import { registerDocumentRoutes } from './routes/documents.js';
import { registerCostCategoryRoutes } from './routes/costCategories.js';
import { registerBackupRoutes } from './routes/backup.js';
import {
  canonicalManufacturer,
  parseMinStock,
  prepareSpool,
  registerManufacturerRoutes,
} from './routes/manufacturers.js';
import { createHaClient } from './ha/client.js';
import { createWatcher } from './ha/watcher.js';

/** Angaben, die alle Spulen einer Sorte teilen (Restmenge, Lagerort, Notizen bleiben je Spule) */
const SPOOL_VARIETY_FIELDS = new Set([
  'typeId',
  'manufacturer',
  'colorName',
  'colorHex',
  'finishId',
  'diameter',
  'weightTotalG',
  'price',
  'minStockG',
]);

export interface AppOptions {
  /** Pfad zur SQLite-Datei oder ':memory:' für Tests. */
  dbFile: string;
  uploadDir: string;
  /** Gebauter Client, der unter / ausgeliefert wird (nur Produktivbetrieb). */
  clientDir?: string;
  logger?: boolean;
  /** Schlüssel + Zertifikat für HTTPS (sonst HTTP) */
  https?: { key: string; cert: string };
  /** Meldungen vom Browser zusätzlich als JSON-Zeilen in diese Datei schreiben */
  clientLogFile?: string;
  /** Home Assistant alle n ms abfragen (Filament-Abbuchung); ohne Angabe nur auf Anfrage */
  haPollMs?: number;
  /** Ersatz für fetch, damit Tests ein falsches Home Assistant (und Kameras) einhängen können */
  haFetch?: typeof fetch;
  /** Hinter einem Reverse-Proxy (Cloudflare/Authentik): X-Forwarded-*-Header übernehmen */
  trustProxy?: boolean;
  /**
   * Als Home-Assistant-App: Token des Supervisors. Damit gibt es automatisch die Verbindung zum
   * eigenen Home Assistant, und Anfragen werden nur noch über Ingress angenommen.
   */
  supervisorToken?: string;
}

/** Home-Assistant-Ingress-Pfad, wie ihn der Supervisor im Header X-Ingress-Path mitschickt */
const INGRESS_PATH = /^\/api\/hassio_ingress\/[\w-]+$/;

/** Adressen, von denen im App-Betrieb Anfragen kommen dürfen: Ingress-Gateway und Healthcheck */
const INGRESS_ALLOWED = new Set([
  '172.30.32.2',
  '::ffff:172.30.32.2',
  '127.0.0.1',
  '::ffff:127.0.0.1',
  '::1',
]);

/**
 * Unter Ingress liegt die App unter /api/hassio_ingress/<token>/ – das <base href> in index.html
 * zeigt dorthin, alle Adressen im Client sind relativ dazu (siehe client/src/base.ts)
 */
export function withBase(html: string, ingressPath: string | string[] | undefined) {
  const base =
    typeof ingressPath === 'string' && INGRESS_PATH.test(ingressPath) ? `${ingressPath}/` : '/';
  return html.replace('<base href="/" />', `<base href="${base}" />`);
}

export async function buildApp(options: AppOptions) {
  mkdirSync(options.uploadDir, { recursive: true });
  const db = createDb(options.dbFile);
  const logger = options.logger ?? false;
  // Fastify typisiert HTTPS-Instanzen anders; die Routen sind davon unabhängig
  const app = (
    options.https
      ? Fastify({ logger, https: options.https, trustProxy: options.trustProxy })
      : Fastify({ logger, trustProxy: options.trustProxy })
  ) as FastifyInstance;

  // Muss vor den Routen-Plugins stehen, sonst erben diese den Standard-Handler
  app.setErrorHandler<FastifyError>((error, _req, reply) => {
    const code = String(error.code);
    if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return reply.code(409).send({ error: 'Wird noch verwendet und kann nicht gelöscht werden.' });
    }
    if (code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return reply.code(409).send({ error: 'Diesen Eintrag gibt es schon.' });
    }
    const status = error.statusCode ?? (code.startsWith('SQLITE_CONSTRAINT') ? 400 : 500);
    if (status >= 500) app.log.error(error);
    reply.code(status).send({ error: status >= 500 ? 'Interner Fehler' : error.message });
  });

  if (options.supervisorToken) {
    // Die App hat keine eigene Anmeldung: nur über Ingress (HA-Login) erreichbar
    app.addHook('onRequest', async (req, reply) => {
      if (!INGRESS_ALLOWED.has(req.socket.remoteAddress ?? ''))
        return reply.code(403).send({ error: 'Nur über Home Assistant erreichbar.' });
    });
  }

  const ha = createHaClient(db, options.haFetch, options.supervisorToken);
  const watcher = createWatcher(db, ha, app.log);
  if (options.haPollMs) watcher.start(options.haPollMs);
  app.addHook('onClose', async () => {
    watcher.stop();
    // Datei freigeben (unter Windows sonst gesperrt)
    db.$client.close();
  });

  await app.register(fastifyMultipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  await app.register(fastifyStatic, {
    root: options.uploadDir,
    prefix: '/uploads/',
    decorateReply: !options.clientDir,
  });

  await app.register(
    async (api) => {
      // Für den Docker-Healthcheck: prüft auch, dass die Datenbank antwortet
      api.get('/health', () => {
        db.select().from(schema.settings).limit(1).all();
        return { ok: true };
      });
      registerCrud(api, db, '/customers', schema.customers, { required: ['name'] });
      registerCrud(api, db, '/persons', schema.persons, { required: ['name'] });
      // Leere Mindestmenge beim Typ: zurück auf die Vorgabe 200 g
      const typeMinStock = (data: Record<string, unknown>) =>
        'minStockG' in data ? { ...data, minStockG: parseMinStock(data.minStockG) ?? 200 } : data;
      registerCrud(api, db, '/filament-types', schema.filamentTypes, {
        required: ['name'],
        beforeCreate: typeMinStock,
        beforeUpdate: typeMinStock,
      });
      registerManufacturerRoutes(api, db);
      registerCrud(api, db, '/finishes', schema.finishes, { required: ['name'] });
      registerCrud(api, db, '/printers', schema.printers, { required: ['name', 'model'] });
      registerCrud(api, db, '/spools', schema.filamentSpools, {
        required: ['typeId', 'manufacturer', 'colorName'],
        // Die AMS-Zuordnung setzen nur /ams-link und /ams-import – sonst hätte z.B. eine kopierte
        // Spule denselben Slot wie das Original
        beforeCreate: ({ haTrayEntity: _slot, ...data }) => ({
          ...prepareSpool(db, data, true),
          weightRemainingG: data.weightRemainingG ?? data.weightTotalG ?? 1000,
        }),
        beforeUpdate: ({ haTrayEntity: _slot, ...data }) => prepareSpool(db, data, false),
      });

      /** Verbrauch von einer Spule abbuchen (negativ = zurückbuchen). */
      api.post<{ Params: { id: string }; Body: { grams?: number } }>(
        '/spools/:id/consume',
        (req, reply) => {
          const id = parseId(req.params.id);
          const grams = Number(req.body?.grams);
          if (!Number.isFinite(grams)) return reply.code(400).send({ error: 'Gramm fehlen' });
          const spool = db
            .select()
            .from(schema.filamentSpools)
            .where(eq(schema.filamentSpools.id, id))
            .get();
          if (!spool) return reply.code(404).send({ error: 'Nicht gefunden' });
          const remaining = Math.min(
            spool.weightTotalG,
            Math.max(0, spool.weightRemainingG - grams),
          );
          return db
            .update(schema.filamentSpools)
            .set({ weightRemainingG: remaining })
            .where(eq(schema.filamentSpools.id, id))
            .returning()
            .get();
        },
      );

      /**
       * Eine Sorte auf einmal ändern: gemeinsame Angaben (Preis, Farbe, Hersteller …) für mehrere
       * Spulen. Restmenge, Lagerort und Notizen bleiben je Spule.
       */
      api.post<{ Body: { ids?: number[]; data?: Record<string, unknown> } }>(
        '/spools/bulk-update',
        (req, reply) => {
          const ids = [...new Set((req.body?.ids ?? []).map(Number))].filter(Number.isInteger);
          if (!ids.length) return reply.code(400).send({ error: 'Keine Spulen gewählt' });
          const data = Object.fromEntries(
            Object.entries(pickColumns(schema.filamentSpools, req.body?.data)).filter(([key]) =>
              SPOOL_VARIETY_FIELDS.has(key),
            ),
          );
          if (!Object.keys(data).length) return reply.code(400).send({ error: 'Nichts zu ändern' });
          Object.assign(data, prepareSpool(db, data, false));
          const missing = missingFields(data, ['typeId', 'manufacturer', 'colorName']).filter(
            (f) => f in data,
          );
          if (missing.length)
            return reply.code(400).send({ error: `Pflichtfelder fehlen: ${missing.join(', ')}` });
          return db.transaction((tx) => {
            const where = inArray(schema.filamentSpools.id, ids);
            tx.update(schema.filamentSpools).set(data).where(where).run();
            // Kleineres Spulengewicht: Restmenge darf nicht darüber liegen
            tx.update(schema.filamentSpools)
              .set({
                weightRemainingG: sql`min(${schema.filamentSpools.weightRemainingG}, ${schema.filamentSpools.weightTotalG})`,
              })
              .where(where)
              .run();
            return tx.select().from(schema.filamentSpools).where(where).all();
          });
        },
      );

      registerCrud(api, db, '/products', schema.filamentProducts, {
        required: ['barcode', 'typeId', 'manufacturer', 'colorName'],
        beforeCreate: (data) => ({
          ...data,
          manufacturer: canonicalManufacturer(db, data.manufacturer),
        }),
        beforeUpdate: (data) =>
          'manufacturer' in data
            ? { ...data, manufacturer: canonicalManufacturer(db, data.manufacturer) }
            : data,
      });
      registerScanRoutes(api, db);
      registerClientLogRoutes(api, options.clientLogFile);
      registerProjectRoutes(api, db, options.uploadDir);
      registerInvoiceRoutes(api, db, options.uploadDir);
      registerStatsRoutes(api, db);
      registerHaRoutes(api, db, ha);
      registerCameraRoutes(api, db, ha, options.haFetch);
      registerStorageRoutes(api, db);
      registerDocumentRoutes(api, db, options.uploadDir);
      registerCostCategoryRoutes(api, db);
      registerBackupRoutes(api, db, {
        uploadDir: options.uploadDir,
        // Sicherheitskopie vor einem Import neben der Datenbank (data/backup)
        safetyDir:
          options.dbFile === ':memory:'
            ? undefined
            : path.join(path.dirname(options.dbFile), 'backup'),
        supervisorToken: options.supervisorToken,
      });
    },
    { prefix: '/api' },
  );

  if (options.clientDir && existsSync(options.clientDir)) {
    const indexHtml = readFileSync(path.join(options.clientDir, 'index.html'), 'utf8');
    await app.register(fastifyStatic, {
      root: options.clientDir,
      prefix: '/',
      decorateReply: true,
      // index.html nie direkt, sondern immer mit passendem <base href> (sendIndex)
      index: false,
    });
    const sendIndex = (req: FastifyRequest, reply: FastifyReply) =>
      reply
        .header('cache-control', 'no-cache')
        .type('text/html')
        .send(withBase(indexHtml, req.headers['x-ingress-path']));
    app.get('/', sendIndex);
    // SPA: unbekannte Pfade außerhalb von /api liefern index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/uploads')) {
        return reply.code(404).send({ error: 'Nicht gefunden' });
      }
      return sendIndex(req, reply);
    });
  }

  return { app, db, ha, watcher };
}
