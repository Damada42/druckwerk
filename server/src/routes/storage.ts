import {
  DEFAULT_SETTINGS,
  LOW_STOCK_GROUP_LABELS,
  storageSubtree,
  type AppSettings,
} from '@3dapp/shared';
import { asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import { missingFields, parseId, pickColumns } from './crud.js';

const { settings, storageLocations } = schema;

export function readSettings(db: Db): AppSettings {
  const rows = db.select().from(settings).all();
  const result: AppSettings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
    const row = rows.find((r) => r.key === key);
    if (row) (result as unknown as Record<string, unknown>)[key] = JSON.parse(row.value);
  }
  return result;
}

/** Einstellungen der App und Lagerplätze (Regal › Seite › Reihe) */
export function registerStorageRoutes(app: FastifyInstance, db: Db) {
  app.get('/settings', () => readSettings(db));

  app.put<{ Body: Partial<AppSettings> }>('/settings', (req, reply) => {
    const body = req.body ?? {};
    for (const [key, value] of Object.entries(body)) {
      if (!(key in DEFAULT_SETTINGS)) continue;
      if (typeof value !== typeof DEFAULT_SETTINGS[key as keyof AppSettings])
        return reply.code(400).send({ error: `Ungültiger Wert für ${key}` });
      if (key === 'lowStockGroup' && !Object.hasOwn(LOW_STOCK_GROUP_LABELS, value as string))
        return reply.code(400).send({ error: `Ungültiger Wert für ${key}` });
      db.insert(settings)
        .values({ key, value: JSON.stringify(value) })
        .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(value) } })
        .run();
    }
    return readSettings(db);
  });

  const all = () =>
    db
      .select()
      .from(storageLocations)
      .orderBy(asc(storageLocations.position), asc(storageLocations.id))
      .all();

  const exists = (id: number) =>
    !!db.select().from(storageLocations).where(eq(storageLocations.id, id)).get();

  app.get('/storage-locations', all);

  app.post('/storage-locations', (req, reply) => {
    const data = pickColumns(storageLocations, req.body);
    if (typeof data.name === 'string') data.name = data.name.trim();
    if (missingFields(data, ['name']).length)
      return reply.code(400).send({ error: 'Bitte einen Namen eintragen.' });
    const parentId = (data.parentId as number | null | undefined) ?? null;
    if (parentId !== null && !exists(parentId))
      return reply.code(400).send({ error: 'Übergeordneter Lagerplatz fehlt.' });
    // Neue Plätze hinten anhängen
    const siblings = db
      .select()
      .from(storageLocations)
      .where(
        parentId === null
          ? isNull(storageLocations.parentId)
          : eq(storageLocations.parentId, parentId),
      )
      .all();
    const position = siblings.reduce((max, s) => Math.max(max, s.position + 1), 0);
    const row = db
      .insert(storageLocations)
      .values({ name: data.name as string, parentId, position })
      .returning()
      .get();
    return reply.code(201).send(row);
  });

  app.put<{ Params: { id: string } }>('/storage-locations/:id', (req, reply) => {
    const id = parseId(req.params.id);
    const data = pickColumns(storageLocations, req.body);
    delete data.position;
    if (typeof data.name === 'string') data.name = data.name.trim();
    if ('name' in data && !data.name)
      return reply.code(400).send({ error: 'Bitte einen Namen eintragen.' });
    if (!exists(id)) return reply.code(404).send({ error: 'Nicht gefunden' });
    if (data.parentId !== undefined && data.parentId !== null) {
      const parentId = data.parentId as number;
      // Nicht in sich selbst oder einen eigenen Unterplatz verschieben
      if (storageSubtree(all(), id).has(parentId))
        return reply.code(400).send({ error: 'Ein Lagerplatz kann nicht in sich selbst liegen.' });
      if (!exists(parentId))
        return reply.code(400).send({ error: 'Übergeordneter Lagerplatz fehlt.' });
    }
    if (Object.keys(data).length === 0)
      return db.select().from(storageLocations).where(eq(storageLocations.id, id)).get();
    return db
      .update(storageLocations)
      .set(data)
      .where(eq(storageLocations.id, id))
      .returning()
      .get();
  });

  /** Löscht den Platz samt Unterplätzen; Spulen darin verlieren nur die Zuordnung */
  app.delete<{ Params: { id: string } }>('/storage-locations/:id', (req, reply) => {
    const result = db
      .delete(storageLocations)
      .where(eq(storageLocations.id, parseId(req.params.id)))
      .run();
    return result.changes
      ? reply.code(204).send()
      : reply.code(404).send({ error: 'Nicht gefunden' });
  });

  /** Reihenfolge von Geschwistern setzen (z.B. Reihe 1, 2, 3) */
  app.put<{ Body: { ids?: number[] } }>('/storage-locations/order', (req, reply) => {
    const ids = req.body?.ids ?? [];
    const rows = all();
    const parents = new Set(ids.map((id) => rows.find((r) => r.id === id)?.parentId));
    if (!ids.length || parents.size !== 1 || parents.has(undefined))
      return reply.code(400).send({ error: 'Die Liste passt nicht zu den Lagerplätzen.' });
    db.transaction((tx) =>
      ids.forEach((id, position) =>
        tx.update(storageLocations).set({ position }).where(eq(storageLocations.id, id)).run(),
      ),
    );
    return reply.code(204).send();
  });
}
