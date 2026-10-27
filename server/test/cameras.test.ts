import {
  maskUrlPassword,
  snapshotFromStream,
  type HaCameraList,
  type PrinterCamera,
} from '@3dapp/shared';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { FAKE_FRAME, FAKE_TOKEN, FakeHa, type RawEntity } from './fake-ha.js';

const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/bambu-p1s.json', import.meta.url), 'utf8'),
) as RawEntity[];

/** Crowsnest-Webcam am nachgebauten HA-Server (siehe FakeHa) */
const WEBCAM = 'http://cam:geheim@webcam.test/webcam/?action=stream';

describe('Hilfsfunktionen für Kamera-Adressen', () => {
  it('blendet nur das Passwort aus', () => {
    expect(maskUrlPassword(WEBCAM)).toBe('http://cam:•••@webcam.test/webcam/?action=stream');
    expect(maskUrlPassword('http://192.168.1.20/webcam/')).toBe('http://192.168.1.20/webcam/');
  });

  it('leitet das Standbild von Crowsnest-Streams ab', () => {
    expect(snapshotFromStream('http://k1/webcam/?action=stream')).toBe(
      'http://k1/webcam/?action=snapshot',
    );
    expect(snapshotFromStream('http://k1/webcam2/?foo=1&action=stream')).toBe(
      'http://k1/webcam2/?foo=1&action=snapshot',
    );
    expect(snapshotFromStream('http://cam.local/video.mjpg')).toBeNull();
  });
});

