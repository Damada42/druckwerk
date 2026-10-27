import {
  CAMERA_ROTATIONS,
  maskUrlPassword,
  snapshotFromStream,
  type PrinterCamera,
  type PrinterCameraInput,
} from '@3dapp/shared';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { schema, type Db } from '../db/index.js';
import {
  CAMERA_ENTITY,
  HaError,
  fetchWithTimeout,
  unreachable,
  type HaClient,
} from '../ha/client.js';
import { parseId } from './crud.js';

type Row = typeof schema.printerCameras.$inferSelect;

/** Für den Browser: Passwörter in Adressen ausblenden */
function toCamera(row: Row): PrinterCamera {
  return {
    ...row,
    streamUrl: row.streamUrl && maskUrlPassword(row.streamUrl),
    snapshotUrl: row.snapshotUrl && maskUrlPassword(row.snapshotUrl),
    rotation: row.rotation as PrinterCamera['rotation'],
    hasSnapshot: !!(row.entityId || snapshotUrlOf(row)),
  };
}

const snapshotUrlOf = (row: Row) =>
  row.snapshotUrl ?? (row.streamUrl ? snapshotFromStream(row.streamUrl) : null);

/** Leere Adresse → null; „http://…“ ergänzen; nur http(s) */
function normalizeCameraUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const withScheme = /^[a-z]+:\/\//i.test(value) ? value : `http://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new HaError('Das ist keine gültige Adresse.', 400);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new HaError('Nur http- und https-Adressen (MJPEG) werden unterstützt.', 400);
  return url.toString();
}

/**
 * Neue Adresse aus der Eingabe: nicht mitgeschickt = bisherige behalten; die ausgeblendete
 * Adresse unverändert zurückgeschickt = bisherige (mit Passwort) behalten
 */
function resolveUrl(input: string | null | undefined, current: string | null | undefined) {
  if (input === undefined) return current ?? null;
  if (current && input?.trim() === maskUrlPassword(current)) return current;
  return normalizeCameraUrl(input);
}

/** Zugangsdaten aus der Adresse als Basic-Auth senden – fetch lehnt sie in der URL ab */
function splitCredentials(raw: string): { url: string; headers: Record<string, string> } {
  const url = new URL(raw);
  if (!url.username && !url.password) return { url: raw, headers: {} };
  const auth = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
  url.username = '';
  url.password = '';
  return {
    url: url.toString(),
    headers: { authorization: `Basic ${Buffer.from(auth).toString('base64')}` },
  };
}

