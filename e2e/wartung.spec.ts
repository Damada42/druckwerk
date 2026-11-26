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
  // Teile aus der Vorlage passen zum Modell des Druckers
  await expect(part.getByText('Bambu Lab P1S')).toBeVisible();

  // Nachrichten: Companion App und ein Telegram-Chat aus Home Assistant
  await page.goto('/einstellungen');
  await page.getByRole('checkbox', { name: 'Galaxy S25' }).check();
  await expect(page.getByRole('checkbox', { name: 'Galaxy S25' })).toBeChecked();
  await page.getByRole('checkbox', { name: 'Werkstatt (222)' }).check();
  await expect(page.getByRole('checkbox', { name: 'Werkstatt (222)' })).toBeChecked();
  // Vorlage „Kurz“ in der Vorschau
  await page.getByLabel('Textvorlage').selectOption({ label: 'Kurz' });
  await expect(page.getByLabel('Vorschau')).toContainText('2 Wartungspunkt(e) bald fällig');
  await page.getByLabel('Textvorlage').selectOption({ label: 'Standard' });
  await expect(page.getByLabel('Titel')).toHaveValue('Wartung {stufe}: {drucker}');
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

  // Nachricht ging an die Companion App und an Telegram
  await expect
    .poll(async () => {
      const calls = (await (await request.get(`${HA}/test/calls`)).json()) as {
        domain: string;
        service: string;
        entityId?: string;
        data: { title?: string };
      }[];
      return calls
        .filter((c) => c.domain === 'notify')
        .map((c) => `${c.entityId ?? c.service}: ${c.data.title}`)
        .sort();
    })
    .toEqual([
      'mobile_app_galaxy_s25: Test: Wartung bald fällig: P1S',
      `mobile_app_galaxy_s25: Wartung bald fällig: ${p1s.name}`,
      'notify.telegram_bot_111_222: Test: Wartung bald fällig: P1S',
      `notify.telegram_bot_111_222: Wartung bald fällig: ${p1s.name}`,
    ]);

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

