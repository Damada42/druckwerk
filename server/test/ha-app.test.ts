import type { HaCameraList, HaStatus } from '@3dapp/shared';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { FAKE_TOKEN, FakeHa, type RawEntity } from './fake-ha.js';

const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/bambu-p1s.json', import.meta.url), 'utf8'),
) as RawEntity[];

const INGRESS = '/api/hassio_ingress/AbC-123_xyz';
/** Anfragen kommen in der HA-App über das Ingress-Gateway des Supervisors */
const GATEWAY = '172.30.32.2';

let dir: string;
let built: Awaited<ReturnType<typeof buildApp>> | undefined;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), '3dapp-app-'));
  writeFileSync(
    path.join(dir, 'index.html'),
    '<!doctype html><html><head><base href="/" /><script src="./assets/app.js"></script></head></html>',
  );
});

afterEach(async () => {
  await built?.app.close();
  built = undefined;
  rmSync(dir, { recursive: true, force: true });
});

async function build(options: { supervisorToken?: string; dbFile?: string } = {}) {
  const ha = new FakeHa(FIXTURE);
  built = await buildApp({
    dbFile: options.dbFile ?? ':memory:',
    uploadDir: path.join(dir, 'uploads'),
    clientDir: dir,
    haFetch: ha.fetch,
    supervisorToken: options.supervisorToken,
  });
  return built.app;
}

describe('Oberfläche unter Home-Assistant-Ingress', () => {
  it('setzt <base href> auf den Ingress-Pfad, auch bei Unterseiten', async () => {
    const app = await build();
    const page = async (url: string, ingress?: string) => {
      const res = await app.inject({
        url,
        headers: ingress ? { 'x-ingress-path': ingress } : {},
      });
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['cache-control']).toBe('no-cache');
      return /<base href="([^"]*)" \/>/.exec(res.body)?.[1];
    };
    expect(await page('/')).toBe('/');
    expect(await page('/drucker')).toBe('/');
    expect(await page('/', INGRESS)).toBe(`${INGRESS}/`);
    expect(await page('/projekte/3', INGRESS)).toBe(`${INGRESS}/`);
    // Fremde Pfade werden nicht übernommen
    expect(await page('/', '/x"><script>')).toBe('/');
    expect(await page('/', 'https://evil.test/api/hassio_ingress/a')).toBe('/');

    const api = await app.inject({ url: '/api/gibt-es-nicht' });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ error: 'Nicht gefunden' });
  });
});

describe('Als Home-Assistant-App (SUPERVISOR_TOKEN)', () => {
  it('nimmt Anfragen nur vom Ingress-Gateway und vom Healthcheck an', async () => {
    const app = await build({ supervisorToken: FAKE_TOKEN });
    const from = (remoteAddress: string) =>
      app.inject({ url: '/api/health', remoteAddress }).then((r) => r.statusCode);
    expect(await from(GATEWAY)).toBe(200);
    expect(await from('127.0.0.1')).toBe(200);
    expect(await from('192.168.1.50')).toBe(403);
    const page = await app.inject({ url: '/', remoteAddress: '192.168.1.50' });
    expect(page.json()).toEqual({ error: 'Nur über Home Assistant erreichbar.' });
  });

  it('ohne App bleibt der Server für alle erreichbar', async () => {
    const app = await build();
    const res = await app.inject({ url: '/api/health', remoteAddress: '192.168.1.50' });
    expect(res.statusCode).toBe(200);
  });

  it('verbindet sich automatisch mit dem eigenen Home Assistant', async () => {
    const app = await build({ supervisorToken: FAKE_TOKEN });
    const get = <T>(url: string) =>
      app.inject({ url, remoteAddress: GATEWAY }).then((r) => r.json() as T);

    const status = await get<HaStatus>('/api/ha/status');
    expect(status.connections).toEqual([
      expect.objectContaining({
        name: 'Home Assistant',
        url: 'Dieses Home Assistant (App)',
        local: true,
        ok: true,
        printers: [expect.objectContaining({ name: 'the_one', location: 'Home Assistant' })],
      }),
    ]);
    expect(JSON.stringify(status)).not.toContain('supervisor');
    expect((await get<HaCameraList>('/api/ha/cameras')).cameras).toHaveLength(3);

    // Umbenennen geht, Adresse/Token werden ignoriert, Trennen nicht
    const rename = await app.inject({
      method: 'PUT',
      url: '/api/ha/connections/1',
      payload: { name: 'Zuhause', url: 'http://anders.test', token: 'x' },
      remoteAddress: GATEWAY,
    });
    expect(rename.statusCode).toBe(204);
    expect((await get<HaStatus>('/api/ha/status')).connections[0]).toMatchObject({
      name: 'Zuhause',
      ok: true,
    });
    const remove = await app.inject({
      method: 'DELETE',
      url: '/api/ha/connections/1',
      remoteAddress: GATEWAY,
    });
    expect(remove.statusCode).toBe(400);

    // Weitere Instanz wie gewohnt mit Adresse und Token
    const second = await app.inject({
      method: 'POST',
      url: '/api/ha/connections',
      payload: { name: 'Werkstatt', url: 'werkstatt.test:8123', token: FAKE_TOKEN },
      remoteAddress: GATEWAY,
    });
    expect(second.statusCode).toBe(201);
    expect((await get<HaStatus>('/api/ha/status')).connections.map((c) => c.local)).toEqual([
      true,
      false,
    ]);
  });

  it('legt die lokale Verbindung nur einmal an; ohne App meldet sie einen Fehler', async () => {
    const dbFile = path.join(dir, 'app.db');
    await build({ supervisorToken: FAKE_TOKEN, dbFile });
    await built!.app.close();
    await build({ supervisorToken: FAKE_TOKEN, dbFile });
    const again = await built!.app.inject({ url: '/api/ha/status', remoteAddress: GATEWAY });
    expect((again.json() as HaStatus).connections).toHaveLength(1);
    await built!.app.close();

    // Daten aus der App in den Docker-Betrieb umgezogen: kein Supervisor mehr
    const app = await build({ dbFile });
    const status = (await app.inject({ url: '/api/ha/status' })).json() as HaStatus;
    expect(status.connections[0]).toMatchObject({
      ok: false,
      error: '„Home Assistant“ geht nur, wenn Druckwerk als Home-Assistant-App läuft.',
    });
    // Dann lässt sie sich entfernen
    const remove = await app.inject({ method: 'DELETE', url: '/api/ha/connections/1' });
    expect(remove.statusCode).toBe(204);
  });
});
