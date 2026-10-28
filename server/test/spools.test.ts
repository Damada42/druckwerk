import type { FilamentSpool } from '@3dapp/shared';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

let app: Awaited<ReturnType<typeof buildApp>>['app'];
let uploadDir: string;

beforeEach(async () => {
  uploadDir = mkdtempSync(path.join(tmpdir(), '3dapp-spools-'));
  ({ app } = await buildApp({ dbFile: ':memory:', uploadDir }));
});

afterEach(async () => {
  await app.close();
  rmSync(uploadDir, { recursive: true, force: true });
});

async function send<T>(method: 'GET' | 'POST', url: string, payload?: object) {
  const res = await app.inject({ method, url, payload });
  return { status: res.statusCode, body: res.json() as T };
}

const spool = (extra: object) =>
  send<FilamentSpool>('POST', '/api/spools', {
    typeId: 1,
    manufacturer: 'Bambu Lab',
    colorName: 'Weiß',
    colorHex: '#ffffff',
    weightTotalG: 1000,
    price: 20,
    ...extra,
  });

describe('Sorte auf einmal bearbeiten', () => {
  it('ändert gemeinsame Angaben aller Spulen, Restmenge und Lagerort bleiben je Spule', async () => {
    const a = (await spool({ weightRemainingG: 1000, location: 'AMS Slot 4' })).body;
    const b = (await spool({ weightRemainingG: 840, location: 'AMS Slot 2' })).body;
    const other = (await spool({ colorName: 'Schwarz' })).body;

    const res = await send<FilamentSpool[]>('POST', '/api/spools/bulk-update', {
      ids: [a.id, b.id],
      data: {
        price: 24.99,
        colorName: 'Jade Weiß',
        // Nicht gemeinsam: wird ignoriert
        weightRemainingG: 1,
        location: 'Regal',
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.map((s) => [s.price, s.colorName, s.weightRemainingG, s.location])).toEqual([
      [24.99, 'Jade Weiß', 1000, 'AMS Slot 4'],
      [24.99, 'Jade Weiß', 840, 'AMS Slot 2'],
    ]);
    // Andere Sorte unberührt
    expect((await send<FilamentSpool>('GET', `/api/spools/${other.id}`)).body.price).toBe(20);
  });

  it('kleineres Spulengewicht kappt die Restmenge; Pflichtfelder dürfen nicht leer werden', async () => {
    const a = (await spool({ weightRemainingG: 1000 })).body;
    const b = (await spool({ weightRemainingG: 300 })).body;
    const res = await send<FilamentSpool[]>('POST', '/api/spools/bulk-update', {
      ids: [a.id, b.id],
      data: { weightTotalG: 750 },
    });
    expect(res.body.map((s) => s.weightRemainingG)).toEqual([750, 300]);

    const empty = await send('POST', '/api/spools/bulk-update', {
      ids: [a.id],
      data: { manufacturer: '' },
    });
    expect(empty.status).toBe(400);
    expect(
      (await send('POST', '/api/spools/bulk-update', { ids: [], data: { price: 1 } })).status,
    ).toBe(400);
  });
});
