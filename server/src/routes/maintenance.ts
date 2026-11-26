import {
  MAINTENANCE_KINDS,
  SAMPLE_MESSAGE_VARS,
  isoDate,
  partLabel,
  renderMessage,
  taskStatus,
  type MaintenanceDoneResult,
  type MaintenanceLogItem,
  type MaintenanceTemplateItem,
} from '@3dapp/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { schema, type Db } from '../db/index.js';
import type { HaClient } from '../ha/client.js';
import { readTargets, sendToAll } from '../ha/maintenance.js';
import { canonicalManufacturer } from './manufacturers.js';
import { categoryForName, checkCategoryId } from './partCategories.js';
import { parseId, pickColumns } from './crud.js';
import { readSettings } from './storage.js';

const { printers, spareParts, sparePartModels, printerModels, maintenanceTasks, maintenanceLog } =
  schema;

const badRequest = (message: string) => Object.assign(new Error(message), { statusCode: 400 });

/** Zahl ≥ 0 (Komma erlaubt); leer = null */
function optionalNumber(raw: unknown, label: string, { positive = false, integer = false } = {}) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || (positive && n === 0) || (integer && !Number.isInteger(n)))
    throw badRequest(
      `${label} muss eine ${integer ? 'ganze ' : ''}Zahl ${positive ? 'über' : 'ab'} 0 sein.`,
    );
  return n;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Hersteller und Mengen eines Ersatzteils prüfen */
