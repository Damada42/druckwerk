import {
  parsePrinterLive,
  type FilamentBooking,
  type FilamentSpool,
  type HaEntity,
  type HaMmuEntity,
  type Printer,
  type PrinterLive,
  type PrinterLiveResponse,
} from '@3dapp/shared';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { printerTemplate } from '../src/ha/client.js';
import { FAKE_TOKEN, FakeHa, type RawEntity } from './fake-ha.js';

// Klipper-Drucker (A20-Fixture) mit einer MMU wie beim Elwms: Moonraker meldet je Gate einen
// Filamentsensor am Eingang, Happy Hare die Gate-Daten über einen REST-Sensor (Zusatz-Entity)
const A20 = JSON.parse(
  readFileSync(new URL('./fixtures/klipper-a20.json', import.meta.url), 'utf8'),
) as RawEntity[];
const P1S = JSON.parse(
  readFileSync(new URL('./fixtures/bambu-p1s.json', import.meta.url), 'utf8'),
) as RawEntity[];
const DEVICE = 'klipper-a20';
const USED = 'sensor.a20_filament_used';
const MMU = 'sensor.a20_mmu';
const gate = (n: number) => `${USED}#${n}`;

/** Gate-Sensoren wie beim Elwms: pre_gate und entry je Gate, am Drucker-Gerät */
function gateSensors(states: string[]): RawEntity[] {
  return states.flatMap((s, i) => [
    {
      e: `binary_sensor.a20_mmu_pre_gate_${i}`,
      s,
      a: {},
      d: DEVICE,
      v: null,
      n: 'A20',
      m: 'Klipper',
      p: 'moonraker',
    },
    {
      e: `binary_sensor.3d_drucker_a20_mmu_entry_${i}`,
      s,
      a: {},
      d: DEVICE,
      v: null,
      n: 'A20',
      m: 'Klipper',
      p: 'moonraker',
    },
  ]);
}

/** REST-Sensor auf printer/objects/query?mmu (Happy Hare), kein Gerät */
const happyHare = (attributes: Record<string, unknown>): RawEntity => ({
  e: MMU,
  s: 'Idle',
  a: {
    num_gates: 4,
    gate: -1,
    filament: 'Unloaded',
    gate_status: [1, 0, 2, -1],
    gate_material: ['Pla', '', 'PETG', 'ABS'],
    gate_color: ['ffff00', '', '#FF0000', 'ff00ff80'],
    gate_filament_name: ['Unbekannt', '', 'eSun PETG', ''],
    ...attributes,
  },
  d: null,
  v: null,
  n: null,
  m: null,
  p: 'extra',
});

const toEntities = (raw: RawEntity[], connectionId = 1): HaEntity[] =>
  raw.map((r) => ({
    entityId: r.e,
    state: r.s,
    attributes: r.a,
    deviceId: r.d,
    viaDeviceId: r.v,
    deviceName: r.n,
    model: r.m,
    platform: r.p ?? 'bambu_lab',
    connectionId,
  }));

