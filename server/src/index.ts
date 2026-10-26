import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { ensureCert } from './cert.js';

const dataDir = process.env.DATA_DIR ?? fileURLToPath(new URL('../data', import.meta.url));
mkdirSync(dataDir, { recursive: true });

// Eigene Variable statt PORT, damit Dev-Tools (die PORT für Vite setzen) nicht kollidieren
const port = Number(process.env.API_PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
// HTTPS ist Standard: nur damit gibt der Handy-Browser die Live-Kamera frei
const useHttps = process.env.HTTPS !== 'false';
const tls = useHttps ? await ensureCert(`${dataDir}/certs`) : undefined;

const { app } = await buildApp({
  dbFile: `${dataDir}/3dapp.db`,
  uploadDir: `${dataDir}/uploads`,
  clientDir:
    process.env.NODE_ENV === 'production'
      ? fileURLToPath(new URL('../../client/dist', import.meta.url))
      : undefined,
  logger: true,
  clientLogFile: `${dataDir}/client-log.jsonl`,
  // Während eines Drucks merkt sich der Server alle 20 s den aktiven AMS-Slot
  haPollMs: Number(process.env.HA_POLL_MS ?? 20_000),
  trustProxy: process.env.TRUST_PROXY === 'true',
  https: tls && { key: tls.key, cert: tls.cert },
});

await app.listen({ port, host });

if (tls) {
  const urls = tls.hosts.filter((h) => h !== '127.0.0.1').map((h) => `https://${h}:${port}`);
  app.log.info(`Erreichbar unter: ${urls.join('  ')}`);
}