function preparePart(db: Db, data: Record<string, unknown>) {
  const result = { ...data };
  if (typeof result.name === 'string') result.name = result.name.trim();
  if ('name' in result && !result.name) throw badRequest('Bitte einen Namen eintragen.');
  if ('variant' in result) result.variant = String(result.variant ?? '').trim() || null;
  if ('manufacturer' in result)
    result.manufacturer = canonicalManufacturer(db, result.manufacturer) || null;
  for (const [key, label] of [
    ['stockQty', 'Der Lagerbestand'],
    ['minStock', 'Der Mindestbestand'],
  ] as const)
    if (key in result) result[key] = optionalNumber(result[key], label, { integer: true }) ?? 0;
  if ('price' in result) result.price = optionalNumber(result.price, 'Der Preis');
  if ('categoryId' in result) result.categoryId = checkCategoryId(db, result.categoryId);
  if (typeof result.shopUrl === 'string') {
    const url = result.shopUrl.trim();
    if (url && !/^https?:\/\//i.test(url))
      throw badRequest('Der Shop-Link muss mit http:// oder https:// beginnen.');
    result.shopUrl = url || null;
  }
  return result;
}

/** Felder eines Wartungspunkts prüfen; current = bisheriger Stand (beim Ändern) */
function prepareTask(
  data: Record<string, unknown>,
  current?: typeof maintenanceTasks.$inferSelect,
) {
  const result = { ...data };
  delete result.baseHours;
  delete result.notifiedLevel;
  delete result.notifiedAt;
  delete result.printerId;
  if (typeof result.name === 'string') result.name = result.name.trim();
  if ('name' in result && !result.name) throw badRequest('Bitte einen Namen eintragen.');
  if ('kind' in result && !(MAINTENANCE_KINDS as readonly unknown[]).includes(result.kind))
    throw badRequest('Unbekannte Art der Wartung.');
  if ('intervalHours' in result)
    result.intervalHours = optionalNumber(result.intervalHours, 'Das Intervall', {
      positive: true,
    });
  if ('intervalMonths' in result)
    result.intervalMonths = optionalNumber(result.intervalMonths, 'Das Intervall', {
      positive: true,
    });
  if ('warnHours' in result) result.warnHours = optionalNumber(result.warnHours, 'Die Vorwarnung');
  if ('partQty' in result)
    result.partQty =
      optionalNumber(result.partQty, 'Die Stückzahl', { positive: true, integer: true }) ?? 1;
  if ('lastDoneAt' in result && result.lastDoneAt !== null && !DATE.test(String(result.lastDoneAt)))
    throw badRequest('Ungültiges Datum.');
  const hours = 'intervalHours' in result ? result.intervalHours : current?.intervalHours;
  const months = 'intervalMonths' in result ? result.intervalMonths : current?.intervalMonths;
  if (!hours && !months)
    throw badRequest('Bitte ein Intervall in Betriebsstunden oder Monaten eintragen.');
  return result;
}

/** Stand des Zählers („aktuelle Stunden“) → baseHours beim Betriebsstundenstand des Druckers */
function baseFor(printerHours: number, raw: unknown) {
  const current = optionalNumber(raw, 'Der aktuelle Stand') ?? 0;
  return Math.round((printerHours - current) * 100) / 100;
}

/** Ersatzteile, Wartungspunkte, erledigte Wartungen und die Push-Nachricht dazu */
export function registerMaintenanceRoutes(app: FastifyInstance, db: Db, ha: HaClient) {
  const printerById = (id: number) => db.select().from(printers).where(eq(printers.id, id)).get();

  /** Teile mit den IDs der passenden Druckermodelle */
  const withModels = (rows: (typeof spareParts.$inferSelect)[]) => {
    const links = rows.length
      ? db
          .select()
          .from(sparePartModels)
          .where(
            inArray(
              sparePartModels.partId,
              rows.map((r) => r.id),
            ),
          )
          .all()
      : [];
    return rows.map((r) => ({
      ...r,
      modelIds: links.filter((l) => l.partId === r.id).map((l) => l.modelId),
    }));
  };
  const partById = (id: number) =>
    withModels(db.select().from(spareParts).where(eq(spareParts.id, id)).all())[0];

  /** Zuordnung zu Druckermodellen ersetzen; unbekannte Modelle → 400 */
  function setModels(tx: Db, partId: number, raw: unknown) {
    if (raw === undefined) return;
    if (!Array.isArray(raw) || !raw.every((id) => Number.isInteger(id)))
      throw badRequest('Ungültige Druckermodelle.');
    const ids = [...new Set(raw as number[])];
    if (ids.length) {
      const known = tx
        .select({ id: printerModels.id })
        .from(printerModels)
        .where(inArray(printerModels.id, ids))
        .all();
      if (known.length !== ids.length) throw badRequest('Unbekanntes Druckermodell.');
    }
    tx.delete(sparePartModels).where(eq(sparePartModels.partId, partId)).run();
    if (ids.length)
      tx.insert(sparePartModels)
        .values(ids.map((modelId) => ({ partId, modelId })))
        .run();
  }

  app.get('/spare-parts', () =>
    withModels(db.select().from(spareParts).orderBy(spareParts.id).all()),
  );

  app.get<{ Params: { id: string } }>('/spare-parts/:id', (req, reply) => {
    return partById(parseId(req.params.id)) ?? reply.code(404).send({ error: 'Nicht gefunden' });
  });

  app.post<{ Body: Record<string, unknown> }>('/spare-parts', (req, reply) => {
    const data = preparePart(db, pickColumns(spareParts, req.body));
    if (!data.name) return reply.code(400).send({ error: 'Bitte einen Namen eintragen.' });
    // Ohne Angabe: Kategorie aus dem Namen
    if (!('categoryId' in (req.body ?? {})))
      data.categoryId = categoryForName(db, String(data.name));
    const id = db.transaction((tx) => {
      const row = tx
        .insert(spareParts)
        .values(data as typeof spareParts.$inferInsert)
        .returning()
        .get();
      setModels(tx as unknown as Db, row.id, req.body?.modelIds);
      return row.id;
    });
    return reply.code(201).send(partById(id));
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/spare-parts/:id',
    (req, reply) => {
      const id = parseId(req.params.id);
      if (!partById(id)) return reply.code(404).send({ error: 'Nicht gefunden' });
      const data = preparePart(db, pickColumns(spareParts, req.body));
      db.transaction((tx) => {
        if (Object.keys(data).length)
          tx.update(spareParts).set(data).where(eq(spareParts.id, id)).run();
        setModels(tx as unknown as Db, id, req.body?.modelIds);
      });
      return partById(id);
    },
  );

  app.delete<{ Params: { id: string } }>('/spare-parts/:id', (req, reply) => {
    const result = db
      .delete(spareParts)
      .where(eq(spareParts.id, parseId(req.params.id)))
      .run();
    return result.changes
      ? reply.code(204).send()
      : reply.code(404).send({ error: 'Nicht gefunden' });
  });

  /** Lagerbestand um delta Stück ändern (nie unter 0) */
  app.post<{ Params: { id: string }; Body: { delta?: number } }>(
    '/spare-parts/:id/stock',
    (req, reply) => {
      const delta = Number(req.body?.delta);
      if (!Number.isInteger(delta)) return reply.code(400).send({ error: 'Anzahl fehlt' });
      const row = db
        .update(spareParts)
        .set({ stockQty: sql`max(0, ${spareParts.stockQty} + ${delta})` })
        .where(eq(spareParts.id, parseId(req.params.id)))
        .returning()
        .get();
      return row ? partById(row.id) : reply.code(404).send({ error: 'Nicht gefunden' });
    },
  );

  app.get('/maintenance-tasks', () =>
    db
      .select()
      .from(maintenanceTasks)
      .orderBy(
        asc(maintenanceTasks.printerId),
        asc(maintenanceTasks.position),
        asc(maintenanceTasks.id),
      )
      .all(),
  );

  /** Neuer Punkt: Zähler startet bei currentHours (Standard 0), Datum bei lastDoneAt (Standard heute) */
  function createTask(
    tx: Db,
    printer: typeof printers.$inferSelect,
    body: Record<string, unknown>,
  ) {
    const data = prepareTask(pickColumns(maintenanceTasks, body));
    if (!data.name) throw badRequest('Bitte einen Namen eintragen.');
    const position = tx
      .select({ max: sql<number>`coalesce(max(${maintenanceTasks.position}), -1)` })
      .from(maintenanceTasks)
      .where(eq(maintenanceTasks.printerId, printer.id))
      .get()!.max;
    return tx
      .insert(maintenanceTasks)
      .values({
        ...(data as object),
        name: data.name as string,
        printerId: printer.id,
        baseHours: baseFor(printer.operatingHours, body.currentHours),
        lastDoneAt: (data.lastDoneAt as string | null | undefined) ?? isoDate(new Date()),
        position: position + 1,
      })
      .returning()
      .get();
  }

  app.post<{ Body: Record<string, unknown> }>('/maintenance-tasks', (req, reply) => {
    const printer = printerById(Number(req.body?.printerId));
    if (!printer) return reply.code(400).send({ error: 'Bitte einen Drucker wählen.' });
    return reply.code(201).send(createTask(db, printer, req.body ?? {}));
  });

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/maintenance-tasks/:id',
    (req, reply) => {
      const id = parseId(req.params.id);
      const current = db.select().from(maintenanceTasks).where(eq(maintenanceTasks.id, id)).get();
      if (!current) return reply.code(404).send({ error: 'Nicht gefunden' });
      const data = prepareTask(pickColumns(maintenanceTasks, req.body), current);
      if (req.body?.currentHours !== undefined)
        data.baseHours = baseFor(
          printerById(current.printerId)!.operatingHours,
          req.body.currentHours,
        );
      // Geänderter Punkt: Benachrichtigung neu bewerten
      data.notifiedLevel = null;
      data.notifiedAt = null;
      return db
        .update(maintenanceTasks)
        .set(data)
        .where(eq(maintenanceTasks.id, id))
        .returning()
        .get();
    },
  );

  app.delete<{ Params: { id: string } }>('/maintenance-tasks/:id', (req, reply) => {
    const result = db
      .delete(maintenanceTasks)
      .where(eq(maintenanceTasks.id, parseId(req.params.id)))
      .run();
    return result.changes
      ? reply.code(204).send()
      : reply.code(404).send({ error: 'Nicht gefunden' });
  });

  /**
   * Mehrere Punkte auf einmal anlegen (Vorlage): benötigte Teile werden per Name und Hersteller
   * wiederverwendet oder neu angelegt
   */
  app.post<{ Params: { id: string }; Body: { items?: MaintenanceTemplateItem[] } }>(
    '/printers/:id/maintenance-tasks',
    (req, reply) => {
      const printer = printerById(parseId(req.params.id));
      if (!printer) return reply.code(404).send({ error: 'Nicht gefunden' });
      const items = req.body?.items ?? [];
      if (!Array.isArray(items) || !items.length)
        return reply.code(400).send({ error: 'Keine Wartungspunkte gewählt.' });
      return reply.code(201).send(
        db.transaction((tx) =>
          items.map((item) => {
            let partId: number | null = null;
            if (item.part?.name) {
              const manufacturer = canonicalManufacturer(
                tx as unknown as Db,
                item.part.manufacturer,
              );
              const existing = tx
                .select()
                .from(spareParts)
                .where(
                  and(
                    sql`lower(${spareParts.name}) = lower(${item.part.name})`,
                    // Vorlagen meinen das Standardteil, keine besondere Ausführung
                    isNull(spareParts.variant),
                    sql`lower(coalesce(${spareParts.manufacturer}, '')) = lower(${manufacturer})`,
                  ),
                )
                .get();
              partId =
                existing?.id ??
                tx
                  .insert(spareParts)
                  .values({
                    name: item.part.name,
                    manufacturer: manufacturer || null,
                    shopUrl: item.part.shopUrl,
                    categoryId: categoryForName(tx as unknown as Db, item.part.name),
                  })
                  .returning()
                  .get().id;
              // Teil passt zum Modell des Druckers
              if (printer.modelId)
                tx.insert(sparePartModels)
                  .values({ partId, modelId: printer.modelId })
                  .onConflictDoNothing()
                  .run();
            }
            return createTask(tx as unknown as Db, printer, {
              name: item.name,
              kind: item.kind,
              intervalHours: item.intervalHours,
              intervalMonths: item.intervalMonths,
              partId,
            });
          }),
        ),
      );
    },
  );

  /** Betriebsstunden von Hand – nur, solange sie nicht aus Home Assistant kommen */
  app.put<{ Params: { id: string }; Body: { hours?: unknown } }>(
    '/printers/:id/hours',
    (req, reply) => {
      const printer = printerById(parseId(req.params.id));
      if (!printer) return reply.code(404).send({ error: 'Nicht gefunden' });
      if (printer.haDeviceId && printer.operatingHoursAt)
        return reply.code(409).send({ error: 'Die Betriebsstunden kommen aus Home Assistant.' });
      const hours = optionalNumber(req.body?.hours, 'Die Betriebsstunden');
      if (hours === null) return reply.code(400).send({ error: 'Bitte die Stunden eintragen.' });
      return db
        .update(printers)
        .set({ operatingHours: hours, operatingHoursAt: null })
        .where(eq(printers.id, printer.id))
        .returning()
        .get();
    },
  );

  app.get<{ Params: { id: string } }>('/printers/:id/maintenance-log', (req) =>
    db
      .select()
      .from(maintenanceLog)
      .where(eq(maintenanceLog.printerId, parseId(req.params.id)))
      .orderBy(desc(maintenanceLog.id))
      .all(),
  );

  /**
   * Wartung erledigt: Zähler der gewählten Punkte zurücksetzen und ins Protokoll schreiben. Mit
   * bookParts werden die Teile der Punkte „Tauschen“ vom Lager abgebucht (nie unter 0).
   */
  app.post<{
    Params: { id: string };
    Body: { taskIds?: number[]; bookParts?: boolean; note?: string; doneAt?: string };
  }>('/printers/:id/maintenance', (req, reply) => {
    const printer = printerById(parseId(req.params.id));
    if (!printer) return reply.code(404).send({ error: 'Nicht gefunden' });
    const ids = [...new Set((req.body?.taskIds ?? []).map(Number))];
    const tasks = ids.length
      ? db
          .select()
          .from(maintenanceTasks)
          .where(and(inArray(maintenanceTasks.id, ids), eq(maintenanceTasks.printerId, printer.id)))
          .all()
      : [];
    if (!tasks.length || tasks.length !== ids.length)
      return reply.code(400).send({ error: 'Bitte die erledigten Punkte wählen.' });
    const doneAt = req.body?.doneAt ?? isoDate(new Date());
    if (!DATE.test(doneAt)) return reply.code(400).send({ error: 'Ungültiges Datum.' });
    const settings = readSettings(db);
    const defaults = {
      warnHours: settings.maintenanceWarnHours,
      warnDays: settings.maintenanceWarnDays,
    };

    const result = db.transaction((tx): MaintenanceDoneResult => {
      const missing: MaintenanceDoneResult['missing'] = [];
      const items: MaintenanceLogItem[] = tasks.map((task) => {
        const part = task.partId
          ? tx.select().from(spareParts).where(eq(spareParts.id, task.partId)).get()
          : undefined;
        let booked = 0;
        if (part && req.body?.bookParts && task.kind === 'replace') {
          booked = Math.min(part.stockQty, task.partQty);
          if (booked < task.partQty)
            missing.push({
              partId: part.id,
              name: partLabel(part),
              needed: task.partQty,
              booked,
            });
          if (booked)
            tx.update(spareParts)
              .set({ stockQty: part.stockQty - booked })
              .where(eq(spareParts.id, part.id))
              .run();
        }
        tx.update(maintenanceTasks)
          .set({
            baseHours: printer.operatingHours,
            lastDoneAt: doneAt,
            notifiedLevel: null,
            notifiedAt: null,
          })
          .where(eq(maintenanceTasks.id, task.id))
          .run();
        return {
          taskId: task.id,
          name: task.name,
          kind: task.kind,
          partId: part?.id ?? null,
          partName: part ? partLabel(part) : null,
          booked,
          usedHours: taskStatus(task, printer.operatingHours, new Date(), defaults).usedHours,
          prevBaseHours: task.baseHours,
          prevLastDoneAt: task.lastDoneAt,
        };
      });
      const entry = tx
        .insert(maintenanceLog)
        .values({
          printerId: printer.id,
          doneAt,
          printerHours: printer.operatingHours,
          note: req.body?.note?.trim() || null,
          items,
        })
        .returning()
        .get();
      return { entry, missing };
    });
    return reply.code(201).send(result);
  });

  /** Letzte Wartung eines Druckers rückgängig machen: Zähler und Lagerbestand wie vorher */
  app.delete<{ Params: { id: string } }>('/maintenance-log/:id', (req, reply) => {
    const entry = db
      .select()
      .from(maintenanceLog)
      .where(eq(maintenanceLog.id, parseId(req.params.id)))
      .get();
    if (!entry) return reply.code(404).send({ error: 'Nicht gefunden' });
    const newest = db
      .select({ id: maintenanceLog.id })
      .from(maintenanceLog)
      .where(eq(maintenanceLog.printerId, entry.printerId))
      .orderBy(desc(maintenanceLog.id))
      .get();
    if (newest?.id !== entry.id)
      return reply
        .code(409)
        .send({ error: 'Nur die letzte Wartung lässt sich rückgängig machen.' });
    db.transaction((tx) => {
      for (const item of entry.items) {
        tx.update(maintenanceTasks)
          .set({
            baseHours: item.prevBaseHours,
            lastDoneAt: item.prevLastDoneAt,
            notifiedLevel: null,
            notifiedAt: null,
          })
          .where(eq(maintenanceTasks.id, item.taskId))
          .run();
        if (item.partId && item.booked)
          tx.update(spareParts)
            .set({ stockQty: sql`${spareParts.stockQty} + ${item.booked}` })
            .where(eq(spareParts.id, item.partId))
            .run();
      }
      tx.delete(maintenanceLog).where(eq(maintenanceLog.id, entry.id)).run();
    });
    return reply.code(204).send();
  });

  /** Benachrichtigungsdienste der Companion App (für die Einstellungen) */
  app.get('/ha/notify-services', () => ha.notifyServices());

  /**
   * Probe-Nachricht mit Beispielwerten an die gewählten Ziele (Standard: die gespeicherten),
   * im eingestellten oder mitgeschickten Mustertext; Ergebnis je Ziel
   */
  app.post<{ Body: { targets?: unknown; title?: unknown; message?: unknown } }>(
    '/maintenance/test-notify',
    async (req, reply) => {
      const settings = readSettings(db);
      const body = req.body ?? {};
      const targets = readTargets(
        Array.isArray(body.targets) ? (body.targets as string[]) : settings.maintenanceNotify,
      );
      if (!targets.length) return reply.code(400).send({ error: 'Bitte zuerst ein Ziel wählen.' });
      const title = typeof body.title === 'string' ? body.title : settings.maintenanceTitle;
      const message = typeof body.message === 'string' ? body.message : settings.maintenanceMessage;
      const results = await sendToAll(ha, targets, {
        title: `Test: ${renderMessage(title, SAMPLE_MESSAGE_VARS) || 'Druckwerk'}`,
        message: renderMessage(message, SAMPLE_MESSAGE_VARS) || 'So sieht ein Wartungshinweis aus.',
      });
      if (results.every((r) => r.error))
        return reply.code(502).send({ error: results.map((r) => r.error).join(' · '), results });
      return { results };
    },
  );
}
