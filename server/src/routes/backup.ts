import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { latestMigration, migrateFile, schema, type Db } from '../db/index.js';
import { SUPERVISOR_URL } from '../ha/client.js';

const DB_NAME = '3dapp.db';
const fail = (message: string) => Object.assign(new Error(message), { statusCode: 400 });

/** Alle Dateien unter dir, mit Pfad relativ zu dir (mit / getrennt) */
function listFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listFiles(path.join(dir, entry.name), rel) : [rel];
  });
}

/** Nur harmlose Pfade aus dem ZIP übernehmen (kein „..“, kein absoluter Pfad) */
const safeUpload = (name: string) =>
  name.startsWith('uploads/') &&
  !name.endsWith('/') &&
  name
    .slice('uploads/'.length)
    .split('/')
    .every((part) => part && part !== '.' && part !== '..' && !part.includes('\\'));

export interface BackupOptions {
  uploadDir: string;
  /** Ordner für die Sicherheitskopie vor einem Import (ohne Angabe keine Kopie, z.B. in Tests) */
  safetyDir?: string;
  /** Als HA-App: die Verbindung zum eigenen Home Assistant muss es nach dem Import wieder geben */
  supervisorToken?: string;
}

/**
 * Komplettes Backup: Datenbank und alle hochgeladenen Dateien als ZIP. Der Import ersetzt alles;
 * ältere Backups werden dabei auf den aktuellen Stand der Datenbank gebracht.
 */
export function registerBackupRoutes(app: FastifyInstance, db: Db, options: BackupOptions) {
  const sqlite = db.$client;

  /** Konsistente Kopie der Datenbank als Bytes – geht auch, während die App läuft */
  async function dbBytes() {
    const file = path.join(tmpdir(), `druckwerk-${randomUUID()}.db`);
    try {
      await sqlite.backup(file);
      return new Uint8Array(await readFile(file));
    } finally {
      await rm(file, { force: true });
    }
  }

  app.get('/backup', async (_req, reply) => {
    // Nur die Datenbank packen; alles andere unkomprimiert ablegen. Der Windows-Explorer bricht
    // beim Entpacken ab (Fehler 0x80004005), wenn eine Datei gepackt größer ist als vorher – das
    // passiert bei kleinen Dateien und bei Fotos/PDFs, die schon komprimiert sind.
    const files: Zippable = { [DB_NAME]: [await dbBytes(), { level: 1 }] };
    for (const rel of listFiles(options.uploadDir))
      files[`uploads/${rel}`] = new Uint8Array(readFileSync(path.join(options.uploadDir, rel)));
    files['druckwerk-backup.json'] = strToU8(
      JSON.stringify({ createdAt: new Date().toISOString(), migration: latestMigration() }),
    );
    const zip = zipSync(files, { level: 0 });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    return reply
      .header('content-disposition', `attachment; filename="druckwerk-backup-${stamp}.zip"`)
      .type('application/zip')
      .send(Buffer.from(zip));
  });

  app.post('/backup', async (req, reply) => {
    const upload = await req.file({ limits: { fileSize: 1024 * 1024 * 1024 } });
    if (!upload) return reply.code(400).send({ error: 'Keine Datei' });
    const buffer = await upload.toBuffer();
    if (upload.file.truncated) return reply.code(400).send({ error: 'Die Datei ist zu groß.' });

    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(new Uint8Array(buffer));
    } catch {
      throw fail('Das ist keine ZIP-Datei von Druckwerk.');
    }
    if (!entries[DB_NAME]) throw fail('Im ZIP fehlt die Datenbank – ist das ein Druckwerk-Backup?');
    const meta = entries['druckwerk-backup.json'];
    if (meta) {
      const { migration } = JSON.parse(strFromU8(meta)) as { migration?: number };
      if ((migration ?? 0) > latestMigration())
        throw fail('Das Backup stammt aus einer neueren Druckwerk-Version. Bitte erst updaten.');
    }

    // Backup-Datenbank getrennt öffnen und auf den aktuellen Stand bringen
    const tmpDir = path.join(tmpdir(), `druckwerk-import-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
    const imported = path.join(tmpDir, DB_NAME);
    try {
      await writeFile(imported, entries[DB_NAME]);
      try {
        const check = new Database(imported, { readonly: true });
        check.prepare('SELECT count(*) FROM sqlite_master').get();
        check.close();
        migrateFile(imported);
      } catch {
        throw fail('Die Datenbank im Backup lässt sich nicht lesen.');
      }

      if (options.safetyDir) {
        mkdirSync(options.safetyDir, { recursive: true });
        const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
        await sqlite.backup(path.join(options.safetyDir, `vor-import-${stamp}.db`));
      }

      replaceData(imported);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }

    // Dateien ersetzen
    for (const rel of listFiles(options.uploadDir))
      await rm(path.join(options.uploadDir, rel), { force: true });
    for (const [name, data] of Object.entries(entries)) {
      if (!safeUpload(name)) continue;
      const target = path.join(options.uploadDir, ...name.slice('uploads/'.length).split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, data);
    }

    const counts = {
      spools: sqlite.prepare('SELECT count(*) AS n FROM filament_spools').get() as { n: number },
      projects: sqlite.prepare('SELECT count(*) AS n FROM projects').get() as { n: number },
    };
    return { ok: true, spools: counts.spools.n, projects: counts.projects.n };
  });

  /** Alle Tabellen mit dem Inhalt der Backup-Datenbank füllen (in einem Rutsch) */
  function replaceData(file: string) {
    const tables = (
      sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'`,
        )
        .all() as { name: string }[]
    ).map((t) => t.name);
    const columns = (db: string, table: string) =>
      (sqlite.prepare(`PRAGMA ${db}.table_info("${table}")`).all() as { name: string }[]).map(
        (c) => `"${c.name}"`,
      );

    sqlite.prepare('ATTACH DATABASE ? AS backup').run(file);
    sqlite.pragma('foreign_keys = OFF');
    try {
      sqlite.transaction(() => {
        for (const table of tables) {
          sqlite.prepare(`DELETE FROM main."${table}"`).run();
          const theirs = new Set(columns('backup', table));
          const shared = columns('main', table).filter((c) => theirs.has(c));
          if (!shared.length) continue;
          sqlite
            .prepare(
              `INSERT INTO main."${table}" (${shared.join(', ')})
               SELECT ${shared.join(', ')} FROM backup."${table}"`,
            )
            .run();
        }
        const broken = sqlite.pragma('foreign_key_check') as unknown[];
        if (broken.length) throw fail('Das Backup ist unvollständig (Verweise fehlen).');
        if (
          options.supervisorToken &&
          !db.select().from(schema.haConnections).where(eq(schema.haConnections.local, true)).get()
        )
          db.insert(schema.haConnections)
            .values({ name: 'Home Assistant', url: SUPERVISOR_URL, token: '', local: true })
            .run();
      })();
    } finally {
      sqlite.pragma('foreign_keys = ON');
      sqlite.exec('DETACH DATABASE backup');
    }
  }
}
