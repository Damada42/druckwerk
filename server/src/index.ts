import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';

const dataDir = process.env.DATA_DIR ?? fileURLToPath(new URL('../data', import.meta.url));
mkdirSync(dataDir, { recursive: true });

// Eigene Variable statt PORT, damit Dev-Tools (die PORT für Vite setzen) nicht kollidieren
const port = Number(process.env.API_PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

const { app } = await buildApp({
  dbFile: `${dataDir}/3dapp.db`,
  uploadDir: `${dataDir}/uploads`,
  clientDir:
    process.env.NODE_ENV === 'production'
      ? fileURLToPath(new URL('../../client/dist', import.meta.url))
      : undefined,
  logger: true,
});

await app.listen({ port, host });
