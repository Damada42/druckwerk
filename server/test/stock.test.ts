import {
  lowStock,
  type FilamentSpool,
  type FilamentType,
  type Finish,
  type BackupInfo,
  type Manufacturer,
} from '@3dapp/shared';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { GROUP_TABLES } from '../src/routes/backup.js';

let app: Awaited<ReturnType<typeof buildApp>>['app'];
let db: Awaited<ReturnType<typeof buildApp>>['db'];
let dir: string;
let uploadDir: string;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), '3dapp-stock-'));
  uploadDir = path.join(dir, 'uploads');
  ({ app, db } = await buildApp({ dbFile: path.join(dir, '3dapp.db'), uploadDir }));
});

afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

async function send<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
  const res = await app.inject({ method, url, payload });
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
}

const spool = (over: Partial<FilamentSpool>): FilamentSpool => ({
  id: 1,
  typeId: 1,
  manufacturer: 'Bambu Lab',
  colorName: 'Schwarz',
  colorHex: '#000000',
  finishId: null,
  diameter: 1.75,
  weightTotalG: 1000,
  weightRemainingG: 1000,
  price: null,
  purchaseDate: null,
  location: null,
  storageLocationId: null,
  haTrayEntity: null,
  barcode: null,
  notes: null,
  minStockG: null,
  createdAt: '',
  ...over,
});
const types: FilamentType[] = [
  { id: 1, name: 'PLA', description: null, minStockG: 200 },
  { id: 2, name: 'PETG', description: null, minStockG: 500 },
];
const finishes: Finish[] = [{ id: 1, name: 'Normal' }];

describe('Filament wird knapp', () => {
  it('zählt je Hersteller oder nur je Farbe zusammen', () => {
    const spools = [
      spool({ id: 1, manufacturer: 'Sunlu', weightRemainingG: 800 }),
      spool({ id: 2, weightRemainingG: 150 }),
      spool({ id: 3, weightRemainingG: 30 }),
    ];
    // Beide Bambu-Spulen sind eine Sorte (180 g), Sunlu reicht
    const byManufacturer = lowStock(spools, types, finishes, 'manufacturer');
    expect(byManufacturer.map((g) => [g.manufacturers, g.remaining, g.spools.length])).toEqual([
      [['Bambu Lab'], 180, 2],
    ]);
    // Nach Farbe: 800 + 150 + 30 g Schwarz reichen
    expect(lowStock(spools, types, finishes, 'color')).toEqual([]);
    // Genau an der Grenze ist noch nicht knapp
    expect(lowStock([spool({ weightRemainingG: 200 })], types, finishes)).toEqual([]);
  });

  it('nimmt die Vorgabe des Typs, sonst die eigene Mindestmenge der Sorte', () => {
    const spools = [
      spool({ id: 1, typeId: 2, colorName: 'Orange', weightRemainingG: 400 }),
      spool({ id: 2, colorName: 'Weiß', weightRemainingG: 400, minStockG: 600 }),
      spool({ id: 3, colorName: 'Rot', weightRemainingG: 100, minStockG: 0 }),
    ];
    const low = lowStock(spools, types, finishes);
    expect(low.map((g) => [g.colorName, g.minStockG])).toEqual([
      ['Weiß', 600],
      ['Orange', 500],
    ]);
    // Finish „Normal“ und kein Finish sind dieselbe Sorte
    expect(
      lowStock(
        [spool({ weightRemainingG: 100 }), spool({ id: 2, finishId: 1, weightRemainingG: 150 })],
        types,
        finishes,
      ),
    ).toEqual([]);
  });

  it('Mindestmenge am Typ, an der Sorte und in der Übersicht', async () => {
    const [pla] = (await send<FilamentType[]>('GET', '/api/filament-types')).body;
    expect(pla.minStockG).toBe(200);
    expect(
      (await send<FilamentType>('PUT', `/api/filament-types/${pla.id}`, { minStockG: '300' })).body
        .minStockG,
    ).toBe(300);
    expect((await send('PUT', `/api/filament-types/${pla.id}`, { minStockG: -5 })).status).toBe(
      400,
    );

    const base = { typeId: pla.id, manufacturer: 'bambu lab', colorName: 'Schwarz' };
    const first = await send<FilamentSpool>('POST', '/api/spools', {
      ...base,
      weightRemainingG: 250,
    });
    // Hersteller in der Schreibweise der Liste
    expect(first.body.manufacturer).toBe('Bambu Lab');
    expect((await send<{ lowSpools: number }>('GET', '/api/stats')).body.lowSpools).toBe(1);

    // Eigene Mindestmenge der Sorte; neue Spulen derselben Sorte übernehmen sie
    await send('POST', '/api/spools/bulk-update', {
      ids: [first.body.id],
      data: { minStockG: 100 },
    });
    const second = await send<FilamentSpool>('POST', '/api/spools', {
      ...base,
      colorName: 'schwarz ',
    });
    expect(second.body.minStockG).toBe(100);
    expect((await send<{ lowSpools: number }>('GET', '/api/stats')).body.lowSpools).toBe(0);
  });

  it('merkt sich, wie zusammengezählt wird', async () => {
    const res = await send<{ lowStockGroup: string }>('PUT', '/api/settings', {
      lowStockGroup: 'color',
    });
    expect(res.body.lowStockGroup).toBe('color');
    expect((await send('PUT', '/api/settings', { lowStockGroup: 'typ' })).status).toBe(400);
  });
});

