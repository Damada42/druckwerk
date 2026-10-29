import { and, asc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { schema, type Db } from '../db/index.js';
import { parseId } from './crud.js';

const { manufacturers, filamentSpools, filamentProducts } = schema;

const badRequest = (message: string) => Object.assign(new Error(message), { statusCode: 400 });

const byName = (db: Db, name: string) =>
  db
    .select()
    .from(manufacturers)
    .where(sql`lower(${manufacturers.name}) = lower(${name})`)
    .get();

/**
 * Hersteller in der Schreibweise aus der Liste („bambu lab“ → „Bambu Lab“). Unbekannte Hersteller
 * (z.B. aus Scan oder AMS) kommen neu in die Liste.
 */
export function canonicalManufacturer(db: Db, raw: unknown) {
  const name = String(raw ?? '').trim();
  if (!name) return name;
  return byName(db, name)?.name ?? db.insert(manufacturers).values({ name }).returning().get().name;
}

/** Mindestmenge prüfen: leer = Vorgabe, sonst eine Zahl ab 0 */
export function parseMinStock(raw: unknown): number | null {
  if (raw === null || raw === '') return null;
  const n = Number(String(raw).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw badRequest('Die Mindestmenge muss eine Zahl ab 0 sein.');
  return n;
}

/**
 * Vor dem Speichern einer Spule: Hersteller vereinheitlichen, Mindestmenge prüfen. Neue Spulen
 * übernehmen die eigene Mindestmenge ihrer Sorte, falls eine andere Spule der Sorte sie hat.
 */
export function prepareSpool(db: Db, data: Record<string, unknown>, isNew: boolean) {
  const result = { ...data };
  if ('manufacturer' in result)
    result.manufacturer = canonicalManufacturer(db, result.manufacturer);
  if (result.minStockG !== undefined) result.minStockG = parseMinStock(result.minStockG);
  else if (isNew && result.typeId && result.manufacturer && result.colorName) {
    const finishId = (result.finishId as number | null | undefined) ?? null;
    const sibling = db
      .select({ minStockG: filamentSpools.minStockG })
      .from(filamentSpools)
      .where(
        and(
          eq(filamentSpools.typeId, Number(result.typeId)),
          sql`lower(trim(${filamentSpools.manufacturer})) = lower(${String(result.manufacturer)})`,
          sql`lower(trim(${filamentSpools.colorName})) = lower(trim(${String(result.colorName)}))`,
          finishId === null
            ? isNull(filamentSpools.finishId)
            : eq(filamentSpools.finishId, finishId),
          isNotNull(filamentSpools.minStockG),
        ),
      )
      .get();
    if (sibling) result.minStockG = sibling.minStockG;
  }
  return result;
}

/** Herstellerliste (unter „Einstellungen“) */
export function registerManufacturerRoutes(app: FastifyInstance, db: Db) {
  app.get('/manufacturers', () =>
    db
      .select()
      .from(manufacturers)
      .orderBy(asc(sql`lower(${manufacturers.name})`))
      .all(),
  );

  const parseName = (body: unknown) => {
    const name = String((body as { name?: unknown } | undefined)?.name ?? '').trim();
    if (!name) throw badRequest('Bitte einen Namen eintragen.');
    return name;
  };

  app.post('/manufacturers', (req, reply) => {
    const name = parseName(req.body);
    if (byName(db, name))
      return reply.code(409).send({ error: 'Diesen Hersteller gibt es schon.' });
    return reply.code(201).send(db.insert(manufacturers).values({ name }).returning().get());
  });

  /** Umbenennen ändert auch die Spulen und gemerkten Sorten mit dem alten Namen */
  app.put<{ Params: { id: string } }>('/manufacturers/:id', (req, reply) => {
    const id = parseId(req.params.id);
    const name = parseName(req.body);
    const current = db.select().from(manufacturers).where(eq(manufacturers.id, id)).get();
    if (!current) return reply.code(404).send({ error: 'Nicht gefunden' });
    const other = db
      .select()
      .from(manufacturers)
      .where(and(sql`lower(${manufacturers.name}) = lower(${name})`, ne(manufacturers.id, id)))
      .get();
    if (other) return reply.code(409).send({ error: 'Diesen Hersteller gibt es schon.' });
    return db.transaction((tx) => {
      for (const table of [filamentSpools, filamentProducts])
        tx.update(table)
          .set({ manufacturer: name })
          .where(sql`lower(trim(${table.manufacturer})) = lower(${current.name})`)
          .run();
      return tx
        .update(manufacturers)
        .set({ name })
        .where(eq(manufacturers.id, id))
        .returning()
        .get();
    });
  });

  app.delete<{ Params: { id: string } }>('/manufacturers/:id', (req, reply) => {
    const id = parseId(req.params.id);
    const current = db.select().from(manufacturers).where(eq(manufacturers.id, id)).get();
    if (!current) return reply.code(404).send({ error: 'Nicht gefunden' });
    const used = db
      .select({ id: filamentSpools.id })
      .from(filamentSpools)
      .where(sql`lower(trim(${filamentSpools.manufacturer})) = lower(${current.name})`)
      .all().length;
    if (used)
      return reply.code(409).send({
        error: `${current.name} wird noch von ${used} ${used === 1 ? 'Spule' : 'Spulen'} verwendet.`,
      });
    db.delete(manufacturers).where(eq(manufacturers.id, id)).run();
    return reply.code(204).send();
  });
}