describe('Klipper-MMU im Live-Status', () => {
  it('erkennt die Gates an den Filamentsensoren von Moonraker', () => {
    const live = parsePrinterLive(
      toEntities([...A20, ...gateSensors(['on', 'off', 'on', 'unavailable'])]),
      DEVICE,
    );
    expect(live.ams.map((s) => [s.entityId, s.label, s.empty, s.active])).toEqual([
      [gate(0), 'Gate 0', false, false],
      [gate(1), 'Gate 1', true, false],
      [gate(2), 'Gate 2', false, false],
      // Unbekannt zählt nicht als leer
      [gate(3), 'Gate 3', false, false],
    ]);
    expect(live.mmu).toEqual({
      gates: 4,
      source: 'sensors',
      entityFound: null,
      activeKnown: false,
    });
  });

  it('nimmt die Anzahl von Hand, auch ohne Sensoren; eins heißt: keine MMU', () => {
    expect(
      parsePrinterLive(toEntities(A20), DEVICE, { slotCount: 3 }).ams.map((s) => s.label),
    ).toEqual(['Gate 0', 'Gate 1', 'Gate 2']);
    const single = parsePrinterLive(toEntities([...A20, ...gateSensors(['on', 'on'])]), DEVICE, {
      slotCount: 1,
    });
    expect(single.ams).toEqual([expect.objectContaining({ entityId: USED, label: 'Spule' })]);
    expect(single.mmu).toBeNull();
    // Ohne AMS/MMU-Haken (umgebaut): ein Platz, auch wenn Sensoren und Anzahl Gates melden
    const off = parsePrinterLive(toEntities([...A20, ...gateSensors(['on', 'on'])]), DEVICE, {
      hasAms: false,
      slotCount: 4,
    });
    expect(off.ams).toEqual([expect.objectContaining({ entityId: USED, label: 'Spule' })]);
    expect(off.mmu).toBeNull();
  });

  it('liest Material, Farbe, Name und das aktive Gate aus der Zusatz-Entity (Happy Hare)', () => {
    const raw = [
      ...A20,
      ...gateSensors(['on', 'on', 'on', 'on']),
      happyHare({ gate: 2, filament: 'Loaded' }),
    ];
    const live = parsePrinterLive(toEntities(raw), DEVICE, { mmuEntity: MMU });
    expect(live.mmu).toEqual({ gates: 4, source: 'entity', entityFound: true, activeKnown: true });
    expect(live.ams).toEqual([
      expect.objectContaining({
        label: 'Gate 0',
        type: 'PLA',
        color: '#ffff00',
        name: 'Unbekannt',
        empty: false,
        active: false,
      }),
      // gate_status 0 = leer, auch wenn der Sensor „on“ meldet
      expect.objectContaining({ label: 'Gate 1', type: null, color: null, empty: true }),
      expect.objectContaining({
        label: 'Gate 2',
        type: 'PETG',
        color: '#ff0000',
        name: 'eSun PETG',
        active: true,
      }),
      expect.objectContaining({
        label: 'Gate 3',
        type: 'ABS',
        color: '#ff00ff',
        name: null,
        empty: false,
      }),
    ]);
  });

  it('nimmt die Zusatz-Entity nur vom Standort des Druckers und nur, wenn eingetragen', () => {
    const local = [...A20, ...gateSensors(['on', 'on'])];
    const other = toEntities([happyHare({})], 2);
    const live = parsePrinterLive([...toEntities(local), ...other], DEVICE, { mmuEntity: MMU });
    expect(live.mmu).toMatchObject({ gates: 2, source: 'sensors', entityFound: false });

    const without = parsePrinterLive(toEntities([...local, happyHare({})]), DEVICE);
    expect(without.mmu).toMatchObject({ gates: 2, entityFound: null });
  });

  it('fragt die Zusatz-Entities im Template mit, unsichere IDs nicht', () => {
    const template = printerTemplate(['sensor.a20_mmu', "sensor.x') }}{{ 1", 'sensor.b']);
    expect(template).toContain('["sensor.a20_mmu","sensor.b"]');
    expect(template).not.toContain("sensor.x')");
    expect(printerTemplate()).not.toContain("'extra'");
  });
});

