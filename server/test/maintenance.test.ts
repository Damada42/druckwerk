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
  type PrinterModel,
  type PartCategory,
  type SparePart,
  guessPartCategory,
  modelLabel,
  partLabel,
} from '@3dapp/shared';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { schema } from '../src/db/index.js';
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
    const parts = (await json<SparePart[]>('GET', '/api/spare-parts')).body;
    expect(parts).toHaveLength(2);
    // Neue Teile passen zum Modell des Druckers
    const modelId = (await printer()).modelId;
    expect(modelId).not.toBeNull();
    expect(parts.map((p) => p.modelIds)).toEqual([[modelId], [modelId]]);
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
    expect(services.services).toEqual([
      { value: '1:mobile_app_galaxy_s25', label: 'Galaxy S25', kind: 'app' },
      { value: '1:notify.telegram_bot_111_222', label: 'Werkstatt (222)', kind: 'telegram' },
      { value: '1:notify.telegram_bot_111_333', label: 'Team (-333)', kind: 'telegram' },
    ]);
    await json('PUT', '/api/settings', {
      maintenance: true,
      maintenanceNotify: [services.services[0].value],
    });
    for (const bad of ['1:mobile_app_galaxy_s25', ['quatsch'], ['1:notify.Telegram']])
      expect((await json('PUT', '/api/settings', { maintenanceNotify: bad })).status).toBe(400);

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
    expect(notifies()[2].data.title).toBe('Test: Wartung bald fällig: P1S');
  });

  it('Nachricht an mehrere Ziele, Telegram, eigener Text und Erinnerung', async () => {
    await json('POST', '/api/ha/connections', { name: 'Büro', url: 'ha.test', token: FAKE_TOKEN });
    await json('PUT', '/api/printers/1', { haDeviceId: DEVICE });
    ha.set(HOURS, '2000');
    const minute = 60_000;
    const day = 24 * 60 * minute;
    await built.watcher.tick(minute);
    await json('PUT', '/api/settings', {
      maintenance: true,
      maintenanceNotify: ['1:mobile_app_galaxy_s25', '1:notify.telegram_bot_111_222'],
      maintenanceTitle: '🔧 {drucker} ({modell})',
      maintenanceMessage:
        '{anzahl} Punkt(e) {stufe} bei {stunden} h\n{fehlende_teile}\n{unbekannt}',
      maintenanceRemindDays: 2,
    });
    const nozzle = (await json<SparePart>('POST', '/api/spare-parts', { name: 'Düse' })).body;
    await json('POST', '/api/maintenance-tasks', {
      printerId: 1,
      name: 'Düse tauschen',
      partId: nozzle.id,
      intervalHours: 100,
      currentHours: 150,
    });
    const notifies = () => ha.calls.filter((c) => c.domain === 'notify');
    await built.watcher.tick(2 * minute);
    expect(notifies()).toHaveLength(2);
    const [app, telegram] = notifies();
    expect(app).toMatchObject({ service: 'mobile_app_galaxy_s25' });
    expect(telegram).toMatchObject({
      service: 'send_message',
      entityId: 'notify.telegram_bot_111_222',
    });
    expect(telegram.data).toEqual({
      entity_id: 'notify.telegram_bot_111_222',
      title: '🔧 P1S (Bambu Lab P1S)',
      message: `1 Punkt(e) fällig bei ${(2000).toLocaleString('de-AT')} h\nFehlt: Düse (1 Stück)\n{unbekannt}`,
    });
    // Erinnerung erst nach zwei Tagen, solange fällig
    await built.watcher.tick(2 * minute + day);
    expect(notifies()).toHaveLength(2);
    await built.watcher.tick(3 * minute + 2 * day);
    expect(notifies()).toHaveLength(4);
    expect(notifies()[2].data.title).toBe('🔧 P1S (Bambu Lab P1S) (Erinnerung)');

    // Ein Ziel kaputt: das andere bekommt die Testnachricht trotzdem
    const test = await json<{ results: { target: string; error: string | null }[] }>(
      'POST',
      '/api/maintenance/test-notify',
      {
        targets: ['1:notify.telegram_bot_111_333', '9:mobile_app_weg'],
        message: 'Hallo {drucker}',
      },
    );
    expect(test.status).toBe(200);
    expect(test.body.results.map((r) => !!r.error)).toEqual([false, true]);
    expect(notifies().at(-1)!.data).toMatchObject({ message: 'Hallo P1S' });
  });

  it('übernimmt ein einzelnes Ziel aus älteren Versionen', async () => {
    built.db
      .insert(schema.settings)
      .values({ key: 'maintenanceNotify', value: JSON.stringify('1:mobile_app_x') })
      .run();
    expect(
      (await json<{ maintenanceNotify: string[] }>('GET', '/api/settings')).body.maintenanceNotify,
    ).toEqual(['1:mobile_app_x']);
  });
});