export function registerCameraRoutes(
  app: FastifyInstance,
  db: Db,
  ha: HaClient,
  fetchImpl: typeof fetch = fetch,
) {
  const cameraById = (id: string) =>
    db
      .select()
      .from(schema.printerCameras)
      .where(eq(schema.printerCameras.id, parseId(id)))
      .get();

  const camerasOf = (printerId: number) =>
    db
      .select()
      .from(schema.printerCameras)
      .where(eq(schema.printerCameras.printerId, printerId))
      .orderBy(asc(schema.printerCameras.position), asc(schema.printerCameras.id))
      .all();

  /** Eingaben prüfen; current = bisherige Kamera beim Ändern */
  function validate(input: PrinterCameraInput, current?: Row) {
    const name = input.name?.trim() ?? current?.name;
    if (!name) throw new HaError('Bitte einen Namen für die Kamera eintragen.', 400);
    const rotation = input.rotation ?? current?.rotation ?? 0;
    if (!(CAMERA_ROTATIONS as readonly number[]).includes(rotation))
      throw new HaError('Drehung nur in 90°-Schritten.', 400);

    const entityId = input.entityId !== undefined ? input.entityId || null : current?.entityId;
    if (entityId) {
      const haConnectionId = input.haConnectionId ?? current?.haConnectionId;
      if (!CAMERA_ENTITY.test(entityId)) throw new HaError('Ungültige Kamera', 400);
      const conn = haConnectionId
        ? db
            .select()
            .from(schema.haConnections)
            .where(eq(schema.haConnections.id, haConnectionId))
            .get()
        : undefined;
      if (!conn) throw new HaError('Bitte den Home-Assistant-Standort wählen.', 400);
      return {
        name,
        rotation,
        entityId,
        haConnectionId,
        streamUrl: null,
        snapshotUrl: null,
      };
    }

    const streamUrl = resolveUrl(input.streamUrl, current?.streamUrl);
    if (!streamUrl)
      throw new HaError(
        'Bitte eine Kamera aus Home Assistant oder eine Stream-Adresse wählen.',
        400,
      );
    const snapshotUrl = resolveUrl(input.snapshotUrl, current?.snapshotUrl);
    return { name, rotation, entityId: null, haConnectionId: null, streamUrl, snapshotUrl };
  }

  const badRequest = (reply: FastifyReply, e: unknown) => {
    if (!(e instanceof HaError)) throw e;
    return reply.code(e.statusCode).send({ error: e.message });
  };

  /** Kamera-Entities aus allen Home-Assistant-Standorten (zur Auswahl) */
  app.get('/ha/cameras', () => ha.cameras());

  app.get<{ Params: { id: string } }>('/printers/:id/cameras', (req) =>
    camerasOf(parseId(req.params.id)).map(toCamera),
  );

  app.post<{ Params: { id: string }; Body: PrinterCameraInput }>(
    '/printers/:id/cameras',
    (req, reply) => {
      const printerId = parseId(req.params.id);
      const printer = db
        .select()
        .from(schema.printers)
        .where(eq(schema.printers.id, printerId))
        .get();
      if (!printer) return reply.code(404).send({ error: 'Nicht gefunden' });
      try {
        const values = validate(req.body ?? {});
        const last = camerasOf(printerId).at(-1);
        const row = db
          .insert(schema.printerCameras)
          .values({ ...values, printerId, position: (last?.position ?? -1) + 1 })
          .returning()
          .get();
        return reply.code(201).send(toCamera(row));
      } catch (e) {
        return badRequest(reply, e);
      }
    },
  );

  app.put<{ Params: { id: string }; Body: PrinterCameraInput }>('/cameras/:id', (req, reply) => {
    const current = cameraById(req.params.id);
    if (!current) return reply.code(404).send({ error: 'Nicht gefunden' });
    try {
      const row = db
        .update(schema.printerCameras)
        .set(validate(req.body ?? {}, current))
        .where(eq(schema.printerCameras.id, current.id))
        .returning()
        .get();
      return toCamera(row);
    } catch (e) {
      return badRequest(reply, e);
    }
  });

  app.delete<{ Params: { id: string } }>('/cameras/:id', (req, reply) => {
    const current = cameraById(req.params.id);
    if (!current) return reply.code(404).send({ error: 'Nicht gefunden' });
    db.delete(schema.printerCameras).where(eq(schema.printerCameras.id, current.id)).run();
    return reply.code(204).send();
  });

  /** Reihenfolge der Kameras eines Druckers setzen (die erste wird groß gezeigt) */
  app.put<{ Params: { id: string }; Body: { ids?: number[] } }>(
    '/printers/:id/cameras/order',
    (req, reply) => {
      const printerId = parseId(req.params.id);
      const ids = req.body?.ids ?? [];
      const own = new Set(camerasOf(printerId).map((c) => c.id));
      if (ids.length !== own.size || ids.some((id) => !own.has(id)))
        return reply
          .code(400)
          .send({ error: 'Die Liste passt nicht zu den Kameras des Druckers.' });
      db.transaction((tx) =>
        ids.forEach((id, position) =>
          tx
            .update(schema.printerCameras)
            .set({ position })
            .where(eq(schema.printerCameras.id, id))
            .run(),
        ),
      );
      return reply.code(204).send();
    },
  );

  /**
   * Bild der Kamera durchreichen: stream = MJPEG (läuft, bis der Browser die Verbindung
   * schließt), snapshot = ein Standbild. So braucht der Browser weder Token noch interne Adressen.
   */
  const imageRoute =
    (kind: 'snapshot' | 'stream') =>
    async (req: { params: { id: string } }, reply: FastifyReply) => {
      const camera = cameraById(req.params.id);
      if (!camera) return reply.code(404).send({ error: 'Nicht gefunden' });
      const abort = new AbortController();
      // Browser weg (Seite verlassen, Kamera gewechselt): Abruf bei der Kamera beenden
      reply.raw.on('close', () => abort.abort());
      let res: Response;
      try {
        if (camera.entityId && camera.haConnectionId) {
          res = await ha.camera(camera.haConnectionId, camera.entityId, kind, abort.signal);
        } else {
          const url = kind === 'stream' ? camera.streamUrl : snapshotUrlOf(camera);
          if (!url) return reply.code(404).send({ error: 'Kein Standbild' });
          const target = splitCredentials(url);
          try {
            res = await fetchWithTimeout(
              fetchImpl,
              target.url,
              { headers: target.headers },
              abort.signal,
            );
          } catch (e) {
            throw new HaError(`Kamera „${camera.name}“ ${unreachable(e)}.`);
          }
          if (!res.ok) throw new HaError(`Kamera „${camera.name}“ meldet Fehler ${res.status}.`);
        }
      } catch (e) {
        if (!(e instanceof HaError)) throw e;
        return reply.code(e.statusCode === 400 ? 400 : 502).send({ error: e.message });
      }
      if (!res.body) return reply.code(502).send({ error: 'Kein Bild' });
      return reply
        .header('cache-control', 'no-store')
        .type(res.headers.get('content-type') ?? 'image/jpeg')
        .send(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>));
    };
  app.get<{ Params: { id: string } }>('/cameras/:id/stream', imageRoute('stream'));
  app.get<{ Params: { id: string } }>('/cameras/:id/snapshot', imageRoute('snapshot'));
}
