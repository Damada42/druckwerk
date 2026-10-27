import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { eq } from 'drizzle-orm';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { existsSync, mkdirSync } from 'node:fs';
import { createDb, schema } from './db/index.js';
import { parseId, registerCrud } from './routes/crud.js';
import { registerInvoiceRoutes } from './routes/invoices.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerScanRoutes } from './routes/scan.js';
import { registerClientLogRoutes } from './routes/clientLog.js';
import { registerStatsRoutes } from './routes/stats.js';
import { registerHaRoutes } from './routes/ha.js';
import { registerCameraRoutes } from './routes/cameras.js';
import { createHaClient } from './ha/client.js';
import { createWatcher } from './ha/watcher.js';

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

  const ha = createHaClient(db, options.haFetch);
  const watcher = createWatcher(db, ha, app.log);
  if (options.haPollMs) watcher.start(options.haPollMs);
  app.addHook('onClose', async () => watcher.stop());

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
      registerCrud(api, db, '/filament-types', schema.filamentTypes, { required: ['name'] });
      registerCrud(api, db, '/finishes', schema.finishes, { required: ['name'] });
      registerCrud(api, db, '/printers', schema.printers, { required: ['name', 'model'] });
      registerCrud(api, db, '/spools', schema.filamentSpools, {
        required: ['typeId', 'manufacturer', 'colorName'],
        beforeCreate: (data) => ({
          ...data,
          weightRemainingG: data.weightRemainingG ?? data.weightTotalG ?? 1000,
        }),
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

      registerCrud(api, db, '/products', schema.filamentProducts, {
        required: ['barcode', 'typeId', 'manufacturer', 'colorName'],
      });
      registerScanRoutes(api, db);
      registerClientLogRoutes(api, options.clientLogFile);
      registerProjectRoutes(api, db, options.uploadDir);
      registerInvoiceRoutes(api, db, options.uploadDir);
      registerStatsRoutes(api, db);
      registerHaRoutes(api, db, ha);
      registerCameraRoutes(api, db, ha, options.haFetch);
    },
    { prefix: '/api' },
  );

  if (options.clientDir && existsSync(options.clientDir)) {
    await app.register(fastifyStatic, {
      root: options.clientDir,
      prefix: '/',
      decorateReply: true,
    });
    // SPA: unbekannte Pfade außerhalb von /api liefern index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/uploads')) {
        return reply.code(404).send({ error: 'Nicht gefunden' });
      }
      return reply.sendFile('index.html');
    });
  }

  return { app, db, ha, watcher };
}
