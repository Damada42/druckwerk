import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

// Die Tests bauen aufeinander auf: Kunde, Person und Spule werden später im Projekt verwendet.
test.describe.configure({ mode: 'serial' });

const dialog = (page: Page) => page.getByRole('dialog');
const column = (page: Page, name: string) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) });

/** Karte mit der Maus schrittweise ziehen, wie ein Mensch (dnd-kit braucht mehrere Bewegungen). */
async function dragTo(
  page: Page,
  from: ReturnType<Page['locator']>,
  to: ReturnType<Page['locator']>,
) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + 60, { steps: 20 });
  await page.mouse.up();
}

test('Übersicht führt zu allen Bereichen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Übersicht' })).toBeVisible();

  const targets: [RegExp, string][] = [
    [/^Projekte/, 'Projekte'],
    [/^Kunden/, 'Kunden'],
    [/^Team/, 'Team'],
    [/^Filament/, 'Filament'],
    [/^Drucker/, 'Drucker'],
    [/^Einstellungen/, 'Einstellungen'],
  ];
  for (const [tile, heading] of targets) {
    await page.goto('/');
    await page.getByRole('main').getByRole('link', { name: tile }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }
});

test('Kunde anlegen und suchen', async ({ page }) => {
  await page.goto('/kunden');
  await page.getByRole('button', { name: 'Kunde', exact: true }).click();
  // Speichern bleibt gesperrt, solange der Pflichtname fehlt
  await expect(dialog(page).getByRole('button', { name: 'Speichern' })).toBeDisabled();
  await dialog(page).getByLabel('Name *').fill('Erika Muster');
  await dialog(page).getByLabel('Firma').fill('Muster GmbH');
  await dialog(page).getByLabel('E-Mail').fill('erika@example.com');
  await dialog(page).getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog(page)).toBeHidden();

  await page.getByRole('button', { name: 'Kunde', exact: true }).click();
  await dialog(page).getByLabel('Name *').fill('Otto Normal');
  await dialog(page).getByLabel('Name *').press('Enter');
  await expect(dialog(page)).toBeHidden();

  const main = page.getByRole('main');
  await expect(main.getByText('Erika Muster')).toBeVisible();
  await expect(main.getByText('Otto Normal')).toBeVisible();
  await page.getByPlaceholder('Suchen…').fill('muster');
  await expect(main.getByText('Erika Muster')).toBeVisible();
  await expect(main.getByText('Otto Normal')).toBeHidden();
});

test('Teammitglied anlegen', async ({ page }) => {
  await page.goto('/personen');
  await page.getByRole('button', { name: 'Person', exact: true }).click();
  await dialog(page).getByLabel('Name *').fill('Max Helfer');
  await dialog(page)
    .getByLabel(/Notizen/)
    .fill('Löten, Elektronik');
  await dialog(page).getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('main').getByText('Max Helfer')).toBeVisible();
  await expect(page.getByText('In keinem Projekt')).toBeVisible();
});

test('Filamentspule anlegen und Verbrauch abbuchen', async ({ page }) => {
  await page.goto('/filament');
  await page.getByRole('button', { name: 'Spule', exact: true }).click();
  await dialog(page).getByLabel('Filamenttyp *').selectOption({ label: 'PLA' });
  await dialog(page).getByLabel('Hersteller *').selectOption('Bambu Lab');
  await dialog(page).getByLabel('Farbe *').fill('Galaxy Blau');
  await dialog(page).getByLabel('Art / Finish').selectOption({ label: 'Silk' });
  await dialog(page).getByLabel('Preis pro Spule (€)').fill('20');
  await dialog(page).getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog(page)).toBeHidden();

  // Typ → Gruppe (Farbe, Finish, Hersteller) → einzelne Spule
  await expect(page.getByRole('heading', { name: 'PLA' })).toBeVisible();
  await page.getByRole('button', { name: /Galaxy Blau/ }).click();
  await expect(page.getByText(/1 kg\s*von 1 kg/)).toBeVisible();

  await page.getByTitle('Verbrauch abbuchen').click();
  await dialog(page)
    .getByLabel(/Verbrauchte Menge/)
    .fill('250');
  await dialog(page).getByRole('button', { name: 'Abbuchen' }).click();
  await expect(page.getByText(/750 g\s*von 1 kg/)).toBeVisible();
});

