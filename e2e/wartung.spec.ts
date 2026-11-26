import { expect, test } from '@playwright/test';
import { FAKE_HA_PORT } from '../playwright.config';

// Läuft nach printer.spec.ts: der P1S ist mit dem nachgebauten Home Assistant verknüpft.
test.describe.configure({ mode: 'serial' });

const HA = `http://127.0.0.1:${FAKE_HA_PORT}`;
const DEVICE = '671ed8fd7336dc7aba6d6faa4470f6e6';
const HOURS = 'sensor.the_one_gesamtnutzung';

test('Wartung: Vorlage übernehmen, Stunden aus HA, Hinweis, erledigt und rückgängig', async ({
  page,
  request,
}) => {
  const setHours = async (hours: string) =>
    expect((await request.post(`${HA}/test/set`, { data: [HOURS, hours] })).status()).toBe(204);
  await setHours('1752.96');

  await page.goto('/einstellungen');
  await page.getByRole('checkbox', { name: /Ersatzteile und Wartungsplan/ }).check();
  await expect(page.getByLabel('Vorwarnung (Betriebsstunden vorher)')).toHaveValue('300');

  const printers = (await (await request.get('/api/printers')).json()) as {
    id: number;
    name: string;
    haDeviceId: string | null;
  }[];
  const p1s = printers.find((p) => p.haDeviceId === DEVICE)!;
  // Der Hintergrund-Abgleich übernimmt die Betriebsstunden aus Home Assistant
  await expect
    .poll(
      async () =>
        (
          (await (await request.get(`/api/printers/${p1s.id}`)).json()) as {
            operatingHours: number;
          }
        ).operatingHours,
    )
    .toBe(1752.96);

  await page.goto('/drucker');
  const section = page
    .getByRole('region', { name: p1s.name, exact: true })
    .getByRole('region', { name: `Wartung ${p1s.name}` });
  await expect(section.getByTestId('operating-hours')).toHaveText('1.753 h');
  await expect(section.getByText('aus Home Assistant')).toBeVisible();
  await expect(section.getByRole('button', { name: 'Betriebsstunden ändern' })).toHaveCount(0);

  // Vorlage: Punkte mit Bambus Monatsintervall sind vorausgewählt; nur Kohlenstoffstangen (1 Monat
  // laut Wiki) und dazu das Hotend (eigenes Intervall in Stunden)
  await section.getByRole('button', { name: 'Vorlage übernehmen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Vorlage übernehmen' });
  await expect(dialog.getByRole('checkbox', { name: /^Z-Gewindespindeln/ })).toBeChecked();
  await expect(
    dialog.getByLabel('Z-Gewindespindeln reinigen und fetten Intervall Monate'),
  ).toHaveValue('3');
  await expect(
    dialog.getByText('Bambu: alle 3–5 Rollen, bei abrasivem Filament nach 1–2 Rollen'),
  ).toBeVisible();
  const wanted = ['Hotend tauschen', 'Kohlenstoffstangen X-Achse reinigen'];
  const boxes = dialog.getByRole('checkbox');
  for (let i = 0; i < (await boxes.count()); i++) {
    const box = boxes.nth(i);
    const name = (await box.locator('xpath=..').innerText()).split('\n')[0];
    await box.setChecked(wanted.includes(name));
  }
  await expect(dialog.getByText('Noch ohne Intervall: Hotend tauschen')).toBeVisible();
  await dialog.getByLabel('Hotend tauschen Intervall Stunden').fill('2000');
  await dialog.getByRole('button', { name: '2 Punkte übernehmen' }).click();
  await expect(dialog).toBeHidden();

  const tasks = section.getByRole('list', { name: 'Wartungspunkte' });
  await expect(tasks.getByRole('listitem')).toHaveCount(2);
  await expect(tasks.getByText('Hotend 0,4 mm · 0 auf Lager, 1 fehlt')).toBeVisible();
  await expect(tasks.getByText('In Ordnung')).toHaveCount(2);

  // Ersatzteil einlagern
  await page.goto('/ersatzteile');
  const part = page.getByRole('region', { name: 'Hotend 0,4 mm' });
  await expect(part.getByRole('link', { name: 'Shop' })).toHaveAttribute(
    'href',
    'https://store.bambulab.com/collections/spare-parts-for-p1-series',
  );
  await part.getByRole('button', { name: 'Hotend 0,4 mm eins mehr' }).click();
  await expect(part.getByTestId('stock')).toHaveText('1 Stück');

  // Push-Ziel: Companion App aus Home Assistant
  await page.goto('/einstellungen');
  await page.getByLabel('Gerät (Companion App)').selectOption({ label: 'Galaxy S25' });
  await page.getByRole('button', { name: 'Test senden' }).click();
  await expect(page.getByText('Testnachricht gesendet.')).toBeVisible();

  // 1750 h später: noch 250 h → bald fällig, in der Übersicht mit Lagerstand
  await setHours('3502.96');
  await expect
    .poll(
      async () =>
        (
          (await (await request.get(`/api/printers/${p1s.id}`)).json()) as {
            operatingHours: number;
          }
        ).operatingHours,
    )
    .toBe(3502.96);
  await page.goto('/');
  const due = page.getByRole('list', { name: 'Fällige Wartung' });
  await expect(due.getByText('Hotend tauschen')).toBeVisible();
  await expect(due.getByText('Bald fällig')).toBeVisible();
  await expect(due.getByText('noch 250 h')).toBeVisible();
  await expect(due.getByText('Hotend 0,4 mm · 1 auf Lager')).toBeVisible();

  // Push über die Companion App ging raus
  await expect
    .poll(async () => {
      const calls = (await (await request.get(`${HA}/test/calls`)).json()) as {
        domain: string;
        data: { title?: string };
      }[];
      return calls.filter((c) => c.domain === 'notify').map((c) => c.data.title);
    })
    .toEqual(['Druckwerk', `Wartung bald fällig: ${p1s.name}`]);

  // Wartung erledigt: Hotend ist vorausgewählt, Kohlenstoffstangen nicht
  await page.goto('/drucker');
  await section.getByRole('button', { name: 'Wartung erledigt' }).click();
  const done = page.getByRole('dialog', { name: 'Wartung erledigt' });
  await expect(done.getByRole('checkbox', { name: /^Hotend tauschen/ })).toBeChecked();
  await expect(done.getByRole('checkbox', { name: /^Kohlenstoffstangen/ })).not.toBeChecked();
  await done.getByLabel('Notiz').fill('Düse war verstopft');
  await done.getByRole('button', { name: 'Zähler zurücksetzen' }).click();
  await expect(done).toBeHidden();
  await expect(section.getByText(/1 Zähler zurückgesetzt, 1 Teil abgebucht/)).toBeVisible();
  await expect(tasks.getByText('Hotend 0,4 mm · 0 auf Lager, 1 fehlt')).toBeVisible();
  await expect(tasks.getByText('In Ordnung')).toHaveCount(2);

  // Protokoll und rückgängig
  await section.getByRole('button', { name: 'Protokoll' }).click();
  const log = section.getByRole('list', { name: 'Wartungsprotokoll' });
  await expect(log.getByText('Hotend tauschen (1 abgebucht)')).toBeVisible();
  await expect(log.getByText('Düse war verstopft')).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await log.getByRole('button', { name: 'Wartung rückgängig' }).click();
  await expect(section.getByText('Noch keine Wartung eingetragen.')).toBeVisible();
  await expect(tasks.getByText('Bald fällig')).toBeVisible();
  await expect(tasks.getByText('Hotend 0,4 mm · 1 auf Lager')).toBeVisible();

  await setHours('1752.96');
});
