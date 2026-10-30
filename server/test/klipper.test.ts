import {
  filamentGrams,
  findPrinterDevices,
  parsePrinterLive,
  type FilamentBooking,
  type FilamentSpool,
  type HaEntity,
  type PrinterLive,
  type PrinterLiveResponse,
} from '@3dapp/shared';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { FAKE_TOKEN, FakeHa, type RawEntity } from './fake-ha.js';

// Echte Entities eines Geeetech A20 mit Klipper (Moonraker-Integration), Kamera-Token ersetzt
const A20 = JSON.parse(
  readFileSync(new URL('./fixtures/klipper-a20.json', import.meta.url), 'utf8'),
) as RawEntity[];
const P1S = JSON.parse(
  readFileSync(new URL('./fixtures/bambu-p1s.json', import.meta.url), 'utf8'),
) as RawEntity[];
const DEVICE = 'klipper-a20';
const SPOOL_SLOT = 'sensor.a20_filament_used';

const toEntities = (raw: RawEntity[]): HaEntity[] =>
  raw.map((r) => ({
    entityId: r.e,
    state: r.s,
    attributes: r.a,
    deviceId: r.d,
    viaDeviceId: r.v,
    deviceName: r.n,
    model: r.m,
    platform: r.p ?? 'bambu_lab',
  }));

describe('Klipper-Live-Status aus Moonraker-Daten', () => {
  it('liest den A20 nach einem Druck, mit Temperaturen und einem Platz für die Spule', () => {
    const live = parsePrinterLive(toEntities(A20), DEVICE);
    expect(live).toMatchObject({
      kind: 'klipper',
      online: true,
      state: 'finish',
      nozzleTemp: 215.39,
      nozzleTarget: 0,
      bedTemp: 54.54,
      speedPercent: 100,
      canSetSpeed: false,
      canSkip: false,
      light: null,
    });
    expect(live.ams).toEqual([
      expect.objectContaining({ entityId: SPOOL_SLOT, label: 'Spule', type: null, active: false }),
    ]);
  });

  it('meldet laufenden Druck mit Restzeit in Minuten und Knöpfen', () => {
    const ha = new FakeHa(P1S, undefined, undefined, A20);
    ha.klipperPrint('printing', { meters: 3.2, progress: 40, file: 'halter.gcode' });
    ha.set('sensor.a20_print_time_left', '1.5');
    const live: PrinterLive = parsePrinterLive(toEntities(ha.entities), DEVICE);
    expect(live).toMatchObject({
      state: 'running',
      progress: 40,
      taskName: 'halter.gcode',
      remainingMin: 90,
      filamentUsedM: 3.2,
      canPause: true,
      canStop: true,
      canResume: false,
      canSetSpeed: true,
      coverVersion: 'halter.gcode',
    });
    expect(live.ams[0].active).toBe(true);

    ha.klipperPrint('paused', { meters: 3.2 });
    expect(parsePrinterLive(toEntities(ha.entities), DEVICE)).toMatchObject({
      state: 'pause',
      canPause: false,
      canResume: true,
    });
  });

  it('zeigt Offline, wenn Home Assistant den Drucker nicht erreicht', () => {
    const offline = A20.map((r) => ({ ...r, s: 'unavailable' }));
    expect(parsePrinterLive(toEntities(offline), DEVICE)).toMatchObject({ state: 'offline' });
  });

  it('findet Bambu- und Klipper-Drucker nebeneinander, der P1S bleibt unverändert', () => {
    const entities = toEntities([...P1S, ...A20]);
    expect(findPrinterDevices(entities).map((d) => d.name)).toEqual(['the_one', 'A20']);
    expect(parsePrinterLive(entities, '671ed8fd7336dc7aba6d6faa4470f6e6')).toMatchObject({
      kind: 'bambu',
      speedPercent: null,
    });
  });

  it('rechnet Meter über Durchmesser und Dichte in Gramm um', () => {
    // 1,75 mm PLA: rund 3 g pro Meter (335 m pro kg)
    expect(filamentGrams(1, 1.75, 'PLA')).toBe(3);
    expect(filamentGrams(10, 1.75, 'PETG')).toBe(30.5);
    expect(filamentGrams(10, 1.75, 'PLA-CF')).toBe(29.8);
    expect(filamentGrams(10, 2.85, 'ABS')).toBe(66.3);
    // Unbekannter Typ: wie PLA
    expect(filamentGrams(10, 1.75, 'Exotisch')).toBe(29.8);
  });
});

