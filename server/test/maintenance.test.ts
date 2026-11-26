import {
  P1_TEMPLATE,
  addMonths,
  dueMaintenance,
  parseHours,
  taskStatus,
  templateForModel,
  type MaintenanceDoneResult,
  type MaintenanceLogEntry,
  type MaintenanceTask,
  type NotifyService,
  type Printer,
  type SparePart,
} from '@3dapp/shared';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { FAKE_TOKEN, FakeHa, type RawEntity } from './fake-ha.js';

const P1S = JSON.parse(
  readFileSync(new URL('./fixtures/bambu-p1s.json', import.meta.url), 'utf8'),
) as RawEntity[];
const A20 = JSON.parse(
  readFileSync(new URL('./fixtures/klipper-a20.json', import.meta.url), 'utf8'),
) as RawEntity[];
const DEVICE = '671ed8fd7336dc7aba6d6faa4470f6e6';
const HOURS = 'sensor.the_one_gesamtnutzung';

const defaults = { warnHours: 300, warnDays: 14 };
const task = (t: Partial<MaintenanceTask>) => ({
  intervalHours: null,
  intervalMonths: null,
  warnHours: null,
  baseHours: 0,
  lastDoneAt: '2026-01-01',
  ...t,
});

describe('Wartungsstand', () => {
  it('zählt Stunden seit dem Zurücksetzen und warnt vorher', () => {
    const t = task({ intervalHours: 1000, baseHours: 500 });
    expect(taskStatus(t, 1000, new Date('2026-02-01'), defaults)).toMatchObject({
      usedHours: 500,
      remainingHours: 500,
      level: 'ok',
      progress: 0.5,
    });
    expect(taskStatus(t, 1200.5, new Date('2026-02-01'), defaults)).toMatchObject({
      remainingHours: 299.5,
      level: 'soon',
    });
    expect(taskStatus(t, 1600, new Date('2026-02-01'), defaults)).toMatchObject({
      remainingHours: -100,
      level: 'due',
    });
    // Eigene Vorwarnung am Punkt
    expect(taskStatus({ ...t, warnHours: 50 }, 1200, new Date('2026-02-01'), defaults).level).toBe(
      'ok',
    );
    // Zähler läuft nie ins Minus (z.B. Stundenstand von Hand verkleinert)
    expect(taskStatus(t, 100, new Date('2026-02-01'), defaults).usedHours).toBe(0);
  });

  it('Monatsintervall ab dem letzten Erledigen, das frühere Kriterium zählt', () => {
    const t = task({ intervalMonths: 3, intervalHours: 1000, lastDoneAt: '2026-01-31' });
    expect(addMonths('2026-01-31', 3)).toBe('2026-04-30');
    expect(taskStatus(t, 10, new Date('2026-04-01'), defaults)).toMatchObject({
      dueDate: '2026-04-30',
      remainingDays: 29,
      level: 'ok',
    });
    expect(taskStatus(t, 10, new Date('2026-04-20'), defaults).level).toBe('soon');
    expect(taskStatus(t, 10, new Date('2026-04-30'), defaults).level).toBe('due');
    // Stunden schlagen zuerst an
    expect(taskStatus(t, 1000, new Date('2026-02-01'), defaults).level).toBe('due');
  });

  it('listet Fälliges zuerst, mit fehlenden Teilen', () => {
    const part = { id: 7, name: 'Hotend', stockQty: 0 } as SparePart;
    const tasks = [
      {
        ...task({ intervalHours: 1000 }),
        id: 1,
        printerId: 1,
        name: 'A',
        partId: null,
        partQty: 1,
      },
      { ...task({ intervalHours: 500 }), id: 2, printerId: 1, name: 'B', partId: 7, partQty: 1 },
      {
        ...task({ intervalHours: 5000 }),
        id: 3,
        printerId: 1,
        name: 'C',
        partId: null,
        partQty: 1,
      },
    ] as MaintenanceTask[];
    const due = dueMaintenance(
      [{ id: 1, name: 'P1S', operatingHours: 800 }],
      tasks,
      [part],
      new Date('2026-02-01'),
      defaults,
    );
    expect(due.map((d) => [d.task.name, d.status.level, d.missing])).toEqual([
      ['B', 'due', 1],
      ['A', 'soon', 0],
    ]);
  });

  it('liest Betriebsstunden von Bambu und Klipper', () => {
    expect(parseHours({ state: '1752.96', attributes: { unit_of_measurement: 'h' } })).toBe(
      1752.96,
    );
    expect(parseHours({ state: '168h 59m 40s', attributes: {} })).toBe(168.99);
    expect(parseHours({ state: '90', attributes: { unit_of_measurement: 'min' } })).toBe(1.5);
    expect(parseHours({ state: 'unavailable', attributes: {} })).toBeNull();
  });

  it('Vorlage passt zur P1-Serie', () => {
    expect(templateForModel('Bambu Lab P1S')).toBe(P1_TEMPLATE);
    expect(templateForModel('P1P')).toBe(P1_TEMPLATE);
    expect(templateForModel('Bambu Lab X1C')).toBeNull();
  });
});

