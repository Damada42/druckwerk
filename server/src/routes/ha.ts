import {
  PRINTER_ACTIONS,
  PRINT_SPEEDS,
  type PrintSpeed,
  colorNameFromHex,
  parseSpoolLabel,
  parsePrinterLive,
  printerRoles,
  type HaStatus,
  type PrinterAction,
  type PrinterLiveResponse,
} from '@3dapp/shared';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { schema, type Db } from '../db/index.js';
import { HaError, spoolInSlot, type HaClient } from '../ha/client.js';
import { parseId } from './crud.js';
import { prepareSpool } from './manufacturers.js';

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

  /** Alle Verbindungen mit Stand und gefundenen Bambu-Druckern (für Einstellungen und Auswahl) */
  app.get('/ha/status', (): Promise<HaStatus> => ha.status());

  type ConnectionBody = { Body: { name?: string; url?: string; token?: string } };
  // Verbindungsfehler sind aus Sicht der Einstellungen Eingabefehler (falsche Adresse/Token)
  const inputError = (e: unknown) => {
    const err = fail(e);
    return { code: err.statusCode === 502 ? 400 : err.statusCode, error: err.message };
  };

  app.post<ConnectionBody>('/ha/connections', async (req, reply) => {
    try {
      const conn = await ha.add(req.body ?? {});
      return reply.code(201).send({ id: conn.id });
    } catch (e) {
      const { code, error } = inputError(e);
      return reply.code(code).send({ error });
    }
  });

  app.put<ConnectionBody & { Params: { id: string } }>(
    '/ha/connections/:id',
    async (req, reply) => {
      try {
        await ha.update(parseId(req.params.id), req.body ?? {});
        return reply.code(204).send();
      } catch (e) {
        const { code, error } = inputError(e);
        return reply.code(code).send({ error });
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/ha/connections/:id', (req, reply) => {
    try {
      ha.remove(parseId(req.params.id));
      return reply.code(204).send();
    } catch (e) {
      const err = fail(e);
      return reply.code(err.statusCode).send({ error: err.message });
    }
  });

  app.get<{ Params: { id: string } }>(
    '/printers/:id/live',
    async (req, reply): Promise<PrinterLiveResponse | void> => {
      const printer = printerById(req.params.id);
      if (!printer) return reply.code(404).send({ error: 'Nicht gefunden' });
      if (!ha.configured()) return { status: 'unconfigured' };
      if (!printer.haDeviceId) return { status: 'unlinked' };
      try {
        const { entities, errors } = await ha.entities();
        if (!entities.some((e) => e.deviceId === printer.haDeviceId)) {
          return {
            status: 'error',
            // Steht der Drucker an einem gerade nicht erreichbaren Standort, das melden
            error: errors.length
              ? errors.map((e) => e.message).join(' ')
              : 'Das verknüpfte Gerät gibt es in Home Assistant nicht mehr – bitte neu wählen.',
          };
        }
        return { status: 'ok', live: parsePrinterLive(entities, printer.haDeviceId) };
      } catch (e) {
        return { status: 'error', error: fail(e).message };
      }
    },
  );

  /**
   * Bilder des Auftrags über den Server, damit der Browser keinen Token braucht:
   * cover = Vorschaubild, plate = Druckplatte mit markierten Teilen (zum Überspringen)
   */
  const imageRoute =
    (role: 'cover' | 'plate') =>
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const printer = printerById(req.params.id);
      if (!printer?.haDeviceId) return reply.code(404).send({ error: 'Nicht gefunden' });
      try {
        const { entities } = await ha.entities();
        const entityId = printerRoles(entities, printer.haDeviceId)[role];
        const picture = entities.find((e) => e.entityId === entityId)?.attributes.entity_picture;
        if (typeof picture !== 'string') return reply.code(404).send({ error: 'Kein Bild' });
        const image = await ha.image(printer.haDeviceId, picture);
        return reply
          .header('cache-control', 'private, max-age=3600')
          .type(image.type)
          .send(image.body);
      } catch (e) {
        return reply.code(502).send({ error: fail(e).message });
      }
    };
  app.get('/printers/:id/cover', imageRoute('cover'));
  app.get('/printers/:id/plate', imageRoute('plate'));

  app.post<{ Params: { id: string }; Body: { action?: PrinterAction } }>(
    '/printers/:id/control',
    async (req, reply) => {
      const action = req.body?.action;
      if (!action || !PRINTER_ACTIONS.includes(action))
        return reply.code(400).send({ error: 'Unbekannte Aktion' });
      const printer = printerById(req.params.id);
      if (!printer?.haDeviceId) return reply.code(404).send({ error: 'Drucker nicht verknüpft' });
      try {
        const roles = printerRoles((await ha.entities()).entities, printer.haDeviceId);
        const [domain, service, entityId] =
          action === 'light_on' || action === 'light_off'
            ? ['light', action === 'light_on' ? 'turn_on' : 'turn_off', roles.light]
            : ['button', 'press', roles[action]];
        if (!entityId)
          return reply.code(400).send({ error: 'Dieser Drucker bietet die Aktion nicht an.' });
        await ha.callService(printer.haDeviceId, domain, service, { entity_id: entityId });
        return reply.code(204).send();
      } catch (e) {
        return reply.code(502).send({ error: fail(e).message });
      }
    },
  );

  /**
   * Geschwindigkeit während des Drucks ändern: Bambu-Stufe (speed) oder Klipper-Faktor in %
   * (percent, 10–200)
   */
  app.post<{ Params: { id: string }; Body: { speed?: PrintSpeed; percent?: number } }>(
    '/printers/:id/speed',
    async (req, reply) => {
      const speed = req.body?.speed;
      const percent = req.body?.percent;
      if (percent !== undefined) {
        if (
          typeof percent !== 'number' ||
          !Number.isFinite(percent) ||
          percent < 10 ||
          percent > 200
        )
          return reply.code(400).send({ error: 'Geschwindigkeit bitte zwischen 10 und 200 %' });
      } else if (!speed || !PRINT_SPEEDS.includes(speed))
        return reply.code(400).send({ error: 'Unbekannte Geschwindigkeit' });
      const printer = printerById(req.params.id);
      if (!printer?.haDeviceId) return reply.code(404).send({ error: 'Drucker nicht verknüpft' });
      try {
        const { entities } = await ha.entities({ fresh: true });
        const live = parsePrinterLive(entities, printer.haDeviceId);
        if (!live.canSetSpeed)
          return reply
            .code(409)
            .send({ error: 'Die Geschwindigkeit lässt sich nur während eines Drucks ändern.' });
        if ((live.kind === 'klipper') !== (percent !== undefined))
          return reply.code(400).send({
            error:
              live.kind === 'klipper'
                ? 'Bei Klipper-Druckern die Geschwindigkeit in % angeben.'
                : 'Bei Bambu-Druckern eine Geschwindigkeitsstufe wählen.',
          });
        const entityId = printerRoles(entities, printer.haDeviceId).speed!;
        if (percent !== undefined)
          await ha.callService(printer.haDeviceId, 'number', 'set_value', {
            entity_id: entityId,
            value: Math.round(percent),
          });
        else
          await ha.callService(printer.haDeviceId, 'select', 'select_option', {
            entity_id: entityId,
            option: speed,
          });
        return reply.code(204).send();
      } catch (e) {
        return reply.code(502).send({ error: fail(e).message });
      }
    },
  );

  /** Einzelne Teile des laufenden Auftrags überspringen; mindestens ein Teil muss bleiben */
  app.post<{ Params: { id: string }; Body: { objects?: string[] } }>(
    '/printers/:id/skip',
    async (req, reply) => {
      const ids = [...new Set((req.body?.objects ?? []).map(String))];
      if (!ids.length) return reply.code(400).send({ error: 'Keine Teile gewählt' });
      const printer = printerById(req.params.id);
      if (!printer?.haDeviceId) return reply.code(404).send({ error: 'Drucker nicht verknüpft' });
      try {
        const live = parsePrinterLive(
          (await ha.entities({ fresh: true })).entities,
          printer.haDeviceId,
        );
        if (!live.canSkip)
          return reply
            .code(409)
            .send({ error: 'Teile lassen sich nur während eines Drucks überspringen.' });
        const open = live.objects.filter((o) => !o.skipped);
        if (ids.some((id) => !open.some((o) => o.id === id)))
          return reply.code(400).send({ error: 'Dieses Teil gibt es im Auftrag nicht (mehr).' });
        if (ids.length >= open.length)
          return reply.code(400).send({
            error:
              'Mindestens ein Teil muss weitergedruckt werden – sonst bitte den Druck abbrechen.',
          });
        await ha.callService(printer.haDeviceId, 'bambu_lab', 'skip_objects', {
          device_id: printer.haDeviceId,
          objects: ids.join(','),
        });
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
        slot = parsePrinterLive((await ha.entities()).entities, printer.haDeviceId).ams.find(
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
          .values(
            prepareSpool(
              db,
              {
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
              },
              true,
            ) as typeof schema.filamentSpools.$inferInsert,
          )
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