test('Druckermodelle: in den Einstellungen anlegen, Ersatzteil für mehrere Modelle', async ({
  page,
}) => {
  await page.goto('/einstellungen');
  const card = page.getByRole('heading', { name: 'Druckermodelle' }).locator('..');
  await card.getByRole('button', { name: /^Prusa/ }).click();
  await expect(card.getByText('CORE One L+')).toBeVisible();
  // Neues Modell eines neuen Herstellers
  await card.locator('#new-model-maker').selectOption({ label: '＋ Neuer Hersteller …' });
  await card.locator('#new-model-maker').fill('Artillery');
  await card.getByLabel('Neues Druckermodell').fill('Sidewinder X1');
  await card.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(card.getByText('Sidewinder X1')).toBeVisible();

  // Ersatzteil für P1S und Sidewinder
  await page.goto('/ersatzteile');
  await page.getByRole('button', { name: 'Ersatzteil', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name *').fill('PTFE-Schlauch 1 m');
  // Der Hersteller des Teils zeigt gleich dessen Modelle – nur die von Bambu Lab
  await dialog
    .getByRole('combobox', { name: 'Hersteller', exact: true })
    .selectOption({ label: 'Bambu Lab' });
  await expect(dialog.getByRole('button', { name: 'MK4S' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'P1S', exact: true }).click();
  // Passt auch für einen Drucker eines anderen Herstellers
  await dialog.getByLabel('Hersteller für passende Modelle').selectOption({ label: 'Artillery' });
  await dialog.getByRole('button', { name: 'Sidewinder X1', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Bambu Lab P1S entfernen' })).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Artillery Sidewinder X1 entfernen' }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();
  const part = page.getByRole('region', { name: 'PTFE-Schlauch 1 m' });
  await expect(part.getByText('Bambu Lab P1S, Artillery Sidewinder X1')).toBeVisible();

  // Filter nach Modell
  await page
    .getByLabel('Nach Druckermodell filtern')
    .selectOption({ label: 'Artillery Sidewinder X1' });
  await expect(page.getByRole('region', { name: 'PTFE-Schlauch 1 m' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Hotend 0,4 mm' })).toHaveCount(0);
});

test('Ersatzteil: neuer Hersteller und neues Modell direkt im Formular', async ({ page }) => {
  await page.goto('/ersatzteile');
  await page.getByRole('button', { name: 'Ersatzteil', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name *').fill('Bauplatte 350');
  await dialog
    .getByRole('combobox', { name: 'Hersteller', exact: true })
    .selectOption({ label: '＋ Neuer Hersteller …' });
  await dialog.getByPlaceholder('Name des Herstellers').fill('Voron Design');
  await dialog.getByRole('button', { name: '＋ Modell von Voron Design anlegen' }).click();
  await dialog.getByLabel('Name des neuen Modells').fill('Voron 2.4');
  await dialog.getByRole('button', { name: 'Anlegen' }).click();
  await expect(
    dialog.getByRole('button', { name: 'Voron Design Voron 2.4 entfernen' }),
  ).toBeVisible();
  // Danach gleich in den Listen: Modell als Chip, Hersteller in der Auswahl
  await expect(dialog.getByRole('button', { name: 'Voron 2.4', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('region', { name: 'Bauplatte 350' }).getByText('Voron Design Voron 2.4'),
  ).toBeVisible();
  await page.goto('/einstellungen');
  const card = page.getByRole('heading', { name: 'Druckermodelle' }).locator('..');
  await card.getByRole('button', { name: /^Voron Design/ }).click();
  await expect(card.getByText('Voron 2.4')).toBeVisible();
});

test('Ersatzteile: Kategorien, Suche, nach Hersteller sortieren, zuklappen', async ({ page }) => {
  await page.goto('/ersatzteile');
  // Kategorie kam aus dem Namen
  const section = (name: string) => page.getByRole('region', { name, exact: true });
  await expect(section('Filamentführung').getByText('PTFE-Schlauch 1 m')).toBeVisible();
  await expect(section('Hotend').getByText('Hotend 0,4 mm')).toBeVisible();
  await expect(section('Druckbett').getByText('Bauplatte 350')).toBeVisible();

  // Zuklappen bleibt beim Neuladen
  await section('Hotend').locator('button[aria-expanded]').click();
  await expect(page.getByText('Hotend 0,4 mm')).toBeHidden();
  await page.reload();
  await expect(section('Hotend').locator('button[aria-expanded]')).toHaveAttribute(
    'aria-expanded',
    'false',
  );

  // Suche nach Namen zeigt Treffer auch in zugeklappten Abschnitten
  await page.getByLabel('Ersatzteile suchen').fill('hotend');
  await expect(page.getByText('Hotend 0,4 mm')).toBeVisible();
  await expect(section('Filamentführung')).toHaveCount(0);
  await page.getByLabel('Ersatzteile suchen').fill('gibtsnicht');
  await expect(
    page.getByText('Kein Ersatzteil mit „gibtsnicht“ im Namen oder in den Notizen.'),
  ).toBeVisible();
  await page.getByLabel('Ersatzteile suchen').fill('');

  // Nach Hersteller
  await page.getByLabel('Sortieren nach').selectOption({ label: 'Nach Hersteller' });
  await expect(section('Bambu Lab').getByText('Hotend 0,4 mm')).toBeVisible();
  await expect(section('Voron Design').getByText('Bauplatte 350')).toBeVisible();
  await page.getByLabel('Sortieren nach').selectOption({ label: 'Nach Kategorie' });

  // Eigene Kategorie in den Einstellungen, dann beim Teil wählen
  await page.goto('/einstellungen');
  const cats = page.getByRole('region', { name: 'Ersatzteil-Kategorien' });
  await cats.getByLabel('Neue Kategorie').fill('Werkzeug');
  await cats.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(cats.getByText('Werkzeug')).toBeVisible();
  await cats.getByRole('button', { name: 'Werkzeug nach oben' }).click();
  await expect(cats.getByRole('listitem').nth(-2)).toContainText('Werkzeug');

  await page.goto('/ersatzteile');
  await page.getByRole('button', { name: 'Ersatzteil', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name *').fill('Düse 0,6 mm');
  // Vorschlag aus dem Namen, selbst gewählt bleibt
  await expect(dialog.getByRole('combobox', { name: 'Kategorie' })).toHaveValue(/\d+/);
  await expect(
    dialog.getByRole('combobox', { name: 'Kategorie' }).locator('option:checked'),
  ).toHaveText('Düsen');
  await dialog.getByRole('combobox', { name: 'Kategorie' }).selectOption({ label: 'Werkzeug' });
  await dialog.getByLabel('Name *').fill('Düsenschlüssel');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();
  await expect(section('Werkzeug').getByText('Düsenschlüssel')).toBeVisible();
});

test('Ersatzteil kopieren, Notiz in der Übersicht und in der Suche', async ({ page }) => {
  await page.goto('/ersatzteile');
  const hotend = page.getByRole('region', { name: 'Hotend 0,4 mm', exact: true });
  await hotend.getByRole('button', { name: 'Hotend 0,4 mm kopieren' }).click();
  const dialog = page.getByRole('dialog', { name: 'Ersatzteil kopieren' });
  // Alles übernommen außer dem Bestand
  await expect(dialog.getByLabel('Name *')).toHaveValue('Hotend 0,4 mm');
  await expect(dialog.getByRole('button', { name: 'Bambu Lab P1S entfernen' })).toBeVisible();
  await expect(dialog.getByLabel('Auf Lager (Stück)')).toHaveValue('0');
  await dialog.getByLabel('Ausführung').fill('gehärtet');
  // Kategorie bleibt die des Originals
  await expect(
    dialog.getByRole('combobox', { name: 'Kategorie' }).locator('option:checked'),
  ).toHaveText('Hotend');
  await dialog.getByLabel('Notizen').fill('Gehärteter Stahl, für CF/GF-Filamente');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();

  // Gleicher Name, die Ausführung unterscheidet die beiden
  const copy = page.getByRole('region', { name: 'Hotend 0,4 mm – gehärtet', exact: true });
  await expect(copy.getByText('gehärtet', { exact: true })).toBeVisible();
  await expect(copy.getByTestId('notes')).toHaveText('Gehärteter Stahl, für CF/GF-Filamente');
  await expect(copy.getByText('Bambu Lab P1S')).toBeVisible();
  // Das Original bleibt unverändert
  await expect(hotend.getByTestId('stock')).not.toHaveText('0 Stück');

  // Suche findet auch Text aus der Notiz
  await page.getByLabel('Ersatzteile suchen').fill('stahl');
  await expect(copy).toBeVisible();
  await expect(hotend).toHaveCount(0);
});
