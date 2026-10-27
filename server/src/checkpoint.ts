// Vor einem Home-Assistant-Backup (backup_pre in ha-app/config.yaml): Änderungen aus der
// WAL-Datei in die Datenbank schreiben, damit die gesicherte 3dapp.db vollständig ist.
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';

const dataDir = process.env.DATA_DIR ?? fileURLToPath(new URL('../data', import.meta.url));
const db = new Database(`${dataDir}/3dapp.db`);
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