describe('Herstellerliste', () => {
  it('bringt gängige Hersteller mit, verhindert doppelte und benennt Spulen mit um', async () => {
    const list = (await send<Manufacturer[]>('GET', '/api/manufacturers')).body;
    expect(list.map((m) => m.name)).toContain('Bambu Lab');
    expect((await send('POST', '/api/manufacturers', { name: ' SUNLU ' })).status).toBe(409);
    const created = await send<Manufacturer>('POST', '/api/manufacturers', { name: 'Ziro' });
    expect(created.status).toBe(201);

    const [pla] = (await send<FilamentType[]>('GET', '/api/filament-types')).body;
    const s = await send<FilamentSpool>('POST', '/api/spools', {
      typeId: pla.id,
      manufacturer: 'ziro',
      colorName: 'Grau',
    });
    expect(s.body.manufacturer).toBe('Ziro');
    const del = await send<{ error: string }>('DELETE', `/api/manufacturers/${created.body.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error).toMatch(/1 Spule/);

    await send('PUT', `/api/manufacturers/${created.body.id}`, { name: 'Ziro Pro' });
    expect((await send<FilamentSpool>('GET', `/api/spools/${s.body.id}`)).body.manufacturer).toBe(
      'Ziro Pro',
    );
    expect(
      (await send('PUT', `/api/manufacturers/${created.body.id}`, { name: 'bambu lab' })).status,
    ).toBe(409);

    // Unbekannter Hersteller (z.B. aus dem Scan) kommt in die Liste
    await send('POST', '/api/spools', {
      typeId: pla.id,
      manufacturer: 'Kexcelled',
      colorName: 'Rot',
    });
    const after = (await send<Manufacturer[]>('GET', '/api/manufacturers')).body;
    expect(after.map((m) => m.name)).toContain('Kexcelled');
  });
});

function multipart(name: string, data: Uint8Array) {
  const boundary = '----backup';
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n` +
          'Content-Type: application/zip\r\n\r\n',
      ),
      Buffer.from(data),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

describe('Backup', () => {
  it('exportiert Datenbank und Dateien und spielt sie wieder ein', async () => {
    const customer = await send<{ id: number }>('POST', '/api/customers', { name: 'Erika' });
    writeFileSync(path.join(uploadDir, 'beleg.pdf'), '%PDF-1.4 test');

    const res = await app.inject('/api/backup');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/druckwerk-backup-\d+\.zip/);
    const zip = new Uint8Array(res.rawPayload);
    expect(Object.keys(unzipSync(zip))).toEqual(
      expect.arrayContaining(['3dapp.db', 'uploads/beleg.pdf', 'druckwerk-backup.json']),
    );

    // Danach geändert: der Import stellt den Stand des Backups wieder her
    await send('DELETE', `/api/customers/${customer.body.id}`);
    await send('POST', '/api/customers', { name: 'Neu' });
    writeFileSync(path.join(uploadDir, 'neu.pdf'), 'x');

    const imported = await app.inject({
      method: 'POST',
      url: '/api/backup',
      ...multipart('b.zip', zip),
    });
    expect(imported.statusCode).toBe(200);
    const customers = (await send<{ id: number; name: string }[]>('GET', '/api/customers')).body;
    expect(customers).toEqual([expect.objectContaining({ id: customer.body.id, name: 'Erika' })]);
    expect(readdirSync(uploadDir)).toEqual(['beleg.pdf']);
    // Sicherheitskopie des vorherigen Stands
    expect(readdirSync(path.join(dir, 'backup'))[0]).toMatch(/^vor-import-\d+\.db$/);
    // Neue Einträge bekommen weiter eindeutige Nummern
    const next = await send<{ id: number }>('POST', '/api/customers', { name: 'Danach' });
    expect(next.status).toBe(201);
  });

  it('lehnt fremde Dateien und Backups neuerer Versionen ab', async () => {
    const notZip = await app.inject({
      method: 'POST',
      url: '/api/backup',
      ...multipart('x.zip', strToU8('kein zip')),
    });
    expect(notZip.statusCode).toBe(400);

    const noDb = zipSync({ 'readme.txt': strToU8('hallo') });
    const res = await app.inject({
      method: 'POST',
      url: '/api/backup',
      ...multipart('x.zip', noDb),
    });
    expect(res.json().error).toMatch(/Datenbank/);

    const zip = unzipSync(new Uint8Array((await app.inject('/api/backup')).rawPayload));
    zip['druckwerk-backup.json'] = strToU8(JSON.stringify({ migration: Date.now() * 2 }));
    const newer = await app.inject({
      method: 'POST',
      url: '/api/backup',
      ...multipart('x.zip', zipSync(zip)),
    });
    expect(newer.statusCode).toBe(400);
    expect(newer.json().error).toMatch(/neueren/);
    expect(existsSync(path.join(dir, 'backup'))).toBe(false);
  });
  it('sichert nur gewählte Bereiche und zeigt vor dem Einspielen, was drin ist', async () => {
    const customer = await send<{ id: number }>('POST', '/api/customers', { name: 'Erika' });
    await send('POST', '/api/persons', { name: 'Toni' });
    await send('PUT', '/api/company', { name: 'Testwerk' });

    const res = await app.inject('/api/backup?groups=customers,company');
    expect(res.headers['content-disposition']).toMatch(/druckwerk-backup-teil-\d+\.zip/);
    const zip = new Uint8Array(res.rawPayload);
    const meta = JSON.parse(strFromU8(unzipSync(zip)['druckwerk-backup.json']));
    expect(meta.groups).toEqual(['customers', 'company']);

    const inspect = await app.inject({
      method: 'POST',
      url: '/api/backup/inspect',
      ...multipart('teil.zip', zip),
    });
    expect(inspect.statusCode).toBe(200);
    const info = inspect.json<BackupInfo>();
    expect(info.groups).toEqual([
      { group: 'customers', count: 1 },
      { group: 'company', count: 1 },
    ]);

    // Nicht enthaltene Bereiche lassen sich nicht einspielen
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/backup/restore',
      payload: { token: info.token, groups: ['team'] },
    });
    expect(wrong.statusCode).toBe(400);

    // Danach geändert: nur die Kunden zurückholen, Firmendaten und Team bleiben wie jetzt
    await send('DELETE', `/api/customers/${customer.body.id}`);
    await send('PUT', '/api/company', { name: 'Neuer Name' });
    await send('POST', '/api/persons', { name: 'Vroni' });
    const restored = await app.inject({
      method: 'POST',
      url: '/api/backup/restore',
      payload: { token: info.token, groups: ['customers'] },
    });
    expect(restored.json()).toMatchObject({ ok: true, groups: ['customers'] });
    expect(
      (await send<{ name: string }[]>('GET', '/api/customers')).body.map((c) => c.name),
    ).toEqual(['Erika']);
    expect((await send<{ name: string }[]>('GET', '/api/persons')).body).toHaveLength(2);
    expect((await send<{ name: string }>('GET', '/api/company')).body.name).toBe('Neuer Name');

    // Das Backup wird nach dem Einspielen verworfen
    const again = await app.inject({
      method: 'POST',
      url: '/api/backup/restore',
      payload: { token: info.token, groups: ['customers'] },
    });
    expect(again.json().error).toMatch(/nicht mehr da/);
  });

  it('löst beim teilweisen Einspielen Verweise auf, die es nicht mehr gibt', async () => {
    const zip = new Uint8Array((await app.inject('/api/backup?groups=customers,team')).rawPayload);
    const customer = await send<{ id: number }>('POST', '/api/customers', { name: 'Später' });
    const person = await send<{ id: number }>('POST', '/api/persons', { name: 'Später' });
    const project = await send<{ id: number }>('POST', '/api/projects', {
      title: 'Halter',
      customerId: customer.body.id,
      members: [{ personId: person.body.id, role: 'team' }],
    });

    const info = (
      await app.inject({ method: 'POST', url: '/api/backup/inspect', ...multipart('b.zip', zip) })
    ).json<BackupInfo>();
    const res = await app.inject({
      method: 'POST',
      url: '/api/backup/restore',
      payload: { token: info.token, groups: ['customers', 'team'] },
    });
    expect(res.json()).toMatchObject({ ok: true, fixed: 2 });
    const after = (
      await send<{ customerId: number | null; members: unknown[] }>(
        'GET',
        `/api/projects/${project.body.id}`,
      )
    ).body;
    expect(after.customerId).toBeNull();
    expect(after.members).toEqual([]);
  });

  it('ordnet jede Tabelle einem Bereich zu', () => {
    const tables = (
      db.$client
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations'`,
        )
        .all() as { name: string }[]
    ).map((t) => t.name);
    const mapped = new Set(
      Object.values(GROUP_TABLES).flatMap((parts) => parts.map((p) => p.table)),
    );
    expect(tables.filter((t) => !mapped.has(t))).toEqual([]);
  });
});
