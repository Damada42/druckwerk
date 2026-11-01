import {
  BACKUP_GROUPS,
  type BackupGroup,
  type BackupInfo,
  type BackupRestoreResult,
} from '@3dapp/shared';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { latestMigration, migrateFile, schema, type Db } from '../db/index.js';
import { SUPERVISOR_URL } from '../ha/client.js';

const DB_NAME = '3dapp.db';
const ZIP_NAME = 'backup.zip';
const fail = (message: string) => Object.assign(new Error(message), { statusCode: 400 });

/** Ein Teil einer Tabelle, der zu einer Gruppe gehört (where: Bedingung für die Zeilen) */
interface TablePart {
  table: string;
  where?: string;
}

/**
 * Welche Tabellen zu welcher Gruppe gehören. Firmendaten und übrige Einstellungen teilen sich die
 * Tabelle settings, werden aber getrennt gesichert und eingespielt.
 */
export const GROUP_TABLES: Record<BackupGroup, TablePart[]> = {
  projects: [
    { table: 'projects' },
    { table: 'project_members' },
    { table: 'project_filaments' },
    { table: 'project_costs' },
    { table: 'invoices' },
    { table: 'project_documents' },
  ],
  customers: [{ table: 'customers' }],
  team: [{ table: 'persons' }],
  filament: [
    { table: 'filament_types' },
    { table: 'manufacturers' },
    { table: 'finishes' },
    { table: 'filament_spools' },
    { table: 'filament_products' },
    { table: 'filament_bookings' },
  ],
  storage: [{ table: 'storage_locations' }],
  printers: [{ table: 'printers' }, { table: 'printer_cameras' }, { table: 'ha_connections' }],
  company: [{ table: 'settings', where: `"key" = 'company'` }],
  settings: [{ table: 'settings', where: `"key" <> 'company'` }, { table: 'cost_categories' }],
};

/** Zählt, was eine Gruppe enthält (für die Vorschau beim Einspielen) */
const GROUP_COUNT: Record<BackupGroup, string> = {
  projects: 'SELECT count(*) FROM {db}.projects',
  customers: 'SELECT count(*) FROM {db}.customers',
  team: 'SELECT count(*) FROM {db}.persons',
  filament: 'SELECT count(*) FROM {db}.filament_spools',
  storage: 'SELECT count(*) FROM {db}.storage_locations',
  printers: 'SELECT count(*) FROM {db}.printers',
  company: `SELECT count(*) FROM {db}.settings WHERE "key" = 'company'`,
  settings: `SELECT (SELECT count(*) FROM {db}.settings WHERE "key" <> 'company')
                  + (SELECT count(*) FROM {db}.cost_categories)`,
};

/** Alle Dateien unter dir, mit Pfad relativ zu dir (mit / getrennt) */
function listFiles(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
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

/** „/uploads/abc.pdf“ → „abc.pdf“ */
const uploadName = (filePath: unknown) =>
  typeof filePath === 'string' && filePath.startsWith('/uploads/')
    ? filePath.slice('/uploads/'.length)
    : null;

/** Dateien im Upload-Ordner, auf die eine Gruppe verweist */
function groupFiles(sqlite: Database.Database, dbName: string, groups: BackupGroup[]) {
  const names = new Set<string>();
  const add = (value: unknown) => {
    const name = uploadName(value);
    if (name) names.add(name);
  };
  if (groups.includes('projects'))
    for (const table of ['invoices', 'project_documents'])
      for (const row of sqlite
        .prepare(`SELECT file_path AS f FROM ${dbName}."${table}" WHERE file_path IS NOT NULL`)
        .all() as { f: string }[])
        add(row.f);
  if (groups.includes('company')) {
    const row = sqlite
      .prepare(`SELECT value FROM ${dbName}.settings WHERE "key" = 'company'`)
      .get() as { value: string } | undefined;
    try {
      if (row) add((JSON.parse(row.value) as { logoPath?: string }).logoPath);
    } catch {
      // kaputtes Profil: kein Logo
    }
  }
  return names;
}

/** Gruppen aus Anfrage-Daten prüfen; leer oder unbekannt → Fehler */
function parseGroups(value: unknown): BackupGroup[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',').filter(Boolean)
      : null;
  if (!list) return [...BACKUP_GROUPS];
  const groups = BACKUP_GROUPS.filter((g) => list.includes(g));
  if (!groups.length || groups.length !== new Set(list).size)
    throw fail('Bitte mindestens einen gültigen Bereich wählen.');
  return groups;
}

