// Daten für den Umzug (z.B. in den Docker-Container) exportieren: Datenbank als konsistente
// Kopie – geht auch, während der Server läuft – plus alle hochgeladenen Rechnungen.
// Aufruf: npm run export -w server  →  server/data/export/druckwerk-<Datum>/
import Database from 'better-sqlite3';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = process.env.DATA_DIR ?? fileURLToPath(new URL('../data', import.meta.url));
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const target = path.join(dataDir, 'export', `druckwerk-${stamp}`);
mkdirSync(target, { recursive: true });

const db = new Database(path.join(dataDir, '3dapp.db'), { readonly: true });
await db.backup(path.join(target, '3dapp.db'));
db.close();

const uploads = path.join(dataDir, 'uploads');
if (existsSync(uploads)) cpSync(uploads, path.join(target, 'uploads'), { recursive: true });

console.log(`Export fertig: ${target}`);
console.log('Inhalt dieses Ordners ins Daten-Volume des Containers (/data) kopieren.');
