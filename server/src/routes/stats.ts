import { lowStock, type DashboardStats } from '@3dapp/shared';
import { count, sum } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { FastifyInstance } from 'fastify';
import { schema, type Db } from '../db/index.js';
import { readSettings } from './storage.js';

export function getStats(db: Db): DashboardStats {
  const byStatus = db
    .select({ status: schema.projects.status, n: count() })
    .from(schema.projects)
    .groupBy(schema.projects.status)
    .all();
  const projects = { open: 0, in_progress: 0, done: 0 };
  for (const { status, n } of byStatus) projects[status] = n;

  const countOf = (table: SQLiteTable) => db.select({ n: count() }).from(table).get()?.n ?? 0;

  const filament = db
    .select({ n: count(), total: sum(schema.filamentSpools.weightRemainingG) })
    .from(schema.filamentSpools)
    .get();
  // Knappe Sorten wie in der Übersicht (zusammengezählt laut Einstellung)
  const low = lowStock(
    db.select().from(schema.filamentSpools).all(),
    db.select().from(schema.filamentTypes).all(),
    db.select().from(schema.finishes).all(),
    readSettings(db).lowStockGroup,
  );

  return {
    projects,
    customers: countOf(schema.customers),
    persons: countOf(schema.persons),
    printers: countOf(schema.printers),
    spools: filament?.n ?? 0,
    filamentTotalG: Number(filament?.total ?? 0),
    lowSpools: low.length,
  };
}

export function registerStatsRoutes(app: FastifyInstance, db: Db) {
  app.get('/stats', () => getStats(db));
}