export interface BackupOptions {
  uploadDir: string;
  /** Ordner für die Sicherheitskopie vor einem Import (ohne Angabe keine Kopie, z.B. in Tests) */
  safetyDir?: string;
  /** Als HA-App: die Verbindung zum eigenen Home Assistant muss es nach dem Import wieder geben */
  supervisorToken?: string;
}

/** Hochgeladenes Backup bis zum Einspielen (ZIP und auf den neuesten Stand gebrachte DB) */
interface Pending {
  dir: string;
  groups: BackupGroup[];
  timer: NodeJS.Timeout;
}

/**
 * Backup: Datenbank und hochgeladene Dateien als ZIP, ganz oder nach Bereichen. Beim Einspielen
 * wird das ZIP zuerst geprüft und angezeigt, was drin ist; ersetzt werden nur die gewählten
 * Bereiche. Ältere Backups werden dabei auf den aktuellen Stand der Datenbank gebracht.
 */
export function registerBackupRoutes(app: FastifyInstance, db: Db, options: BackupOptions) {
  const sqlite = db.$client;
  const pending = new Map<string, Pending>();

  const drop = (token: string) => {
    const p = pending.get(token);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(token);
    rmSync(p.dir, { recursive: true, force: true });
  };
  app.addHook('onClose', async () => {
    for (const token of [...pending.keys()]) drop(token);
  });

  /** Konsistente Kopie der Datenbank, nur mit den gewählten Bereichen */
  async function dbBytes(groups: BackupGroup[]) {
    const file = path.join(tmpdir(), `druckwerk-${randomUUID()}.db`);
    try {
      await sqlite.backup(file);
      if (groups.length < BACKUP_GROUPS.length) {
        const copy = new Database(file);
        try {
          copy.pragma('foreign_keys = OFF');
          for (const group of BACKUP_GROUPS.filter((g) => !groups.includes(g)))
            for (const part of GROUP_TABLES[group])
              copy
                .prepare(`DELETE FROM "${part.table}"${part.where ? ` WHERE ${part.where}` : ''}`)
                .run();
          copy.exec('VACUUM');
        } finally {
          copy.close();
        }
      }
      return new Uint8Array(await readFile(file));
    } finally {
      await rm(file, { force: true });
    }
  }

  app.get<{ Querystring: { groups?: string } }>('/backup', async (req, reply) => {
    const groups = parseGroups(req.query.groups);
    const all = groups.length === BACKUP_GROUPS.length;
    // Nur die Datenbank packen; alles andere unkomprimiert ablegen. Der Windows-Explorer bricht
    // beim Entpacken ab (Fehler 0x80004005), wenn eine Datei gepackt größer ist als vorher – das
    // passiert bei kleinen Dateien und bei Fotos/PDFs, die schon komprimiert sind.
    const files: Zippable = { [DB_NAME]: [await dbBytes(groups), { level: 1 }] };
    // Alles: auch Dateien, auf die nichts (mehr) verweist; sonst nur die der gewählten Bereiche
    const wanted = all ? null : groupFiles(sqlite, 'main', groups);
    for (const rel of listFiles(options.uploadDir))
      if (!wanted || wanted.has(rel))
        files[`uploads/${rel}`] = new Uint8Array(readFileSync(path.join(options.uploadDir, rel)));
    files['druckwerk-backup.json'] = strToU8(
      JSON.stringify({ createdAt: new Date().toISOString(), migration: latestMigration(), groups }),
    );
    const zip = zipSync(files, { level: 0 });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const suffix = all ? '' : '-teil';
    return reply
      .header(
        'content-disposition',
        `attachment; filename="druckwerk-backup${suffix}-${stamp}.zip"`,
      )
      .type('application/zip')
      .send(Buffer.from(zip));
  });

  /** ZIP prüfen, Datenbank auf den aktuellen Stand bringen und bis zum Einspielen aufheben */
  async function receive(req: FastifyRequest) {
    const upload = await req.file({ limits: { fileSize: 1024 * 1024 * 1024 } });
    if (!upload) throw fail('Keine Datei');
    const buffer = await upload.toBuffer();
    if (upload.file.truncated) throw fail('Die Datei ist zu groß.');

    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(new Uint8Array(buffer));
    } catch {
      throw fail('Das ist keine ZIP-Datei von Druckwerk.');
    }
    if (!entries[DB_NAME]) throw fail('Im ZIP fehlt die Datenbank – ist das ein Druckwerk-Backup?');
    let meta: { migration?: number; createdAt?: string; groups?: unknown } = {};
    if (entries['druckwerk-backup.json']) {
      try {
        meta = JSON.parse(strFromU8(entries['druckwerk-backup.json'])) as typeof meta;
      } catch {
        throw fail('Die Beschreibung im Backup lässt sich nicht lesen.');
      }
      if ((meta.migration ?? 0) > latestMigration())
        throw fail('Das Backup stammt aus einer neueren Druckwerk-Version. Bitte erst updaten.');
    }
    // Backups vor der Auswahl nach Bereichen enthalten alles
    const groups = Array.isArray(meta.groups)
      ? BACKUP_GROUPS.filter((g) => (meta.groups as unknown[]).includes(g))
      : [...BACKUP_GROUPS];

    const dir = path.join(tmpdir(), `druckwerk-import-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const imported = path.join(dir, DB_NAME);
      await writeFile(imported, entries[DB_NAME]);
      try {
        const check = new Database(imported, { readonly: true });
        check.prepare('SELECT count(*) FROM sqlite_master').get();
        check.close();
        migrateFile(imported);
      } catch {
        throw fail('Die Datenbank im Backup lässt sich nicht lesen.');
      }
      await writeFile(path.join(dir, ZIP_NAME), buffer);
    } catch (e) {
      rmSync(dir, { recursive: true, force: true });
      throw e;
    }

    // Nur das zuletzt hochgeladene Backup aufheben, höchstens eine halbe Stunde
    for (const old of [...pending.keys()]) drop(old);
    const token = randomUUID();
    const timer = setTimeout(() => drop(token), 30 * 60_000);
    timer.unref();
    pending.set(token, { dir, groups, timer });
    return { token, dir, groups, createdAt: meta.createdAt ?? null };
  }

  /** Was im Backup steckt, ohne etwas einzuspielen */
  app.post('/backup/inspect', async (req): Promise<BackupInfo> => {
    const { token, dir, groups, createdAt } = await receive(req);
    const backup = new Database(path.join(dir, DB_NAME), { readonly: true });
    try {
      return {
        token,
        createdAt,
        groups: groups.map((group) => ({
          group,
          count: Object.values(
            backup.prepare(GROUP_COUNT[group].replaceAll('{db}', 'main')).get() as object,
          )[0] as number,
        })),
      };
    } finally {
      backup.close();
    }
  });

  app.post<{ Body: { token?: string; groups?: unknown } }>(
    '/backup/restore',
    async (req): Promise<BackupRestoreResult> => {
      const p = req.body?.token ? pending.get(req.body.token) : undefined;
      if (!p) throw fail('Das Backup ist nicht mehr da – bitte die Datei noch einmal wählen.');
      const groups = parseGroups(req.body.groups);
      const missing = groups.filter((g) => !p.groups.includes(g));
      if (missing.length) throw fail('Das Backup enthält nicht alle gewählten Bereiche.');
      try {
        return await restore(p.dir, groups);
      } finally {
        drop(req.body.token!);
      }
    },
  );

  /** Alles aus dem Backup in einem Schritt einspielen */
  app.post('/backup', async (req) => {
    const { token, dir, groups } = await receive(req);
    try {
      await restore(dir, groups);
    } finally {
      drop(token);
    }
    const count = (table: string) =>
      (sqlite.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n;
    return { ok: true, spools: count('filament_spools'), projects: count('projects') };
  });

  async function restore(dir: string, groups: BackupGroup[]): Promise<BackupRestoreResult> {
    const all = groups.length === BACKUP_GROUPS.length;
    if (options.safetyDir) {
      mkdirSync(options.safetyDir, { recursive: true });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
      await sqlite.backup(path.join(options.safetyDir, `vor-import-${stamp}.db`));
    }

    const before = groupFiles(sqlite, 'main', groups);
    const fixed = replaceData(path.join(dir, DB_NAME), groups);
    const after = groupFiles(sqlite, 'main', groups);

    // Dateien: bei allem den Ordner ersetzen, sonst nur die Dateien der gewählten Bereiche
    const entries = unzipSync(new Uint8Array(await readFile(path.join(dir, ZIP_NAME))));
    const old = all ? listFiles(options.uploadDir) : [...before].filter((f) => !after.has(f));
    for (const rel of old) await rm(path.join(options.uploadDir, rel), { force: true });
    for (const [name, data] of Object.entries(entries)) {
      if (!safeUpload(name)) continue;
      const rel = name.slice('uploads/'.length);
      if (!all && !after.has(rel)) continue;
      const target = path.join(options.uploadDir, ...rel.split('/'));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, data);
    }
    return { ok: true, groups, fixed };
  }

  /**
   * Die Tabellen der gewählten Bereiche mit dem Inhalt der Backup-Datenbank füllen (in einem
   * Rutsch). Verweise auf Einträge, die es danach nicht mehr gibt (z.B. ein Projekt auf einen
   * Kunden, wenn nur die Kunden eingespielt wurden), werden behandelt wie beim Löschen: geleert
   * oder der abhängige Eintrag entfällt. Gibt die Zahl dieser Korrekturen zurück.
   */
  function replaceData(file: string, groups: BackupGroup[]) {
    const columns = (dbName: string, table: string) =>
      (sqlite.prepare(`PRAGMA ${dbName}.table_info("${table}")`).all() as { name: string }[]).map(
        (c) => `"${c.name}"`,
      );

    sqlite.prepare('ATTACH DATABASE ? AS backup').run(file);
    sqlite.pragma('foreign_keys = OFF');
    try {
      return sqlite.transaction(() => {
        for (const group of groups)
          for (const { table, where } of GROUP_TABLES[group]) {
            const filter = where ? ` WHERE ${where}` : '';
            sqlite.prepare(`DELETE FROM main."${table}"${filter}`).run();
            const theirs = new Set(columns('backup', table));
            const shared = columns('main', table).filter((c) => theirs.has(c));
            if (!shared.length) continue;
            sqlite
              .prepare(
                `INSERT INTO main."${table}" (${shared.join(', ')})
                 SELECT ${shared.join(', ')} FROM backup."${table}"${filter}`,
              )
              .run();
          }
        const fixed = fixReferences();
        if (
          options.supervisorToken &&
          !db.select().from(schema.haConnections).where(eq(schema.haConnections.local, true)).get()
        )
          db.insert(schema.haConnections)
            .values({ name: 'Home Assistant', url: SUPERVISOR_URL, token: '', local: true })
            .run();
        return fixed;
      })();
    } finally {
      sqlite.pragma('foreign_keys = ON');
      sqlite.exec('DETACH DATABASE backup');
    }
  }

  /** Fehlende Verweise wie ON DELETE auflösen; Verweise ohne solche Regel → Backup unvollständig */
  function fixReferences() {
    let fixed = 0;
    for (let round = 0; round < 10; round++) {
      const broken = sqlite.pragma('main.foreign_key_check') as {
        table: string;
        rowid: number;
        fkid: number;
      }[];
      if (!broken.length) return fixed;
      for (const b of broken) {
        const fk = (
          sqlite.prepare(`PRAGMA main.foreign_key_list("${b.table}")`).all() as {
            id: number;
            from: string;
            on_delete: string;
          }[]
        ).filter((f) => f.id === b.fkid);
        const action = fk[0]?.on_delete;
        if (action === 'SET NULL')
          sqlite
            .prepare(
              `UPDATE main."${b.table}" SET ${fk.map((f) => `"${f.from}" = NULL`).join(', ')}
               WHERE rowid = ?`,
            )
            .run(b.rowid);
        else if (action === 'CASCADE')
          sqlite.prepare(`DELETE FROM main."${b.table}" WHERE rowid = ?`).run(b.rowid);
        else throw fail('Das Backup ist unvollständig (Verweise fehlen).');
        fixed++;
      }
    }
    throw fail('Das Backup ist unvollständig (Verweise fehlen).');
  }
}
