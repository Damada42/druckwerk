import { guessPartCategory } from '@3dapp/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { schema, type Db } from '../db/index.js';
import { parseId } from './crud.js';

const { partCategories } = schema;

const badRequest = (message: string) => Object.assign(new Error(message), { statusCode: 400 });

export const listPartCategories = (db: Db) =>
  db
    .select()
    .from(partCategories)
    .orderBy(asc(partCategories.position), asc(partCategories.id))
    .all();

/** Kategorie eines neuen Teils aus seinem Namen (mitgelieferte Kategorien per Schlüssel) */
export function categoryForName(db: Db, name: string) {
  const key = guessPartCategory(name);
  return db.select().from(partCategories).where(eq(partCategories.key, key)).get()?.id ?? null;
}

/** categoryId eines Teils prüfen: leer = ohne Kategorie */
export function checkCategoryId(db: Db, raw: unknown) {
  if (raw === null || raw === undefined || raw === '') return null;
  const id = Number(raw);
  if (
    !Number.isInteger(id) ||
    !db.select().from(partCategories).where(eq(partCategories.id, id)).get()
  )
    throw badRequest('Unbekannte Kategorie.');
  return id;
}

/** Kategorien der Ersatzteile (unter „Einstellungen“) */
export function registerPartCategoryRoutes(app: FastifyInstance, db: Db) {
  app.get('/part-categories', () => listPartCategories(db));

  const nameOf = (body: unknown) => {
    const name = String((body as { name?: unknown } | null)?.name ?? '').trim();
    if (!name) throw badRequest('Bitte einen Namen eintragen.');
    return name;
  };
  const taken = (name: string, id?: number) =>
    listPartCategories(db).some((c) => c.id !== id && c.name.toLowerCase() === name.toLowerCase());

  app.post('/part-categories', (req, reply) => {
    const name = nameOf(req.body);
    if (taken(name)) return reply.code(409).send({ error: 'Diese Kategorie gibt es schon.' });
    const last = db
      .select({ max: sql<number>`coalesce(max(${partCategories.position}), 0)` })
      .from(partCategories)
      .get()!.max;
    const row = db
      .insert(partCategories)
      .values({ key: `c-${randomUUID()}`, name, position: last + 1 })
      .returning()
      .get();
    return reply.code(201).send(row);
  });

  app.put<{ Params: { id: string } }>('/part-categories/:id', (req, reply) => {
    const id = parseId(req.params.id);
    const name = nameOf(req.body);
    if (taken(name, id)) return reply.code(409).send({ error: 'Diese Kategorie gibt es schon.' });
    const row = db
      .update(partCategories)
      .set({ name })
      .where(eq(partCategories.id, id))
      .returning()
      .get();
    return row ?? reply.code(404).send({ error: 'Nicht gefunden' });
  });

  /** Reihenfolge (auch die der Abschnitte auf der Ersatzteil-Seite) */
  app.put<{ Body: { ids?: unknown } }>('/part-categories/order', (req) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids)) throw badRequest('Reihenfolge fehlt.');
    db.transaction((tx) =>
      ids.forEach((id, i) =>
        tx
          .update(partCategories)
          .set({ position: i + 1 })
          .where(eq(partCategories.id, Number(id)))
          .run(),
      ),
    );
    return listPartCategories(db);
  });

  /** Teile der Kategorie stehen danach unter „Ohne Kategorie“ */
  app.delete<{ Params: { id: string } }>('/part-categories/:id', (req, reply) => {
    const result = db
      .delete(partCategories)
      .where(eq(partCategories.id, parseId(req.params.id)))
      .run();
    return result.changes
      ? reply.code(204).send()
      : reply.code(404).send({ error: 'Nicht gefunden' });
  });
}
