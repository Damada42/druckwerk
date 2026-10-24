import { eq, getTableColumns } from 'drizzle-orm';
import type { SQLiteTable, SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';

type TableWithId = SQLiteTable & { id: SQLiteColumn };

interface CrudOptions {
  /** Pflichtfelder beim Anlegen. */
  required?: string[];
  /** Wird vor dem Anlegen auf die Daten angewendet. */
  beforeCreate?: (data: Record<string, unknown>) => Record<string, unknown>;
}

const READONLY = new Set(['id', 'createdAt', 'updatedAt']);

/** Übernimmt nur Felder, die es in der Tabelle gibt (und die beschreibbar sind). */
export function pickColumns(table: SQLiteTable, body: unknown): Record<string, unknown> {
  const columns = getTableColumns(table);
  const data: Record<string, unknown> = {};
  if (!body || typeof body !== 'object') return data;
  for (const [key, value] of Object.entries(body)) {
    if (key in columns && !READONLY.has(key)) data[key] = value === '' ? null : value;
  }
  return data;
}

export function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0)
    throw Object.assign(new Error('Ungültige ID'), { statusCode: 400 });
  return id;
}

export function missingFields(data: Record<string, unknown>, required: string[]) {
  return required.filter((f) => data[f] === undefined || data[f] === null || data[f] === '');
}

/** Registriert Standard-Endpunkte (Liste, Einzeln, Anlegen, Ändern, Löschen) für eine Tabelle. */
export function registerCrud(
  app: FastifyInstance,
  db: Db,
  path: string,
  table: TableWithId,
  options: CrudOptions = {},
) {
  app.get(path, () => db.select().from(table).orderBy(table.id).all());

  app.get<{ Params: { id: string } }>(`${path}/:id`, (req, reply) => {
    const row = db
      .select()
      .from(table)
      .where(eq(table.id, parseId(req.params.id)))
      .get();
    return row ?? reply.code(404).send({ error: 'Nicht gefunden' });
  });

  app.post(path, (req, reply) => {
    let data = pickColumns(table, req.body);
    const missing = missingFields(data, options.required ?? []);
    if (missing.length)
      return reply.code(400).send({ error: `Pflichtfelder fehlen: ${missing.join(', ')}` });
    if (options.beforeCreate) data = options.beforeCreate(data);
    const row = db
      .insert(table)
      .values(data as never)
      .returning()
      .get();
    return reply.code(201).send(row);
  });

  app.put<{ Params: { id: string } }>(`${path}/:id`, (req, reply) => {
    const data = pickColumns(table, req.body);
    const id = parseId(req.params.id);
    if (Object.keys(data).length === 0) {
      return (
        db.select().from(table).where(eq(table.id, id)).get() ??
        reply.code(404).send({ error: 'Nicht gefunden' })
      );
    }
    const row = db
      .update(table)
      .set(data as never)
      .where(eq(table.id, id))
      .returning()
      .get();
    return row ?? reply.code(404).send({ error: 'Nicht gefunden' });
  });

  app.delete<{ Params: { id: string } }>(`${path}/:id`, (req, reply) => {
    const result = db
      .delete(table)
      .where(eq(table.id, parseId(req.params.id)))
      .run();
    return result.changes
      ? reply.code(204).send()
      : reply.code(404).send({ error: 'Nicht gefunden' });
  });
}
