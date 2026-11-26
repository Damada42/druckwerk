import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { schema, type Db } from '../db/index.js';
import { parseId } from './crud.js';
import { canonicalManufacturer } from './manufacturers.js';

const { printerModels, manufacturers, printers } = schema;

const badRequest = (message: string) => Object.assign(new Error(message), { statusCode: 400 });

/** Alle Modelle mit Herstellernamen, nach Hersteller und Name sortiert */
export function listModels(db: Db) {
  return db
    .select({
      id: printerModels.id,
      manufacturerId: printerModels.manufacturerId,
      manufacturer: manufacturers.name,
      name: printerModels.name,
    })
    .from(printerModels)
    .innerJoin(manufacturers, eq(manufacturers.id, printerModels.manufacturerId))
    .orderBy(asc(sql`lower(${manufacturers.name})`), asc(sql`lower(${printerModels.name})`))
    .all();
}

const modelById = (db: Db, id: number) => listModels(db).find((m) => m.id === id);

/** Anzeigetext der Drucker eines Modells nachziehen („Hersteller Modell“) */
export function syncPrinterModelText(db: Db, modelId?: number) {
  for (const m of listModels(db).filter((m) => modelId === undefined || m.id === modelId))
    db.update(printers)
      .set({ model: `${m.manufacturer} ${m.name}` })
      .where(eq(printers.modelId, m.id))
      .run();
}

/** Drucker speichern: mit Modell aus der Liste wird model zu „Hersteller Modell“ */
export function applyPrinterModel(db: Db, data: Record<string, unknown>) {
  if (!('modelId' in data) || data.modelId === null) return data;
  const model = modelById(db, Number(data.modelId));
  if (!model) throw badRequest('Unbekanntes Druckermodell.');
  return { ...data, modelId: model.id, model: `${model.manufacturer} ${model.name}` };
}

/** Druckermodelle je Hersteller (unter „Einstellungen“) */
export function registerPrinterModelRoutes(app: FastifyInstance, db: Db) {
  app.get('/printer-models', () => listModels(db));

  const parse = (body: unknown) => {
    const b = (body ?? {}) as { name?: unknown; manufacturer?: unknown; manufacturerId?: unknown };
    const name = String(b.name ?? '').trim();
    if (!name) throw badRequest('Bitte einen Namen eintragen.');
    let manufacturerId = Number(b.manufacturerId);
    if (!Number.isInteger(manufacturerId) || manufacturerId <= 0) {
      const maker = canonicalManufacturer(db, b.manufacturer);
      if (!maker) throw badRequest('Bitte einen Hersteller wählen.');
      manufacturerId = db
        .select({ id: manufacturers.id })
        .from(manufacturers)
        .where(eq(manufacturers.name, maker))
        .get()!.id;
    } else if (!db.select().from(manufacturers).where(eq(manufacturers.id, manufacturerId)).get())
      throw badRequest('Unbekannter Hersteller.');
    return { name, manufacturerId };
  };

  const duplicate = (data: { name: string; manufacturerId: number }, id?: number) =>
    db
      .select({ id: printerModels.id })
      .from(printerModels)
      .where(
        and(
          eq(printerModels.manufacturerId, data.manufacturerId),
          sql`lower(${printerModels.name}) = lower(${data.name})`,
          id ? ne(printerModels.id, id) : undefined,
        ),
      )
      .get();

  app.post('/printer-models', (req, reply) => {
    const data = parse(req.body);
    if (duplicate(data)) return reply.code(409).send({ error: 'Dieses Modell gibt es schon.' });
    const row = db.insert(printerModels).values(data).returning().get();
    return reply.code(201).send(modelById(db, row.id));
  });

  /** Umbenennen bzw. anderem Hersteller zuordnen ändert auch den Modelltext der Drucker */
  app.put<{ Params: { id: string } }>('/printer-models/:id', (req, reply) => {
    const id = parseId(req.params.id);
    if (!modelById(db, id)) return reply.code(404).send({ error: 'Nicht gefunden' });
    const data = parse(req.body);
    if (duplicate(data, id)) return reply.code(409).send({ error: 'Dieses Modell gibt es schon.' });
    db.transaction((tx) => {
      tx.update(printerModels).set(data).where(eq(printerModels.id, id)).run();
      syncPrinterModelText(tx as unknown as Db, id);
    });
    return modelById(db, id);
  });

  /** Drucker behalten ihren Modelltext, Ersatzteile verlieren die Zuordnung */
  app.delete<{ Params: { id: string } }>('/printer-models/:id', (req, reply) => {
    const result = db
      .delete(printerModels)
      .where(eq(printerModels.id, parseId(req.params.id)))
      .run();
    return result.changes
      ? reply.code(204).send()
      : reply.code(404).send({ error: 'Nicht gefunden' });
  });
}
