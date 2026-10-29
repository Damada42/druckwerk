import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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

/** Eine fremde Datenbankdatei (z.B. aus einem Backup) auf den aktuellen Stand bringen */
export function migrateFile(file: string) {
  const sqlite = new Database(file);
  try {
    migrate(drizzle(sqlite, { schema }), { migrationsFolder });
  } finally {
    sqlite.close();
  }
}

/** Zeitstempel der neuesten Migration, die diese Version kennt */
export function latestMigration(): number {
  const journal = JSON.parse(
    readFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
  ) as {
    entries: { when: number }[];
  };
  return Math.max(...journal.entries.map((e) => e.when));
}

export type Db = ReturnType<typeof createDb>;
export { schema };