describe('Druckermodelle', () => {
  let built: Awaited<ReturnType<typeof buildApp>>;
  let uploadDir: string;
  async function json<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
    const res = await built.app.inject({ method, url, payload });
    return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
  }
  const models = async () => (await json<PrinterModel[]>('GET', '/api/printer-models')).body;
  const getPrinter = async (id: number) => (await json<Printer>('GET', `/api/printers/${id}`)).body;

  beforeEach(async () => {
    uploadDir = mkdtempSync(path.join(tmpdir(), '3dapp-modelle-'));
    built = await buildApp({ dbFile: ':memory:', uploadDir });
  });
  afterEach(async () => {
    await built.app.close();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  it('Migration ordnet bestehende Drucker und Ersatzteile zu', () => {
    // Datenbank auf dem Stand von 0.10 (bis Migration 0017) mit Altdaten
    const src = fileURLToPath(new URL('../drizzle', import.meta.url));
    const old = path.join(uploadDir, 'drizzle');
    cpSync(src, old, { recursive: true });
    const journalFile = path.join(old, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as {
      entries: { tag: string }[];
    };
    journal.entries = journal.entries.filter((e) => e.tag < '0018');
    writeFileSync(journalFile, JSON.stringify(journal));
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: old });
    sqlite.exec(`
      INSERT INTO printers (name, model) VALUES ('Werkstatt', 'bambu lab p1s'), ('Eigenbau', 'Voron 2.4');
      INSERT INTO spare_parts (name, printer_model) VALUES ('Düse', 'P1S'), ('Riemen', 'Voron 2.4'), ('Leer', NULL);
    `);
    migrate(db, { migrationsFolder: src });
    const rows = <T>(q: string) => sqlite.prepare(q).all() as T[];
    expect(
      rows<{ name: string; model: string | null }>(
        `SELECT p.name, pm.name AS model FROM printers p LEFT JOIN printer_models pm ON pm.id = p.model_id ORDER BY p.id`,
      ),
    ).toEqual([
      { name: 'Werkstatt', model: 'P1S' },
      { name: 'Eigenbau', model: null },
    ]);
    expect(
      rows<{ name: string; model: string | null; notes: string | null }>(
        `SELECT sp.name, pm.name AS model, sp.notes FROM spare_parts sp
         LEFT JOIN spare_part_models spm ON spm.part_id = sp.id
         LEFT JOIN printer_models pm ON pm.id = spm.model_id ORDER BY sp.id`,
      ),
    ).toEqual([
      { name: 'Düse', model: 'P1S', notes: null },
      { name: 'Riemen', model: null, notes: 'Passt für: Voron 2.4' },
      { name: 'Leer', model: null, notes: null },
    ]);
    sqlite.close();
  });

  it('bringt die Liste mit; der Startdrucker ist der P1S', async () => {
    const list = await models();
    expect(list.length).toBeGreaterThan(60);
    const p1s = list.find((m) => modelLabel(m) === 'Bambu Lab P1S')!;
    expect(list.filter((m) => m.manufacturer === 'Prusa').map((m) => m.name)).toContain('MK4S');
    expect(list.map(modelLabel)).toContain('Anycubic Kobra 4 Combo');
    expect(list.map(modelLabel)).toContain('Creality SPARKX i8');
    expect((await getPrinter(1)).modelId).toBe(p1s.id);
  });

  it('Modelle pflegen, Drucker und Ersatzteile zuordnen', async () => {
    const created = await json<PrinterModel>('POST', '/api/printer-models', {
      manufacturer: 'artillery',
      name: 'Sidewinder X1',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ manufacturer: 'artillery', name: 'Sidewinder X1' });
    const sw = created.body;
    const again = await json('POST', '/api/printer-models', {
      manufacturerId: sw.manufacturerId,
      name: 'sidewinder x1',
    });
    expect(again.status).toBe(409);

    // Drucker mit Modell: Text kommt aus der Liste
    const printer = (
      await json<Printer>('POST', '/api/printers', { name: 'SW', model: 'egal', modelId: sw.id })
    ).body;
    expect(printer.model).toBe('artillery Sidewinder X1');
    const unknown = await json('POST', '/api/printers', { name: 'X', model: 'x', modelId: 999 });
    expect(unknown.status).toBe(400);
    // Hersteller und Modell umbenennen zieht den Text nach
    await json('PUT', `/api/manufacturers/${sw.manufacturerId}`, { name: 'Artillery' });
    expect((await getPrinter(printer.id)).model).toBe('Artillery Sidewinder X1');
    await json('PUT', `/api/printer-models/${sw.id}`, {
      manufacturerId: sw.manufacturerId,
      name: 'Sidewinder X2',
    });
    expect((await getPrinter(printer.id)).model).toBe('Artillery Sidewinder X2');

    // Ersatzteil für zwei Modelle
    const p1s = (await models()).find((m) => modelLabel(m) === 'Bambu Lab P1S')!;
    const part = await json<SparePart>('POST', '/api/spare-parts', {
      name: 'PTFE-Schlauch',
      modelIds: [sw.id, p1s.id, p1s.id],
    });
    expect(part.status).toBe(201);
    expect([...part.body.modelIds].sort()).toEqual([p1s.id, sw.id].sort());
    const url = `/api/spare-parts/${part.body.id}`;
    expect((await json('PUT', url, { modelIds: [12345] })).status).toBe(400);
    expect((await json<SparePart>('PUT', url, { stockQty: 2 })).body.modelIds).toHaveLength(2);

    // Hersteller mit Modellen lässt sich nicht löschen
    expect((await json('DELETE', `/api/manufacturers/${sw.manufacturerId}`)).status).toBe(409);
    // Modell löschen: Drucker behält den Text, das Teil die anderen Modelle
    expect((await json('DELETE', `/api/printer-models/${sw.id}`)).status).toBe(204);
    expect(await getPrinter(printer.id)).toMatchObject({
      modelId: null,
      model: 'Artillery Sidewinder X2',
    });
    expect((await json<SparePart>('GET', url)).body.modelIds).toEqual([p1s.id]);
  });
});

