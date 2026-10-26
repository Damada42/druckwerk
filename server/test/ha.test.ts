import {
  findPrinterDevices,
  parsePrinterLive,
  type FilamentBooking,
  type FilamentSpool,
  type HaEntity,
  type HaStatus,
  type PrinterLiveResponse,
} from '@3dapp/shared';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { normalizeUrl } from '../src/ha/client.js';
import { FAKE_TOKEN, FakeHa, type RawEntity } from './fake-ha.js';

/** Echte Daten des P1S von Markus (Druckerleerlauf, 4 Spulen im AMS), Tokens ersetzt */
const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/bambu-p1s.json', import.meta.url), 'utf8'),
) as RawEntity[];
const DEVICE = '671ed8fd7336dc7aba6d6faa4470f6e6';
const SLOT = (n: number) => `sensor.p1s_01p09a431900844_ams_1_slot_${n}`;

const toEntities = (raw: RawEntity[]): HaEntity[] =>
  raw.map((r) => ({
    entityId: r.e,
    state: r.s,
    attributes: r.a,
    deviceId: r.d,
    viaDeviceId: r.v,
    deviceName: r.n,
    model: r.m,
  }));

describe('Live-Status aus Home-Assistant-Daten', () => {
  it('liest den P1S im Leerlauf mit deutschen Entity-Namen', () => {
    const live = parsePrinterLive(toEntities(FIXTURE), DEVICE);
    expect(live).toMatchObject({
      online: true,
      state: 'idle',
      stateLabel: 'Bereit',
      nozzleTemp: 29,
      nozzleTarget: 0, // nicht die Düsen-Temperatur verwechseln
      bedTemp: 25,
      taskName: null,
      startTime: null,
      weightG: 31.56,
      light: false,
      canPause: false,
      canStop: false,
      coverVersion: '2026-10-26T00:49:29.536174',
    });
    // Leere externe Spule wird ausgeblendet
    expect(live.ams).toEqual([
      expect.objectContaining({
        label: 'A1',
        type: 'PETG',
        color: '#ff671f',
        remain: 99,
        entityId: SLOT(1),
      }),
      expect.objectContaining({ label: 'A2', type: 'PLA', color: '#ffffff', remain: 100 }),
      expect.objectContaining({
        label: 'A3',
        name: 'Bambu PLA Basic',
        color: '#0a2989',
        remain: 61,
      }),
      expect.objectContaining({ label: 'A4', color: '#e4bd68', remain: 88, active: false }),
    ]);
  });

  it('findet nur den Drucker, nicht AMS oder externe Spule', () => {
    expect(findPrinterDevices(toEntities(FIXTURE))).toEqual([
      { id: DEVICE, name: 'the_one', model: 'P1S' },
    ]);
  });

  it('versteht englische Entity-Namen und zeigt Offline an', () => {
    const english = FIXTURE.map((r) => ({
      ...r,
      e: r.e
        .replace('the_one_druckstatus', 'the_one_print_status')
        .replace('the_one_temperatur_der_duse', 'the_one_nozzle_temperature')
        .replace('the_one_online', 'the_one_online'),
    }));
    expect(parsePrinterLive(toEntities(english), DEVICE)).toMatchObject({
      state: 'idle',
      nozzleTemp: 29,
    });
    const offline = english.map((r) =>
      r.e === 'binary_sensor.the_one_online' ? { ...r, s: 'off' } : r,
    );
    expect(parsePrinterLive(toEntities(offline), DEVICE)).toMatchObject({
      state: 'offline',
      stateLabel: 'Offline',
    });
  });

  it('meldet laufenden Druck mit aktivem Slot und verfügbaren Knöpfen', () => {
    const ha = new FakeHa(FIXTURE);
    ha.print('running', { slot: 2, progress: 42, task: 'Halterung' });
    const live = parsePrinterLive(toEntities(ha.entities), DEVICE);
    expect(live).toMatchObject({
      state: 'running',
      progress: 42,
      taskName: 'Halterung',
      canPause: true,
      canStop: true,
      canResume: false,
    });
    expect(live.ams.find((s) => s.active)?.label).toBe('A2');
  });

  it('ergänzt bei der Adresse http:// und entfernt Pfade', () => {
    expect(normalizeUrl('homeassistant.local:8123/')).toBe('http://homeassistant.local:8123');
    expect(normalizeUrl(' https://ha.example.test/lovelace/0 ')).toBe('https://ha.example.test');
  });
});