describe('Kameras an Druckern', () => {
  let ha: FakeHa;
  let built: Awaited<ReturnType<typeof buildApp>>;
  let uploadDir: string;
  const app = () => built.app;

  beforeEach(async () => {
    ha = new FakeHa(FIXTURE);
    uploadDir = mkdtempSync(path.join(tmpdir(), '3dapp-cam-'));
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
    const res = await json<{ id: number }>('POST', '/api/ha/connections', {
      name: 'Zuhause',
      url: 'ha.test:8123',
      token: FAKE_TOKEN,
    });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  async function printer() {
    const res = await json<{ id: number }>('POST', '/api/printers', {
      name: 'Sidewinder',
      model: 'Artillery SidewinderX1',
    });
    return res.body.id;
  }

  it('listet alle Kamera-Entities mit Gerät und Standort', async () => {
    await connect();
    const { body } = await json<HaCameraList>('GET', '/api/ha/cameras');
    expect(body.errors).toEqual([]);
    expect(body.cameras).toEqual([
      expect.objectContaining({
        entityId: 'camera.the_one_camera',
        deviceName: 'the_one',
        location: 'Zuhause',
        available: true,
      }),
      expect.objectContaining({
        entityId: 'camera.sidewinderx1',
        name: 'Kamera',
        deviceName: 'SidewinderX1',
        available: true,
      }),
      expect.objectContaining({ entityId: 'camera.sidewinderx1_usb', available: false }),
    ]);
  });

  it('meldet nicht erreichbare Standorte, ohne die anderen zu verlieren', async () => {
    await connect();
    // Zweiter Standort, dessen Token später nicht mehr gilt
    await json('POST', '/api/ha/connections', {
      name: 'Werkstatt',
      url: 'werkstatt.test:8123',
      token: FAKE_TOKEN,
    });
    built.db.$client.prepare("update ha_connections set token = 'alt' where id = 2").run();
    const { body } = await json<HaCameraList>('GET', '/api/ha/cameras');
    expect(body.cameras).toHaveLength(3);
    expect(body.errors).toEqual([
      'Home Assistant „Werkstatt“ lehnt den Token ab – bitte einen neuen erstellen.',
    ]);
  });

  it('mehrere Kameras pro Drucker: HA-Kamera und direkter Stream, sortierbar', async () => {
    const connectionId = await connect();
    const id = await printer();

    const haCam = await json<PrinterCamera>('POST', `/api/printers/${id}/cameras`, {
      name: 'Kamera',
      haConnectionId: connectionId,
      entityId: 'camera.sidewinderx1',
    });
    expect(haCam.status).toBe(201);
    expect(haCam.body).toMatchObject({ position: 0, hasSnapshot: true, streamUrl: null });

    const direct = await json<PrinterCamera>('POST', `/api/printers/${id}/cameras`, {
      name: 'Düse',
      streamUrl: 'cam:geheim@webcam.test/webcam/?action=stream',
      rotation: 180,
    });
    expect(direct.status).toBe(201);
    // http:// ergänzt, Passwort ausgeblendet, Standbild abgeleitet
    expect(direct.body).toMatchObject({
      position: 1,
      rotation: 180,
      streamUrl: 'http://cam:•••@webcam.test/webcam/?action=stream',
      hasSnapshot: true,
    });

    // Umbenennen mit unveränderter (ausgeblendeter) Adresse behält das Passwort
    const renamed = await json<PrinterCamera>('PUT', `/api/cameras/${direct.body.id}`, {
      name: 'Düse links',
      streamUrl: direct.body.streamUrl,
    });
    expect(renamed.status).toBe(200);
    const stored = built.db.$client
      .prepare('select stream_url from printer_cameras where id = ?')
      .get(direct.body.id) as { stream_url: string };
    expect(stored.stream_url).toBe(WEBCAM);

    const order = await app().inject({
      method: 'PUT',
      url: `/api/printers/${id}/cameras/order`,
      payload: { ids: [direct.body.id, haCam.body.id] },
    });
    expect(order.statusCode).toBe(204);
    const list = await json<PrinterCamera[]>('GET', `/api/printers/${id}/cameras`);
    expect(list.body.map((c) => c.name)).toEqual(['Düse links', 'Kamera']);
    // Kein Passwort im Browser
    expect(JSON.stringify(list.body)).not.toContain('geheim');
  });

  it('prüft die Eingaben', async () => {
    const connectionId = await connect();
    const id = await printer();
    const post = (body: object) =>
      json<{ error: string }>('POST', `/api/printers/${id}/cameras`, body);

    expect((await post({ name: 'X' })).body.error).toBe(
      'Bitte eine Kamera aus Home Assistant oder eine Stream-Adresse wählen.',
    );
    expect((await post({ streamUrl: 'http://cam/' })).body.error).toBe(
      'Bitte einen Namen für die Kamera eintragen.',
    );
    expect((await post({ name: 'X', streamUrl: 'rtsp://cam/live' })).body.error).toBe(
      'Nur http- und https-Adressen (MJPEG) werden unterstützt.',
    );
    expect(
      (await post({ name: 'X', haConnectionId: connectionId, entityId: 'sensor.x' })).body.error,
    ).toBe('Ungültige Kamera');
    expect((await post({ name: 'X', entityId: 'camera.the_one_camera' })).body.error).toBe(
      'Bitte den Home-Assistant-Standort wählen.',
    );
    expect((await post({ name: 'X', streamUrl: 'http://cam/', rotation: 45 })).status).toBe(400);
    expect((await json('POST', '/api/printers/99/cameras', { name: 'X' })).status).toBe(404);
  });

  it('reicht Stream und Standbild aus Home Assistant durch', async () => {
    const connectionId = await connect();
    const id = await printer();
    const cam = await json<PrinterCamera>('POST', `/api/printers/${id}/cameras`, {
      name: 'P1S',
      haConnectionId: connectionId,
      entityId: 'camera.the_one_camera',
    });

    const stream = await app().inject({ url: `/api/cameras/${cam.body.id}/stream` });
    expect(stream.statusCode).toBe(200);
    expect(stream.headers['content-type']).toBe('multipart/x-mixed-replace; boundary=frame');
    expect(stream.headers['cache-control']).toBe('no-store');
    expect(stream.rawPayload.includes(FAKE_FRAME)).toBe(true);

    const snapshot = await app().inject({ url: `/api/cameras/${cam.body.id}/snapshot` });
    expect(snapshot.headers['content-type']).toBe('image/png');
    expect(snapshot.rawPayload.equals(FAKE_FRAME)).toBe(true);
  });

  it('reicht direkte Streams mit Zugangsdaten durch', async () => {
    const id = await printer();
    const cam = await json<PrinterCamera>('POST', `/api/printers/${id}/cameras`, {
      name: 'Düse',
      streamUrl: WEBCAM,
    });
    const stream = await app().inject({ url: `/api/cameras/${cam.body.id}/stream` });
    expect(stream.statusCode).toBe(200);
    expect(stream.headers['content-type']).toContain('multipart/x-mixed-replace');

    const snapshot = await app().inject({ url: `/api/cameras/${cam.body.id}/snapshot` });
    expect(snapshot.headers['content-type']).toBe('image/png');

    // Falsches Passwort: verständliche Meldung, keine Adresse
    await json('PUT', `/api/cameras/${cam.body.id}`, {
      streamUrl: 'http://cam:falsch@webcam.test/webcam/?action=stream',
    });
    const denied = await json<{ error: string }>('GET', `/api/cameras/${cam.body.id}/stream`);
    expect(denied).toEqual({ status: 502, body: { error: 'Kamera „Düse“ meldet Fehler 401.' } });
  });

  it('ohne Standbild-Adresse gibt es kein Standbild', async () => {
    const id = await printer();
    const cam = await json<PrinterCamera>('POST', `/api/printers/${id}/cameras`, {
      name: 'Raum',
      streamUrl: 'http://cam.local/video.mjpg',
    });
    expect(cam.body.hasSnapshot).toBe(false);
    expect((await json('GET', `/api/cameras/${cam.body.id}/snapshot`)).status).toBe(404);
  });

  it('meldet eine nicht verfügbare HA-Kamera', async () => {
    const connectionId = await connect();
    const id = await printer();
    const cam = await json<PrinterCamera>('POST', `/api/printers/${id}/cameras`, {
      name: 'USB',
      haConnectionId: connectionId,
      entityId: 'camera.sidewinderx1_usb',
    });
    const res = await json<{ error: string }>('GET', `/api/cameras/${cam.body.id}/stream`);
    expect(res).toEqual({
      status: 502,
      body: { error: 'Home Assistant „Zuhause“ meldet Fehler 404.' },
    });
  });

  it('löscht Kameras mit dem Drucker und mit dem HA-Standort', async () => {
    const connectionId = await connect();
    const id = await printer();
    const other = await printer();
    await json('POST', `/api/printers/${id}/cameras`, { name: 'A', streamUrl: 'http://cam/a' });
    await json('POST', `/api/printers/${other}/cameras`, {
      name: 'B',
      haConnectionId: connectionId,
      entityId: 'camera.sidewinderx1',
    });
    await json('POST', `/api/printers/${other}/cameras`, { name: 'C', streamUrl: 'http://cam/c' });

    await json('DELETE', `/api/printers/${id}`);
    expect((await json<PrinterCamera[]>('GET', `/api/printers/${id}/cameras`)).body).toEqual([]);

    await json('DELETE', `/api/ha/connections/${connectionId}`);
    const left = await json<PrinterCamera[]>('GET', `/api/printers/${other}/cameras`);
    expect(left.body.map((c) => c.name)).toEqual(['C']);
  });
});
