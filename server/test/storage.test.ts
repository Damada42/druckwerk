import { storagePaths, type StorageLocation } from '@3dapp/shared';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

let app: Awaited<ReturnType<typeof buildApp>>['app'];
let uploadDir: string;

beforeEach(async () => {
  uploadDir = mkdtempSync(path.join(tmpdir(), '3dapp-test-'));
  ({ app } = await buildApp({ dbFile: ':memory:', uploadDir }));
});

afterEach(async () => {
  await app.close();
  rmSync(uploadDir, { recursive: true, force: true });
});

async function send<T>(method: 'POST' | 'PUT', url: string, payload: object) {
  const res = await app.inject({ method, url, payload });
  return { status: res.statusCode, body: res.json() as T };
}

const place = (name: string, parentId?: number) =>
  send<StorageLocation>('POST', '/api/storage-locations', { name, parentId });

describe('Einstellungen', () => {
  it('hat die Lagerplätze anfangs aus und merkt sich den Schalter', async () => {
    expect((await app.inject('/api/settings')).json()).toEqual({
      storageLocations: false,
      lowStockGroup: 'manufacturer',
    });
    const res = await send('PUT', '/api/settings', { storageLocations: true, fremd: 1 });
    expect(res.body).toEqual({ storageLocations: true, lowStockGroup: 'manufacturer' });
    expect((await app.inject('/api/settings')).json()).toEqual({
      storageLocations: true,
      lowStockGroup: 'manufacturer',
    });
    expect((await send('PUT', '/api/settings', { storageLocations: 'ja' })).status).toBe(400);
  });
});

describe('Lagerplätze', () => {
  it('baut einen Baum und zeigt Pfade', async () => {
    const regal = (await place('Wandregal')).body;
    const links = (await place('Links', regal.id)).body;
    await place('Reihe 1', links.id);
    const r2 = (await place('Reihe 2', links.id)).body;
    expect(r2.position).toBe(1);
    const list = (await app.inject('/api/storage-locations')).json() as StorageLocation[];
    expect(storagePaths(list).get(r2.id)).toBe('Wandregal › Links › Reihe 2');
  });

  it('sortiert Geschwister um', async () => {
    const regal = (await place('Schrank')).body;
    const a = (await place('Oben', regal.id)).body;
    const b = (await place('Unten', regal.id)).body;
    const res = await app.inject({
      method: 'PUT',
      url: '/api/storage-locations/order',
      payload: { ids: [b.id, a.id] },
    });
    expect(res.statusCode).toBe(204);
    const list = (await app.inject('/api/storage-locations')).json() as StorageLocation[];
    expect(list.find((l) => l.id === b.id)?.position).toBe(0);
    // Plätze aus verschiedenen Ebenen lassen sich nicht gemeinsam sortieren
    const bad = await app.inject({
      method: 'PUT',
      url: '/api/storage-locations/order',
      payload: { ids: [regal.id, a.id] },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('verhindert Kreise und leere Namen', async () => {
    const regal = (await place('Wandregal')).body;
    const links = (await place('Links', regal.id)).body;
    const res = await send('PUT', `/api/storage-locations/${regal.id}`, { parentId: links.id });
    expect(res.status).toBe(400);
    expect((await place('  ')).status).toBe(400);
    expect((await place('X', 999)).status).toBe(400);
  });

  it('löscht Unterplätze mit, Spulen behalten sich selbst', async () => {
    const regal = (await place('Wandregal')).body;
    const reihe = (await place('Reihe 1', regal.id)).body;
    const spool = await send<{ id: number; storageLocationId: number }>('POST', '/api/spools', {
      typeId: 1,
      manufacturer: 'Sunlu',
      colorName: 'Grau',
      storageLocationId: reihe.id,
    });
    expect(spool.body.storageLocationId).toBe(reihe.id);
    const del = await app.inject({ method: 'DELETE', url: `/api/storage-locations/${regal.id}` });
    expect(del.statusCode).toBe(204);
    expect((await app.inject('/api/storage-locations')).json()).toEqual([]);
    const after = (await app.inject(`/api/spools/${spool.body.id}`)).json();
    expect(after.storageLocationId).toBeNull();
  });
});