describe('Home-Assistant-Anbindung über die API', () => {
  let ha: FakeHa;
  let built: Awaited<ReturnType<typeof buildApp>>;
  let uploadDir: string;
  const app = () => built.app;

  beforeEach(async () => {
    ha = new FakeHa(FIXTURE);
    uploadDir = mkdtempSync(path.join(tmpdir(), '3dapp-ha-'));
    built = await buildApp({ dbFile: ':memory:', uploadDir, haFetch: ha.fetch });
  });

  afterEach(async () => {
    await app().close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  const json = async <T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    payload?: object,
  ) => {
    const res = await app().inject({ method, url, payload });
    return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
  };

  async function connect() {
    const res = await json('PUT', '/api/ha/settings', { url: 'ha.test:8123', token: FAKE_TOKEN });
    expect(res.status).toBe(200);
  }

  async function linkPrinter() {
    await json('PUT', '/api/printers/1', { haDeviceId: DEVICE });
  }

  async function spool(name: string, slot: number) {
    const s = await json<FilamentSpool>('POST', '/api/spools', {
      typeId: 1,
      manufacturer: 'Bambu Lab',
      colorName: name,
      weightTotalG: 1000,
    });
    await json('POST', '/api/ams-link', { entityId: SLOT(slot), spoolId: s.body.id });
    return s.body.id;
  }

  const remaining = async (id: number) =>
    (await json<FilamentSpool>('GET', `/api/spools/${id}`)).body.weightRemainingG;

  it('speichert Verbindung nur mit gültigem Token und gibt den Token nie heraus', async () => {
    const bad = await json<{ error: string }>('PUT', '/api/ha/settings', {
      url: 'ha.test:8123',
      token: 'falsch',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/Token/);
    expect((await json<HaStatus>('GET', '/api/ha/status')).body).toMatchObject({
      ok: false,
      hasToken: false,
    });

    await connect();
    const status = await json<HaStatus>('GET', '/api/ha/status');
    expect(status.body).toEqual({
      url: 'http://ha.test:8123',
      hasToken: true,
      ok: true,
      version: '2026.10.4',
      printers: [{ id: DEVICE, name: 'the_one', model: 'P1S' }],
    });
    expect(JSON.stringify(status.body)).not.toContain(FAKE_TOKEN);

    // Adresse ändern ohne Token erneut einzugeben
    const again = await json('PUT', '/api/ha/settings', { url: 'http://ha.test:8123/' });
    expect(again.status).toBe(200);

    await json('DELETE', '/api/ha/settings');
    expect((await json<HaStatus>('GET', '/api/ha/status')).body.hasToken).toBe(false);
  });

  it('Live-Status: erst nicht eingerichtet, dann nicht verknüpft, dann Daten', async () => {
    const live = () => json<PrinterLiveResponse>('GET', '/api/printers/1/live');
    expect((await live()).body).toEqual({ status: 'unconfigured' });
    await connect();
    expect((await live()).body).toEqual({ status: 'unlinked' });
    await linkPrinter();
    const res = (await live()).body;
    expect(res.status).toBe('ok');
    if (res.status === 'ok') expect(res.live.ams).toHaveLength(4);

    await json('PUT', '/api/printers/1', { haDeviceId: 'gibts-nicht' });
    expect((await live()).body).toMatchObject({
      status: 'error',
      error: expect.stringMatching(/neu wählen/),
    });
  });

  it('steuert Pause und Licht über die passenden Entities, Vorschaubild kommt über den Server', async () => {
    await connect();
    await linkPrinter();
    ha.print('running', { slot: 1 });
    expect((await json('POST', '/api/printers/1/control', { action: 'pause' })).status).toBe(204);
    expect((await json('POST', '/api/printers/1/control', { action: 'light_on' })).status).toBe(
      204,
    );
    expect((await json('POST', '/api/printers/1/control', { action: 'formatieren' })).status).toBe(
      400,
    );
    expect(ha.calls).toEqual([
      { domain: 'button', service: 'press', entityId: 'button.the_one_druckvorgang_anhalten' },
      { domain: 'light', service: 'turn_on', entityId: 'light.the_one_druckraumbeleuchtung' },
    ]);

    const cover = await app().inject('/api/printers/1/cover');
    expect(cover.statusCode).toBe(200);
    expect(cover.headers['content-type']).toBe('image/png');
  });

  it('ordnet eine Spule einem Slot zu und löst die vorherige', async () => {
    const a = await spool('Weiß', 2);
    const b = await spool('Weiß neu', 2);
    const spools = (await json<FilamentSpool[]>('GET', '/api/spools')).body;
    expect(spools.find((s) => s.id === a)?.haTrayEntity).toBeNull();
    expect(spools.find((s) => s.id === b)?.haTrayEntity).toBe(SLOT(2));
  });

  it('bucht nach fertigem Druck automatisch ab – aufgeteilt nach Druckzeit je Slot', async () => {
    await connect();
    await linkPrinter();
    const white = await spool('Weiß', 2);
    const blue = await spool('Blau', 3);
    const tick = (sec: number) =>
      built.watcher.tick(Date.parse('2026-10-26T10:00:00Z') + sec * 1000);
    const start = '2026-10-26T10:00:00+02:00';

    ha.print('prepare', { task: 'Halterung', start, weight: 30 });
    await tick(0);
    ha.print('running', { slot: 2, progress: 10 });
    await tick(20);
    await tick(40);
    await tick(60);
    ha.print('running', { slot: 3, progress: 80 });
    await tick(80);
    ha.print('finish', { slot: null, progress: 100 });
    await tick(100);

    // Weiß druckt von 20 bis 80 s, Blau von 80 bis 100 s (Vorbereitung zählt nicht) → 3:1 von 30 g
    expect(await remaining(white)).toBe(977.5);
    expect(await remaining(blue)).toBe(992.5);
    const bookings = (await json<FilamentBooking[]>('GET', '/api/bookings?printerId=1')).body;
    expect(bookings).toHaveLength(2);
    expect(bookings[0]).toMatchObject({ jobName: 'Halterung', estimated: true });

    // Weitere Abfragen nach dem Ende buchen nichts doppelt
    await tick(120);
    expect(await remaining(white)).toBe(977.5);

    // Rückgängig: Gramm kommen zurück
    expect((await json('DELETE', `/api/bookings/${bookings[0].id}`)).status).toBe(204);
    expect((await remaining(white)) + (await remaining(blue))).toBeGreaterThan(1970);
  });

  it('abgebrochener Druck: anteilig nach Fortschritt; Slot ohne Spule wird übersprungen', async () => {
    await connect();
    await linkPrinter();
    const white = await spool('Weiß', 2);
    const tick = (sec: number) => built.watcher.tick(1_000_000 + sec * 1000);

    ha.print('running', { slot: 2, progress: 50, weight: 40, task: 'Vase', start: 's1' });
    await tick(0);
    await tick(30);
    ha.print('failed', { slot: null });
    await tick(60);
    expect(await remaining(white)).toBe(980);
    expect((await json<FilamentBooking[]>('GET', '/api/bookings')).body[0]).toMatchObject({
      grams: 20,
      estimated: true,
    });

    // Slot 4 hat keine Spule im Bestand: nichts passiert, kein Fehler
    ha.print('running', { slot: 4, progress: 5, weight: 10, start: 's2' });
    await tick(90);
    await tick(120);
    ha.print('finish', { slot: null });
    await tick(150);
    expect((await json<FilamentBooking[]>('GET', '/api/bookings')).body).toHaveLength(1);
  });

  it('übernimmt eine AMS-Spule in den Bestand und ordnet sie dem Slot zu', async () => {
    await connect();
    await linkPrinter();
    const res = await json<FilamentSpool & { error?: string }>('POST', '/api/ams-import', {
      printerId: 1,
      entityId: SLOT(3),
    });
    expect(res.status).toBe(201);
    const types = (await json<{ id: number; name: string }[]>('GET', '/api/filament-types')).body;
    const finishes = (await json<{ id: number; name: string }[]>('GET', '/api/finishes')).body;
    expect(res.body).toMatchObject({
      manufacturer: 'Bambu Lab',
      typeId: types.find((t) => t.name === 'PLA')!.id,
      finishId: finishes.find((f) => f.name === 'Normal')!.id,
      colorName: 'Dunkelblau',
      colorHex: '#0a2989',
      weightTotalG: 1000,
      weightRemainingG: 610, // 61 % laut AMS
      haTrayEntity: SLOT(3),
    });

    // Slot ist jetzt belegt – kein zweites Mal
    const again = await json<{ error: string }>('POST', '/api/ams-import', {
      printerId: 1,
      entityId: SLOT(3),
    });
    expect(again.status).toBe(409);

    const petg = await json<FilamentSpool>('POST', '/api/ams-import', {
      printerId: 1,
      entityId: SLOT(1),
    });
    expect(petg.body).toMatchObject({
      typeId: types.find((t) => t.name === 'PETG')!.id,
      colorName: 'Orange',
      weightRemainingG: 990,
    });
  });
});