describe('Ersatzteil-Kategorien', () => {
  const NAMES: [string, string][] = [
    ['Düsenwischer', 'consumables'],
    ['Nozzle Wiper', 'consumables'],
    ['Düse 0,4 mm gehärtet', 'nozzle'],
    ['Hotend 0,4 mm', 'hotend'],
    ['Hotend-Silikonsocke', 'hotend'],
    ['Thermistor Heizbett', 'bed'],
    ['Filamentschneider-Klinge', 'extruder'],
    ['Filament Cutter', 'extruder'],
    ['PTFE-Schlauch', 'feed'],
    ['AMS Zahnrad-Einheit', 'ams'],
    ['Klammer', 'other'],
    ['Bauteillüfter', 'cooling'],
    ['GT2-Riemen', 'drive'],
    ['Linearwelle 8 mm', 'axes'],
    ['Mainboard', 'control'],
    ['Netzteil 350 W', 'electronics'],
    ['Aktivkohlefilter P1S', 'enclosure'],
  ];

  it('ordnet Namen einer Kategorie zu', () => {
    for (const [name, key] of NAMES) expect([name, guessPartCategory(name)]).toEqual([name, key]);
  });

  it('Migration ordnet bestehende Teile wie guessPartCategory zu', () => {
    const src = fileURLToPath(new URL('../drizzle', import.meta.url));
    const dir = mkdtempSync(path.join(tmpdir(), '3dapp-kat-'));
    const old = path.join(dir, 'drizzle');
    cpSync(src, old, { recursive: true });
    const journalFile = path.join(old, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((e) => e.tag < '0020');
    writeFileSync(journalFile, JSON.stringify(journal));
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: old });
    const insert = sqlite.prepare('INSERT INTO spare_parts (name) VALUES (?)');
    for (const [name] of NAMES) insert.run(name);
    migrate(db, { migrationsFolder: src });
    const rows = sqlite
      .prepare(
        `SELECT sp.name, pc.key FROM spare_parts sp JOIN part_categories pc ON pc.id = sp.category_id ORDER BY sp.id`,
      )
      .all() as { name: string; key: string }[];
    expect(rows.map((r) => [r.name, r.key])).toEqual(NAMES);
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('über die API', () => {
    let built: Awaited<ReturnType<typeof buildApp>>;
    async function json<T>(
      method: 'GET' | 'POST' | 'PUT' | 'DELETE',
      url: string,
      payload?: object,
    ) {
      const res = await built.app.inject({ method, url, payload });
      return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
    }
    const list = async () => (await json<PartCategory[]>('GET', '/api/part-categories')).body;
    beforeEach(async () => {
      built = await buildApp({ dbFile: ':memory:', uploadDir: tmpdir() });
    });
    afterEach(() => built.app.close());

    it('mitgelieferte Liste, eigene anlegen, sortieren, umbenennen, löschen', async () => {
      const seeded = await list();
      expect(seeded.map((c) => c.name)).toEqual([
        'Hotend',
        'Düsen',
        'Extruder',
        'Filamentführung',
        'AMS / MMU',
        'Druckbett',
        'Achsen & Führungen',
        'Antrieb & Motoren',
        'Kühlung',
        'Elektronik',
        'Steuerung',
        'Gehäuse',
        'Wartung & Verbrauchsmaterial',
        'Sonstiges',
      ]);
      const own = await json<PartCategory>('POST', '/api/part-categories', { name: 'Werkzeug' });
      expect(own.status).toBe(201);
      expect(own.body.key).toMatch(/^c-/);
      expect((await json('POST', '/api/part-categories', { name: 'hotend' })).status).toBe(409);
      expect((await list()).at(-1)!.name).toBe('Werkzeug');

      // Eigene an den Anfang
      const ids = (await list()).map((c) => c.id);
      await json('PUT', '/api/part-categories/order', { ids: [own.body.id, ...ids.slice(0, -1)] });
      expect((await list())[0].name).toBe('Werkzeug');

      // Teil ohne Angabe: Kategorie aus dem Namen; mit Angabe die gewählte
      const hotend = seeded.find((c) => c.key === 'hotend')!;
      const auto = await json<SparePart>('POST', '/api/spare-parts', { name: 'Hotend 0,6 mm' });
      expect(auto.body.categoryId).toBe(hotend.id);
      const chosen = await json<SparePart>('POST', '/api/spare-parts', {
        name: 'Seitenschneider',
        categoryId: own.body.id,
      });
      expect(chosen.body.categoryId).toBe(own.body.id);
      expect((await json('POST', '/api/spare-parts', { name: 'X', categoryId: 9999 })).status).toBe(
        400,
      );

      // Umbenennen behält die Zuordnung (fester Schlüssel), Löschen macht „ohne Kategorie“
      await json('PUT', `/api/part-categories/${hotend.id}`, { name: 'Hotends' });
      expect((await list()).find((c) => c.key === 'hotend')!.name).toBe('Hotends');
      expect((await json('DELETE', `/api/part-categories/${own.body.id}`)).status).toBe(204);
      expect(
        (await json<SparePart>('GET', `/api/spare-parts/${chosen.body.id}`)).body.categoryId,
      ).toBeNull();
    });

    it('Ausführung unterscheidet sonst gleiche Teile; die Vorlage nimmt das Standardteil', async () => {
      const hard = await json<SparePart>('POST', '/api/spare-parts', {
        name: 'Hotend 0,4 mm',
        variant: '  gehärtet ',
        manufacturer: 'Bambu Lab',
      });
      expect(hard.body.variant).toBe('gehärtet');
      expect(partLabel(hard.body)).toBe('Hotend 0,4 mm – gehärtet');
      expect(
        (await json<SparePart>('PUT', `/api/spare-parts/${hard.body.id}`, { variant: '' })).body
          .variant,
      ).toBeNull();
      await json('PUT', `/api/spare-parts/${hard.body.id}`, { variant: 'gehärtet' });

      const hotend = P1_TEMPLATE.find((t) => t.part?.name === 'Hotend 0,4 mm')!;
      await json('POST', '/api/printers/1/maintenance-tasks', {
        items: [{ ...hotend, intervalHours: 2000 }],
      });
      const parts = (await json<SparePart[]>('GET', '/api/spare-parts')).body;
      expect(parts.map(partLabel).sort()).toEqual(['Hotend 0,4 mm', 'Hotend 0,4 mm – gehärtet']);
    });

    it('Vorlage legt Teile mit Kategorie an', async () => {
      const items = P1_TEMPLATE.filter((t) => t.part).slice(0, 3);
      expect(
        (
          await json('POST', '/api/printers/1/maintenance-tasks', {
            items: items.map((t) => ({ ...t, intervalMonths: t.intervalMonths ?? 1 })),
          })
        ).status,
      ).toBe(201);
      const cats = await list();
      const parts = (await json<SparePart[]>('GET', '/api/spare-parts')).body;
      for (const p of parts)
        expect(cats.find((c) => c.id === p.categoryId)?.key).toBe(guessPartCategory(p.name));
    });
  });
});