describe('Klipper-MMU über die API', () => {
  let ha: FakeHa;
  let built: Awaited<ReturnType<typeof buildApp>>;
  let uploadDir: string;
  const app = () => built.app;

  beforeEach(async () => {
    ha = new FakeHa(P1S, undefined, undefined, [
      ...A20,
      ...gateSensors(['on', 'on', 'on', 'on']),
      happyHare({}),
    ]);
    uploadDir = mkdtempSync(path.join(tmpdir(), '3dapp-mmu-'));
    built = await buildApp({ dbFile: ':memory:', uploadDir, haFetch: ha.fetch });
    await json('POST', '/api/ha/connections', { name: 'Büro', url: 'ha.test', token: FAKE_TOKEN });
    await json('POST', '/api/printers', {
      name: 'A20',
      model: 'Geeetech A20',
      haDeviceId: DEVICE,
      hasAms: true,
    });
  });

  afterEach(async () => {
    await app().close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  async function json<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
    const res = await app().inject({ method, url, payload });
    return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
  }

  const live = async () =>
    ((await json<PrinterLiveResponse>('GET', '/api/printers/2/live')).body as { live: PrinterLive })
      .live;

  async function spool(colorName: string) {
    const res = await json<FilamentSpool>('POST', '/api/spools', {
      typeId: 1, // PLA
      manufacturer: 'Sunlu',
      colorName,
      diameter: 1.75,
      weightTotalG: 1000,
    });
    return res.body.id;
  }

  const bookings = async () =>
    (await json<FilamentBooking[]>('GET', '/api/bookings?printerId=2')).body;

  const tick = (sec: number) => built.watcher.tick(3_000_000 + sec * 1000);

  it('prüft Anzahl Slots und Zusatz-Entity und bietet passende Entities an', async () => {
    expect((await json('PUT', '/api/printers/2', { slotCount: 0 })).status).toBe(400);
    expect((await json('PUT', '/api/printers/2', { slotCount: 2.5 })).status).toBe(400);
    expect((await json('PUT', '/api/printers/2', { mmuEntity: 'kein sensor' })).status).toBe(400);
    const saved = await json<Printer>('PUT', '/api/printers/2', {
      slotCount: '6',
      mmuEntity: ' Sensor.A20_MMU ',
    });
    expect(saved.body).toMatchObject({ slotCount: 6, mmuEntity: 'sensor.a20_mmu' });
    expect((await live()).ams).toHaveLength(6);
    await json('PUT', '/api/printers/2', { slotCount: null });
    expect((await live()).mmu).toMatchObject({ gates: 4, source: 'entity' });

    const found = (await json<{ entities: HaMmuEntity[] }>('GET', '/api/ha/mmu-entities')).body;
    expect(found.entities).toEqual([
      { connectionId: 1, location: 'Büro', entityId: MMU, name: MMU },
    ]);
  });

  it('bucht ohne bekanntes Gate nur, wenn genau ein Gate eine Spule hat', async () => {
    const a = await spool('Gelb');
    const b = await spool('Rot');
    await json('POST', '/api/ams-link', { entityId: gate(0), spoolId: a });
    await json('POST', '/api/ams-link', { entityId: gate(2), spoolId: b });
    expect((await live()).mmu).toMatchObject({ activeKnown: false });

    ha.klipperPrint('printing', { meters: 5, file: 'zwei.gcode' });
    await tick(0);
    ha.klipperPrint('complete');
    await tick(20);
    expect(await bookings()).toEqual([]);

    // Nur noch Gate 0 belegt: dann ist klar, woher das Filament kam
    await json('POST', '/api/ams-link', { entityId: gate(2), spoolId: null });
    ha.klipperPrint('printing', { meters: 10, file: 'eins.gcode' });
    await tick(40);
    ha.klipperPrint('complete');
    await tick(60);
    expect(await bookings()).toEqual([
      expect.objectContaining({ spoolId: a, grams: 29.8, jobName: 'eins.gcode', estimated: false }),
    ]);
  });

  it('teilt mit Zusatz-Entity die Meter nach Druckzeit je Gate auf', async () => {
    await json('PUT', '/api/printers/2', { mmuEntity: MMU });
    const a = await spool('Gelb');
    const b = await spool('Rot');
    await json('POST', '/api/ams-link', { entityId: gate(0), spoolId: a });
    await json('POST', '/api/ams-link', { entityId: gate(2), spoolId: b });

    // 60 s aus Gate 0, dann 20 s aus Gate 2
    ha.set(MMU, 'Printing', { gate: 0, filament: 'Loaded' });
    ha.klipperPrint('printing', { meters: 1, file: 'bunt.gcode' });
    await tick(0);
    await tick(60);
    ha.set(MMU, null, { gate: 2 });
    ha.klipperPrint('printing', { meters: 8, file: 'bunt.gcode' });
    await tick(60);
    await tick(80);
    ha.klipperPrint('complete');
    await tick(80);

    const booked = await bookings();
    // 8 m: 6 m aus Gate 0, 2 m aus Gate 2
    expect(booked.find((x) => x.spoolId === a)).toMatchObject({ grams: 17.9, estimated: true });
    expect(booked.find((x) => x.spoolId === b)).toMatchObject({ grams: 6, estimated: true });
  });

  it('übernimmt eine Spule mit den Daten aus Happy Hare in den Bestand', async () => {
    await json('PUT', '/api/printers/2', { mmuEntity: MMU });
    const res = await json<FilamentSpool>('POST', '/api/ams-import', {
      printerId: 2,
      entityId: gate(2),
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      manufacturer: expect.stringMatching(/^esun$/i),
      colorHex: '#ff0000',
      haTrayEntity: gate(2),
    });
    expect(res.body.notes).toMatch(/^Aus MMU Gate 2/);
    // Leeres Gate: nichts zu übernehmen
    expect(
      (await json('POST', '/api/ams-import', { printerId: 2, entityId: gate(1) })).status,
    ).toBe(400);
  });
});
