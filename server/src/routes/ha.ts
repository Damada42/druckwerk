import {
  PRINTER_ACTIONS,
  colorNameFromHex,
  findPrinterDevices,
  parseSpoolLabel,
  parsePrinterLive,
  printerRoles,
  type HaStatus,
  type PrinterAction,
  type PrinterLiveResponse,
} from '@3dapp/shared';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { schema, type Db } from '../db/index.js';
import { HaError, spoolInSlot, type HaClient } from '../ha/client.js';
import { parseId } from './crud.js';

export function registerHaRoutes(app: FastifyInstance, db: Db, ha: HaClient) {
  const printerById = (id: string) =>
    db
      .select()
      .from(schema.printers)
      .where(eq(schema.printers.id, parseId(id)))
      .get();

  const fail = (e: unknown) => {
    if (e instanceof HaError) return e;
    throw e;
  };

  /** Verbindungsstand plus die gefundenen Bambu-Drucker (für die Auswahl beim Drucker) */
  app.get('/ha/status', async (): Promise<HaStatus> => {
    const settings = ha.settings();
    if (!ha.configured()) return { ...settings, ok: false, printers: [] };
    try {
      const [version, entities] = await Promise.all([ha.check(), ha.entities()]);
      return { ...settings, ok: true, version, printers: findPrinterDevices(entities) };
    } catch (e) {
      return { ...settings, ok: false, error: fail(e).message, printers: [] };
    }
  });

  app.put<{ Body: { url?: string; token?: string } }>('/ha/settings', async (req, reply) => {
    if (!req.body?.url?.trim())
      return reply.code(400).send({ error: 'Bitte die Adresse eintragen.' });
    try {
      await ha.save(req.body.url, req.body.token);
    } catch (e) {
      const err = fail(e);
      // Verbindungsfehler sind Eingabefehler aus Sicht der Einstellungen
      return reply.code(err.statusCode === 502 ? 400 : err.statusCode).send({ error: err.message });
    }
    return ha.settings();
  });

  app.delete('/ha/settings', (_req, reply) => {
    ha.clear();
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>(
    '/printers/:id/live',
    async (req, reply): Promise<PrinterLiveResponse | void> => {
      const printer = printerById(req.params.id);
      if (!printer) return reply.code(404).send({ error: 'Nicht gefunden' });
      if (!ha.configured()) return { status: 'unconfigured' };
      if (!printer.haDeviceId) return { status: 'unlinked' };
      try {
        const entities = await ha.entities();
        if (!entities.some((e) => e.deviceId === printer.haDeviceId)) {
          return {
            status: 'error',
            error: 'Das verknüpfte Gerät gibt es in Home Assistant nicht mehr – bitte neu wählen.',
          };
        }
        return { status: 'ok', live: parsePrinterLive(entities, printer.haDeviceId) };
      } catch (e) {
        return { status: 'error', error: fail(e).message };
      }
    },
  );

  /** Vorschaubild des Auftrags, über den Server, damit der Browser keinen Token braucht */
  app.get<{ Params: { id: string } }>('/printers/:id/cover', async (req, reply) => {
    const printer = printerById(req.params.id);
    if (!printer?.haDeviceId) return reply.code(404).send({ error: 'Nicht gefunden' });
    try {
      const entities = await ha.entities();
      const cover = printerRoles(entities, printer.haDeviceId).cover;
      const picture = entities.find((e) => e.entityId === cover)?.attributes.entity_picture;
      if (typeof picture !== 'string') return reply.code(404).send({ error: 'Kein Vorschaubild' });
      const image = await ha.image(picture);
      return reply
        .header('cache-control', 'private, max-age=3600')
        .type(image.type)
        .send(image.body);
    } catch (e) {
      return reply.code(502).send({ error: fail(e).message });
    }
  });

  app.post<{ Params: { id: string }; Body: { action?: PrinterAction } }>(
    '/printers/:id/control',
    async (req, reply) => {
      const action = req.body?.action;
      if (!action || !PRINTER_ACTIONS.includes(action))
        return reply.code(400).send({ error: 'Unbekannte Aktion' });
      const printer = printerById(req.params.id);
      if (!printer?.haDeviceId) return reply.code(404).send({ error: 'Drucker nicht verknüpft' });
      try {
        const roles = printerRoles(await ha.entities(), printer.haDeviceId);
        const [domain, service, entityId] =
          action === 'light_on' || action === 'light_off'
            ? ['light', action === 'light_on' ? 'turn_on' : 'turn_off', roles.light]
            : ['button', 'press', roles[action]];
        if (!entityId)
          return reply.code(400).send({ error: 'Dieser Drucker bietet die Aktion nicht an.' });
        await ha.callService(domain, service, entityId);
        return reply.code(204).send();
      } catch (e) {
        return reply.code(502).send({ error: fail(e).message });
      }
    },
  );

  /** Spule einem AMS-Slot zuordnen (vorherige Spule dort wird gelöst); spoolId null = leeren */
  app.post<{ Body: { entityId?: string; spoolId?: number | null } }>('/ams-link', (req, reply) => {
    const entityId = req.body?.entityId;
    if (!entityId) return reply.code(400).send({ error: 'Slot fehlt' });
    const spoolId = req.body.spoolId ?? null;
    db.transaction((tx) => {
      tx.update(schema.filamentSpools)
        .set({ haTrayEntity: null })
        .where(eq(schema.filamentSpools.haTrayEntity, entityId))
        .run();
      if (spoolId !== null) {
        tx.update(schema.filamentSpools)
          .set({ haTrayEntity: entityId })
          .where(eq(schema.filamentSpools.id, spoolId))
          .run();
      }
    });
    return reply.code(204).send();
  });

  /**
   * Spule aus einem AMS-Slot in den Bestand übernehmen und dem Slot zuordnen. Die Daten kommen
   * direkt aus Home Assistant: Hersteller/Typ/Finish aus dem Namen, Farbname aus dem Farbwert,
   * Restmenge aus Rest-% × Spulengewicht.
   */
  app.post<{ Body: { printerId?: number; entityId?: string } }>(
    '/ams-import',
    async (req, reply) => {
      const { printerId, entityId } = req.body ?? {};
      if (!printerId || !entityId)
        return reply.code(400).send({ error: 'Drucker oder Slot fehlt' });
      const printer = printerById(String(printerId));
      if (!printer?.haDeviceId) return reply.code(404).send({ error: 'Drucker nicht verknüpft' });
      if (spoolInSlot(db, entityId))
        return reply.code(409).send({ error: 'Diesem Slot ist schon eine Spule zugeordnet.' });

      let slot;
      try {
        slot = parsePrinterLive(await ha.entities(), printer.haDeviceId).ams.find(
          (s) => s.entityId === entityId,
        );
      } catch (e) {
        return reply.code(502).send({ error: fail(e).message });
      }
      if (!slot || slot.empty || !slot.type)
        return reply.code(400).send({ error: 'In diesem Slot steckt keine erkennbare Spule.' });

      const types = db.select().from(schema.filamentTypes).all();
      const finishes = db.select().from(schema.finishes).all();
      const guess = parseSpoolLabel(`${slot.name ?? ''} ${slot.type}`, {
        types: types.map((t) => t.name),
        finishes: finishes.map((f) => f.name),
      });
      const typeName = guess.typeName ?? slot.type;
      const typeId =
        types.find((t) => t.name.toLowerCase() === typeName.toLowerCase())?.id ??
        db.insert(schema.filamentTypes).values({ name: typeName }).returning().get().id;
      // Bambu „Basic“ ist das normale Finish
      const finishName = guess.finishName ?? 'Normal';
      const total = slot.weightG ?? 1000;

      const spool = db.transaction((tx) => {
        tx.update(schema.filamentSpools)
          .set({ haTrayEntity: null })
          .where(eq(schema.filamentSpools.haTrayEntity, entityId))
          .run();
        return tx
          .insert(schema.filamentSpools)
          .values({
            typeId,
            manufacturer: guess.manufacturer ?? slot.name?.split(' ')[0] ?? 'Unbekannt',
            colorName: colorNameFromHex(slot.color) ?? 'Unbekannt',
            colorHex: slot.color ?? '#cccccc',
            finishId: finishes.find((f) => f.name === finishName)?.id ?? null,
            weightTotalG: total,
            weightRemainingG:
              slot.remain === null ? total : Math.round((total * slot.remain) / 100),
            haTrayEntity: entityId,
            notes: `Aus AMS ${slot.label} übernommen (${slot.name ?? slot.type})`,
          })
          .returning()
          .get();
      });
      return reply.code(201).send(spool);
    },
  );

  app.get<{ Querystring: { printerId?: string } }>('/bookings', (req) => {
    const query = db.select().from(schema.filamentBookings);
    return (
      req.query.printerId
        ? query.where(eq(schema.filamentBookings.printerId, parseId(req.query.printerId)))
        : query
    )
      .orderBy(desc(schema.filamentBookings.id))
      .limit(20)
      .all();
  });

  /** Abbuchung rückgängig machen: Gramm zurück auf die Spule */
  app.delete<{ Params: { id: string } }>('/bookings/:id', (req, reply) => {
    const id = parseId(req.params.id);
    const done = db.transaction((tx) => {
      const booking = tx
        .select()
        .from(schema.filamentBookings)
        .where(eq(schema.filamentBookings.id, id))
        .get();
      if (!booking) return false;
      const spool = tx
        .select()
        .from(schema.filamentSpools)
        .where(eq(schema.filamentSpools.id, booking.spoolId))
        .get();
      if (spool) {
        tx.update(schema.filamentSpools)
          .set({
            weightRemainingG: Math.min(spool.weightTotalG, spool.weightRemainingG + booking.grams),
          })
          .where(eq(schema.filamentSpools.id, spool.id))
          .run();
      }
      tx.delete(schema.filamentBookings).where(eq(schema.filamentBookings.id, id)).run();
      return true;
    });
    return done ? reply.code(204).send() : reply.code(404).send({ error: 'Nicht gefunden' });
  });
}