describe('Klipper über die API', () => {
  let ha: FakeHa;
  let built: Awaited<ReturnType<typeof buildApp>>;
  let uploadDir: string;
  const app = () => built.app;

  beforeEach(async () => {
    ha = new FakeHa(P1S, undefined, undefined, A20);
    uploadDir = mkdtempSync(path.join(tmpdir(), '3dapp-klipper-'));
    built = await buildApp({ dbFile: ':memory:', uploadDir, haFetch: ha.fetch });
    await json('POST', '/api/ha/connections', { name: 'Büro', url: 'ha.test', token: FAKE_TOKEN });
    await json('POST', '/api/printers', { name: 'A20', model: 'Geeetech A20', haDeviceId: DEVICE });
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

  it('Pause, Geschwindigkeit in % und Vorschaubild', async () => {
    ha.klipperPrint('printing', { meters: 1, file: 'vase.gcode' });
    await built.ha.entities({ fresh: true });
    expect((await live()).state).toBe('running');

    expect((await json('POST', '/api/printers/2/control', { action: 'pause' })).status).toBe(204);
    expect(ha.calls.at(-1)).toMatchObject({
      domain: 'button',
      service: 'press',
      entityId: 'button.a20_pause_print',
    });

    expect((await json('POST', '/api/printers/2/speed', { percent: 250 })).status).toBe(400);
    expect((await json('POST', '/api/printers/2/speed', { speed: 'sport' })).status).toBe(400);
    expect((await json('POST', '/api/printers/2/speed', { percent: 125 })).status).toBe(204);
    expect(ha.calls.at(-1)).toEqual({
      domain: 'number',
      service: 'set_value',
      entityId: 'number.a20_speed_factor',
      data: { entity_id: 'number.a20_speed_factor', value: 125 },
    });
    expect((await live()).speedPercent).toBe(125);

    const cover = await app().inject('/api/printers/2/cover');
    expect(cover.statusCode).toBe(200);
    expect(cover.headers['content-type']).toBe('image/png');
  });

  it('bucht nach dem Druck die verbrauchten Meter als Gramm von der Spule im Drucker ab', async () => {
    const spool = await json<FilamentSpool>('POST', '/api/spools', {
      typeId: 1, // PLA
      manufacturer: 'Sunlu',
      colorName: 'Beige',
      diameter: 1.75,
      weightTotalG: 1000,
    });
    await json('POST', '/api/ams-link', { entityId: SPOOL_SLOT, spoolId: spool.body.id });
    const tick = (sec: number) => built.watcher.tick(2_000_000 + sec * 1000);

    ha.klipperPrint('printing', { meters: 2, file: 'halter.gcode' });
    await tick(0);
    ha.klipperPrint('printing', { meters: 9.5, file: 'halter.gcode' });
    await tick(20);
    // Nach dem Druck meldet Moonraker 0 m – gebucht wird der höchste gesehene Wert
    ha.klipperPrint('complete');
    await tick(40);
    await tick(60);

    const bookings = (await json<FilamentBooking[]>('GET', '/api/bookings?printerId=2')).body;
    expect(bookings).toEqual([
      expect.objectContaining({ grams: 28.3, jobName: 'halter.gcode', estimated: false }),
    ]);
    const after = (await json<FilamentSpool>('GET', `/api/spools/${spool.body.id}`)).body;
    expect(after.weightRemainingG).toBe(971.7);

    // Abgebrochen: die bis dahin verbrauchte Länge, nicht anteilig geschätzt
    ha.klipperPrint('printing', { meters: 4, file: 'test.gcode' });
    await tick(80);
    await tick(100);
    ha.klipperPrint('cancelled');
    await tick(120);
    const second = (await json<FilamentBooking[]>('GET', '/api/bookings?printerId=2')).body;
    expect(second).toHaveLength(2);
    expect(second.find((b) => b.jobName === 'test.gcode')?.grams).toBe(11.9);
  });
});
