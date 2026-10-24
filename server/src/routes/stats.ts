import { LOW_FILAMENT_GRAMS, type DashboardStats } from '@3dapp/shared';
import { count, lt, sum } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { FastifyInstance } from 'fastify';
import { schema, type Db } from '../db/index.js';

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
  const low = db
    .select({ n: count() })
    .from(schema.filamentSpools)
    .where(lt(schema.filamentSpools.weightRemainingG, LOW_FILAMENT_GRAMS))
    .get();

  return {
    projects,
    customers: countOf(schema.customers),
    persons: countOf(schema.persons),
    printers: countOf(schema.printers),
    spools: filament?.n ?? 0,
    filamentTotalG: Number(filament?.total ?? 0),
    lowSpools: low?.n ?? 0,
  };
}

export function registerStatsRoutes(app: FastifyInstance, db: Db) {
  app.get('/stats', () => getStats(db));
}
