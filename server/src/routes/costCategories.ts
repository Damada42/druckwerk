import type { CostCategory } from '@3dapp/shared';
import { asc, eq, max } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { schema, type Db } from '../db/index.js';
import { parseId } from './crud.js';

const { costCategories, projectCosts } = schema;

type Body = { name?: string; unit?: string; defaultPrice?: number | string | null };

/** Name, Einheit und Standardpreis prüfen; leerer Preis = kein Vorschlag */
function parseBody(body: Body | undefined, partial: boolean) {
  const data: Partial<Pick<CostCategory, 'name' | 'unit' | 'defaultPrice'>> = {};
  if (body?.name !== undefined || !partial) {
    const name = String(body?.name ?? '').trim();
    if (!name) throw Object.assign(new Error('Bitte einen Namen eintragen.'), { statusCode: 400 });
    data.name = name;
  }
  if (body?.unit !== undefined) data.unit = String(body.unit).trim() || 'Stück';
  if (body?.defaultPrice !== undefined) {
    const raw = body.defaultPrice;
    const price = raw === null || raw === '' ? null : Number(String(raw).replace(',', '.'));
    if (price !== null && (!Number.isFinite(price) || price < 0))
      throw Object.assign(new Error('Der Standardpreis muss eine Zahl ab 0 sein.'), {
        statusCode: 400,
      });
    data.defaultPrice = price;
  }
  return data;
}

/** Kategorien für Zusatzkosten mit Standardpreis und Einheit (unter „Einstellungen“) */
export function registerCostCategoryRoutes(app: FastifyInstance, db: Db) {
  app.get('/cost-categories', () =>
    db
      .select()
      .from(costCategories)
      .orderBy(asc(costCategories.position), asc(costCategories.id))
      .all(),
  );

  app.post<{ Body: Body }>('/cost-categories', (req, reply) => {
    const data = parseBody(req.body, false);
    const [{ last }] = db
      .select({ last: max(costCategories.position) })
      .from(costCategories)
      .all();
    const row = db
      .insert(costCategories)
      .values({
        name: data.name!,
        unit: data.unit ?? 'Stück',
        defaultPrice: data.defaultPrice ?? null,
        // Eigener, unveränderlicher Schlüssel – Umbenennen ändert die Projekte nicht
        key: `c-${randomUUID().slice(0, 8)}`,
        position: (last ?? 0) + 1,
      })
      .returning()
      .get();
    return reply.code(201).send(row);
  });

  app.put<{ Params: { id: string }; Body: Body }>('/cost-categories/:id', (req, reply) => {
    const data = parseBody(req.body, true);
    const row = db
      .update(costCategories)
      .set(data)
      .where(eq(costCategories.id, parseId(req.params.id)))
      .returning()
      .get();
    return row ?? reply.code(404).send({ error: 'Nicht gefunden' });
  });

  /** Nur löschbar, solange kein Projekt die Kategorie verwendet */
  app.delete<{ Params: { id: string } }>('/cost-categories/:id', (req, reply) => {
    const id = parseId(req.params.id);
    const category = db.select().from(costCategories).where(eq(costCategories.id, id)).get();
    if (!category) return reply.code(404).send({ error: 'Nicht gefunden' });
    const used = db
      .select({ id: projectCosts.id })
      .from(projectCosts)
      .where(eq(projectCosts.category, category.key))
      .get();
    if (used) return reply.code(409).send({ error: 'Wird noch in einem Projekt verwendet.' });
    db.delete(costCategories).where(eq(costCategories.id, id)).run();
    return reply.code(204).send();
  });
}