test('Drucker zeigt Kosten pro Druckstunde wie im Excel', async ({ page }) => {
  await page.goto('/drucker');
  await expect(page.getByText('Bambu Lab P1S')).toBeVisible();
  const table = page.getByRole('table');
  await expect(table).toBeVisible();
  await expect(table.getByRole('row', { name: /Stromkosten\/h/ })).toContainText('0,032 €');
  await expect(table.getByRole('row', { name: /Abnutzung\/h/ })).toContainText('0,800 €');
  await expect(table.getByRole('row', { name: /Wartungskosten\/h/ })).toContainText('0,600 €');
  await expect(table.getByRole('row', { name: /Summe pro Druckstunde/ })).toContainText('1,432 €');
});

test('Projekt mit Team, Material, Zusatzkosten anlegen und Kosten prüfen', async ({ page }) => {
  await page.goto('/projekte');
  await page.getByRole('button', { name: 'Neues Projekt' }).click();
  const d = dialog(page);
  await d.getByLabel('Titel *').fill('Smarte Nachttischlampe');
  await d.getByLabel('Kunde').selectOption({ label: 'Erika Muster (Muster GmbH)' });
  await d.getByLabel('Drucker').selectOption({ label: 'P1S (Bambu Lab P1S)' });
  await d.getByLabel(/Druckzeit/).fill('3');
  await d.getByLabel('Verkaufspreis (€)').fill('50');
  await d.getByLabel('Priorität').selectOption({ label: 'Hoch' });

  await d.getByRole('button', { name: 'Team' }).click();
  await d
    .locator('select')
    .filter({ hasText: 'Person hinzufügen' })
    .selectOption({ label: 'Max Helfer' });
  await expect(d.getByText('Max Helfer')).toBeVisible();

  await d.getByRole('button', { name: /^Material/ }).click();
  await d.locator('select').filter({ hasText: 'Filament hinzufügen' }).selectOption({ index: 1 });
  await d.getByLabel('Geplant (g)').fill('100');

  await d.getByRole('button', { name: /^Zusatzkosten/ }).click();
  await d.getByRole('button', { name: 'Position hinzufügen' }).click();
  await d.getByLabel('Beschreibung').fill('Arduino Nano');
  await d.getByLabel('Preis je Einheit €').fill('8');

  // 100 g × 0,02 €/g = 2,00 € · 3 h × 1,432 €/h = 4,30 € · Zusatz 8,00 € → 14,30 €, Gewinn 35,70 €
  await expect(d.getByText('Material', { exact: true }).locator('..')).toContainText('2,00');
  await expect(d.getByText('Maschine', { exact: true }).locator('..')).toContainText('4,30');
  await expect(d.getByText('Kosten gesamt').locator('..')).toContainText('14,30');
  await expect(d.getByText('Gewinn').locator('..')).toContainText('35,70');

  // Speichern lässt das Fenster offen und meldet es; ein neues Projekt bekommt seine Adresse
  await d.getByRole('button', { name: 'Speichern' }).click();
  await expect(d.getByRole('status')).toHaveText('Gespeichert');
  await expect(page).toHaveURL(/\/projekte\/\d+$/);
  await expect(d.getByRole('heading', { name: 'Smarte Nachttischlampe' })).toBeVisible();
  await d.getByRole('button', { name: 'Schließen', exact: true }).last().click();
  await expect(d).toBeHidden();

  const card = column(page, 'Offen').locator('article', { hasText: 'Smarte Nachttischlampe' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Erika Muster');
  await expect(card).toContainText('Hoch');
  await expect(card.getByTitle('Max Helfer')).toBeVisible();
});

test('Projektkarte per Drag & Drop verschieben – bleibt nach Neuladen', async ({ page }) => {
  await page.goto('/projekte');
  const card = page.locator('article', { hasText: 'Smarte Nachttischlampe' });
  await dragTo(page, card, column(page, 'In Arbeit'));
  await expect(
    column(page, 'In Arbeit').locator('article', { hasText: 'Smarte Nachttischlampe' }),
  ).toBeVisible();
  // Nach dem Loslassen darf sich kein Detail-Dialog öffnen
  await expect(dialog(page)).toBeHidden();

  await page.reload();
  await expect(
    column(page, 'In Arbeit').locator('article', { hasText: 'Smarte Nachttischlampe' }),
  ).toBeVisible();
  await expect(
    column(page, 'Offen').locator('article', { hasText: 'Smarte Nachttischlampe' }),
  ).toHaveCount(0);

  await dragTo(page, card, column(page, 'Erledigt'));
  await page.reload();
  await expect(
    column(page, 'Erledigt').locator('article', { hasText: 'Smarte Nachttischlampe' }),
  ).toBeVisible();
});

test('Rechnung mit PDF hochladen', async ({ page, request }) => {
  await page.goto('/projekte');
  await page.getByRole('heading', { name: 'Smarte Nachttischlampe' }).click();
  const d = dialog(page);
  await d.getByRole('button', { name: /^Rechnungen/ }).click();
  await d.getByLabel('Betrag (€)').fill('8,00');
  await d.getByLabel('Rechnungsnummer').fill('RE-4711');
  await d.getByLabel('Beschreibung').fill('Arduino bei Reichelt');
  await d
    .locator('input[type=file]')
    .first()
    .setInputFiles(path.join(__dirname, 'fixtures', 'rechnung.pdf'));
  await expect(d.getByText('rechnung.pdf')).toBeVisible();
  await d.getByRole('button', { name: 'Hinzufügen' }).click();

  const item = d.getByRole('listitem').filter({ hasText: 'Arduino bei Reichelt' });
  await expect(item).toContainText('Nr. RE-4711');
  await expect(item).toContainText('8,00');
  // Anhang öffnet in der App
  await item.getByRole('button', { name: 'Datei ansehen' }).click();
  const viewer = page.getByRole('dialog', { name: 'rechnung.pdf' });
  // Die Test-Datei ist nur ein PDF-Gerüst ohne Seiten: Hinweis statt Vorschau, Herunterladen geht
  await expect(viewer.getByText(/keine Vorschau/)).toBeVisible();
  await expect(viewer.getByRole('link', { name: 'Herunterladen' })).toBeVisible();
  await viewer.getByRole('button', { name: 'Schließen' }).click();
  const projects = (await (await request.get('/api/projects')).json()) as {
    title: string;
    invoices: { filePath: string }[];
  }[];
  const filePath = projects.find((p) => p.title === 'Smarte Nachttischlampe')!.invoices[0].filePath;
  const file = await request.get(filePath);
  expect(file.status()).toBe(200);
  expect((await file.body()).subarray(0, 4).toString()).toBe('%PDF');
  await expect(d.getByRole('button', { name: 'Rechnungen (1)' })).toBeVisible();
});

test('Projekt löschen mit Rückfrage', async ({ page }) => {
  await page.goto('/projekte');
  await page.getByRole('button', { name: 'Neues Projekt' }).click();
  await dialog(page).getByLabel('Titel *').fill('Wegwerf-Projekt');
  await dialog(page).getByRole('button', { name: 'Speichern' }).click();
  // Das Fenster bleibt nach dem Speichern offen, Löschen geht direkt
  await expect(dialog(page).getByRole('status')).toHaveText('Gespeichert');

  page.once('dialog', (confirm) => confirm.accept());
  await dialog(page).getByRole('button', { name: 'Löschen' }).click();
  await expect(page.locator('article', { hasText: 'Wegwerf-Projekt' })).toHaveCount(0);
});

test('Einstellungen: Typ hinzufügen, benutzter Typ ist geschützt', async ({ page }) => {
  await page.goto('/einstellungen');
  const types = page
    .locator('div')
    .filter({ has: page.getByRole('heading', { name: 'Filamenttypen' }) })
    .last();
  await types.getByPlaceholder('z.B. PLA-CF').fill('PLA-CF');
  await types.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(types.getByText('PLA-CF')).toBeVisible();

  page.once('dialog', (confirm) => confirm.accept());
  await types.getByRole('button', { name: 'PLA löschen', exact: true }).click();
  await expect(types.getByText('Wird noch verwendet')).toBeVisible();
});

test('Übersicht zeigt aktuelle Zahlen', async ({ page }) => {
  await page.goto('/');
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: /^Kunden/ })).toContainText('2 Kunden');
  await expect(main.getByRole('link', { name: /^Filament/ })).toContainText('1 Spule ·');
});
