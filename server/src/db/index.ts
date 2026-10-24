import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';
import { seed } from './seed.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export function createDb(file: string) {
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  seed(db);
  return db;
}

export type Db = ReturnType<typeof createDb>;
export { schema };