describe('Wartung über die API', () => {
  let ha: FakeHa;
  let built: Awaited<ReturnType<typeof buildApp>>;
  let uploadDir: string;
  const app = () => built.app;

  async function json<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
    const res = await app().inject({ method, url, payload });
    return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
  }
  const printer = async (id = 1) => (await json<Printer>('GET', `/api/printers/${id}`)).body;
  const tasks = async () => (await json<MaintenanceTask[]>('GET', '/api/maintenance-tasks')).body;
  const part = async (id: number) => (await json<SparePart>('GET', `/api/spare-parts/${id}`)).body;

  beforeEach(async () => {
    ha = new FakeHa(P1S, undefined, undefined, A20);
    uploadDir = mkdtempSync(path.join(tmpdir(), '3dapp-wartung-'));
    built = await buildApp({ dbFile: ':memory:', uploadDir, haFetch: ha.fetch });
  });

  afterEach(async () => {
    await app().close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('Teil anlegen, Bestand ändern, Hersteller aus der Liste', async () => {
    await json('POST', '/api/manufacturers', { name: 'Bambu Lab' });
    const created = await json<SparePart>('POST', '/api/spare-parts', {
      name: ' Hotend 0,4 ',
      manufacturer: 'bambu lab',
      stockQty: '2',
      shopUrl: 'https://eu.store.bambulab.com/x',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'Hotend 0,4',
      manufacturer: 'Bambu Lab',
      stockQty: 2,
    });
    expect(
      (await json('POST', '/api/spare-parts', { name: 'X', shopUrl: 'javascript:1' })).status,
    ).toBe(400);
    const id = created.body.id;
    expect(
      (await json<SparePart>('POST', `/api/spare-parts/${id}/stock`, { delta: -5 })).body.stockQty,
    ).toBe(0);
    expect(
      (await json<SparePart>('POST', `/api/spare-parts/${id}/stock`, { delta: 3 })).body.stockQty,
    ).toBe(3);
    // Hersteller in Verwendung lässt sich nicht löschen
    const list = (await json<{ id: number; name: string }[]>('GET', '/api/manufacturers')).body;
    const bambu = list.find((m) => m.name === 'Bambu Lab')!;
    expect((await json('DELETE', `/api/manufacturers/${bambu.id}`)).status).toBe(409);
  });

  it('Zähler, Wartung erledigt mit Abbuchung und Rückgängig', async () => {
    expect(
      (await json<Printer>('PUT', '/api/printers/1/hours', { hours: 1000 })).body.operatingHours,
    ).toBe(1000);
    // Druckerformular überschreibt die Stunden nicht
    await json('PUT', '/api/printers/1', { name: 'Ender 3', operatingHours: 5 });
    expect((await printer()).operatingHours).toBe(1000);

    const hotend = (
      await json<SparePart>('POST', '/api/spare-parts', { name: 'Hotend', stockQty: 1 })
    ).body;
    expect(
      (await json('POST', '/api/maintenance-tasks', { printerId: 1, name: 'Ohne Intervall' }))
        .status,
    ).toBe(400);
    const t1 = (
      await json<MaintenanceTask>('POST', '/api/maintenance-tasks', {
        printerId: 1,
        name: 'Hotend tauschen',
        kind: 'replace',
        partId: hotend.id,
        partQty: 2,
        intervalHours: 500,
        currentHours: 450,
      })
    ).body;
    expect(t1).toMatchObject({ baseHours: 550, position: 0 });
    const t2 = (
      await json<MaintenanceTask>('POST', '/api/maintenance-tasks', {
        printerId: 1,
        name: 'Stangen ölen',
        kind: 'lube',
        intervalMonths: 3,
      })
    ).body;
    expect(t2).toMatchObject({ baseHours: 1000, position: 1 });
    // Aktuellen Stand nachträglich ändern
    expect(
      (await json<MaintenanceTask>('PUT', `/api/maintenance-tasks/${t2.id}`, { currentHours: 20 }))
        .body.baseHours,
    ).toBe(980);

    const done = await json<MaintenanceDoneResult>('POST', '/api/printers/1/maintenance', {
      taskIds: [t1.id, t2.id],
      bookParts: true,
      note: 'Alles neu',
      doneAt: '2026-11-17',
    });
    expect(done.status).toBe(201);
    expect(done.body.missing).toEqual([
      { partId: hotend.id, name: 'Hotend', needed: 2, booked: 1 },
    ]);
    expect(done.body.entry).toMatchObject({ printerHours: 1000, note: 'Alles neu' });
    expect(done.body.entry.items[0]).toMatchObject({
      booked: 1,
      usedHours: 450,
      prevBaseHours: 550,
    });
    expect((await part(hotend.id)).stockQty).toBe(0);
    expect((await tasks()).map((t) => [t.baseHours, t.lastDoneAt])).toEqual([
      [1000, '2026-11-17'],
      [1000, '2026-11-17'],
    ]);

    // Zweite Wartung: nur die letzte lässt sich rückgängig machen
    const second = await json<MaintenanceDoneResult>('POST', '/api/printers/1/maintenance', {
      taskIds: [t2.id],
    });
    expect((await json('DELETE', `/api/maintenance-log/${done.body.entry.id}`)).status).toBe(409);
    expect((await json('DELETE', `/api/maintenance-log/${second.body.entry.id}`)).status).toBe(204);
    expect((await json('DELETE', `/api/maintenance-log/${done.body.entry.id}`)).status).toBe(204);
    expect((await part(hotend.id)).stockQty).toBe(1);
    expect((await tasks()).map((t) => t.baseHours)).toEqual([550, 980]);
    expect(
      (await json<MaintenanceLogEntry[]>('GET', '/api/printers/1/maintenance-log')).body,
    ).toEqual([]);
  });

  it('Vorlage übernehmen legt Teile nur einmal an', async () => {
    const items = P1_TEMPLATE.filter((i) => i.part)
      .slice(0, 2)
      .map((i) => ({ ...i, intervalHours: 1000 }));
    expect((await json('POST', '/api/printers/1/maintenance-tasks', { items })).status).toBe(201);
    expect((await json('POST', '/api/printers/1/maintenance-tasks', { items })).status).toBe(201);
    expect((await json<SparePart[]>('GET', '/api/spare-parts')).body).toHaveLength(2);
    expect(await tasks()).toHaveLength(4);
    // Ohne Intervall geht nichts (und nichts wird halb angelegt)
    const bad = await json('POST', '/api/printers/1/maintenance-tasks', {
      items: [{ ...items[0], intervalHours: null }],
    });
    expect(bad.status).toBe(400);
    expect(await tasks()).toHaveLength(4);
  });

  it('übernimmt Betriebsstunden aus HA und schickt den Push einmal je Stufe', async () => {
    await json('POST', '/api/ha/connections', { name: 'Büro', url: 'ha.test', token: FAKE_TOKEN });
    // Drucker 1 ist der P1S aus den Startdaten
    await json('PUT', '/api/printers/1', { haDeviceId: DEVICE });
    await json('POST', '/api/printers', { name: 'A20', model: 'A20', haDeviceId: 'klipper-a20' });
    const minute = 60_000;
    await built.watcher.tick(minute);
    expect((await printer(1)).operatingHours).toBe(1752.96);
    expect((await printer(2)).operatingHours).toBe(168.99);
    expect((await printer(1)).operatingHoursAt).not.toBeNull();
    // Kommt aus HA: von Hand nicht änderbar
    expect((await json('PUT', '/api/printers/1/hours', { hours: 3 })).status).toBe(409);

    // Drucker aus: letzter Wert bleibt
    ha.set(HOURS, 'unavailable');
    await built.watcher.tick(2 * minute);
    expect((await printer(1)).operatingHours).toBe(1752.96);

    const services = (await json<{ services: NotifyService[] }>('GET', '/api/ha/notify-services'))
      .body;
    expect(services.services).toEqual([{ value: '1:mobile_app_galaxy_s25', label: 'Galaxy S25' }]);
    await json('PUT', '/api/settings', {
      maintenance: true,
      maintenanceNotify: services.services[0].value,
    });
    expect((await json('PUT', '/api/settings', { maintenanceNotify: 'quatsch' })).status).toBe(400);

    const hotend = (
      await json<SparePart>('POST', '/api/spare-parts', { name: 'Hotend', stockQty: 0 })
    ).body;
    // Noch 250 h bis zum Intervall → bald fällig
    await json('POST', '/api/maintenance-tasks', {
      printerId: 1,
      name: 'Hotend tauschen',
      partId: hotend.id,
      intervalHours: 1000,
      currentHours: 750,
    });
    const notifies = () => ha.calls.filter((c) => c.domain === 'notify');
    await built.watcher.tick(3 * minute);
    expect(notifies()).toHaveLength(1);
    expect(notifies()[0]).toMatchObject({ service: 'mobile_app_galaxy_s25' });
    expect(notifies()[0].data).toMatchObject({ title: 'Wartung bald fällig: P1S' });
    expect(String(notifies()[0].data.message)).toContain('Hotend: 0 auf Lager, 1 fehlt');
    // Gleiche Stufe: keine zweite Nachricht (auch nicht vor Ablauf der Minute)
    await built.watcher.tick(3 * minute + 1000);
    await built.watcher.tick(4 * minute);
    expect(notifies()).toHaveLength(1);
    // Fällig: zweite Nachricht
    ha.set(HOURS, '2100');
    await built.watcher.tick(5 * minute);
    expect(notifies()).toHaveLength(2);
    expect(notifies()[1].data).toMatchObject({ title: 'Wartung fällig: P1S' });

    expect((await json('POST', '/api/maintenance/test-notify', {})).status).toBe(200);
    expect(notifies()).toHaveLength(3);
  });
});
