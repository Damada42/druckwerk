import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';

/** Einträge in „Filament wird knapp“ auf der Übersicht */
async function lowList(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Filament wird knapp' })).toBeVisible();
  const list = page.getByRole('list', { name: 'Knappes Filament' });
  return (await list.count()) ? list.innerText() : '';
}

test('Mindestmengen: je Hersteller oder nur je Farbe, Vorgabe des Typs, eigene Menge der Sorte', async ({
  page,
  request,
}) => {
  const types = (await (await request.get('/api/filament-types')).json()) as {
    id: number;
    name: string;
  }[];
  const pla = types.find((t) => t.name === 'PLA')!.id;
  const base = { typeId: pla, colorName: 'Knappgelb', colorHex: '#ffee00', weightTotalG: 1000 };
  await request.post('/api/spools', {
    data: { ...base, manufacturer: 'Sunlu', weightRemainingG: 800 },
  });
  await request.post('/api/spools', {
    data: { ...base, manufacturer: 'Bambu Lab', weightRemainingG: 150 },
  });

  // Nach Hersteller (Standard): Bambu Lab Knappgelb mit 150 g ist knapp
  expect(await lowList(page)).toContain('Bambu Lab Knappgelb');

  // Nur nach Farbe: 950 g Knappgelb reichen
  await page.goto('/einstellungen');
  await page.getByLabel('Nur nach Farbe (alle Hersteller zusammen)').click();
  await expect(page.getByLabel('Nur nach Farbe (alle Hersteller zusammen)')).toBeChecked();
  expect(await lowList(page)).not.toContain('Knappgelb');
  await page.goto('/einstellungen');
  await page.getByLabel('Nach Hersteller und Farbe').click();
  await expect(page.getByLabel('Nach Hersteller und Farbe')).toBeChecked();

  // Eigene Mindestmenge der Sorte direkt in der Filament-Liste
  await page.goto('/filament');
  const own = page.getByLabel('Mindestmenge Knappgelb Bambu Lab');
  await expect(own).toHaveAttribute('placeholder', '200');
  await own.fill('100');
  await own.press('Enter');
  await expect
    .poll(async () => (await lowList(page)).includes('Knappgelb'), { timeout: 5_000 })
    .toBe(false);

  // Vorgabe des Typs: knapp unter 900 g trifft Sunlu (800 g), Bambu Lab behält seine 100 g
  await page.goto('/einstellungen');
  const typeMin = page.getByLabel('Mindestmenge PLA', { exact: true });
  await typeMin.fill('900');
  await typeMin.press('Enter');
  await expect
    .poll(async () => (await request.get('/api/filament-types')).json())
    .toContainEqual(expect.objectContaining({ name: 'PLA', minStockG: 900 }));
  const low = await lowList(page);
  expect(low).toContain('Sunlu Knappgelb');
  expect(low).toContain('min. 900 g');
  expect(low).not.toContain('Bambu Lab Knappgelb');

  // Zurück auf die Vorgabe, damit spätere Tests unbeeinflusst bleiben
  await request.put(`/api/filament-types/${pla}`, { data: { minStockG: 200 } });
});

test('Herstellerliste: neuer Hersteller direkt im Spulen-Formular, danach in der Liste', async ({
  page,
}) => {
  await page.goto('/filament');
  await page.getByRole('button', { name: 'Spule', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Hersteller *').selectOption('＋ Neuer Hersteller …');
  await dialog.getByPlaceholder('Name des Herstellers').fill('Testwerk Filament');
  await dialog.getByLabel('Farbe *', { exact: true }).fill('Testgrau');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Testwerk Filament')).toBeVisible();

  await page.goto('/einstellungen');
  await expect(page.getByRole('button', { name: 'Testwerk Filament umbenennen' })).toBeVisible();
  // Doppelt in anderer Schreibweise geht nicht
  await page.getByLabel('Neuer Hersteller').fill('testwerk filament');
  await page.getByLabel('Neuer Hersteller').press('Enter');
  await expect(page.getByText('Diesen Hersteller gibt es schon.')).toBeVisible();
});

test('Backup: herunterladen und wieder einspielen', async ({ page, request }, info) => {
  const spools = async () =>
    ((await (await request.get('/api/spools')).json()) as unknown[]).length;
  const before = await spools();
  await page.goto('/einstellungen');
  const save = page.getByRole('group', { name: 'Bereiche sichern' });
  await expect(save.getByRole('checkbox', { name: 'Alles' })).toBeChecked();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Backup herunterladen' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^druckwerk-backup-\d+\.zip$/);
  const file = info.outputPath('backup.zip');
  await download.saveAs(file);

  // Nur Kunden und Filament sichern
  await save.getByRole('checkbox', { name: 'Alles' }).uncheck();
  await expect(page.getByRole('button', { name: 'Backup herunterladen' })).toBeDisabled();
  await save.getByRole('checkbox', { name: /^Kunden/ }).check();
  await save.getByRole('checkbox', { name: /^Filament/ }).check();
  const [partial] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Backup herunterladen' }).click(),
  ]);
  expect(partial.suggestedFilename()).toMatch(/^druckwerk-backup-teil-\d+\.zip$/);
  const partFile = info.outputPath('teil.zip');
  await partial.saveAs(partFile);

  // Vor dem Einspielen sieht man, was drin ist; nicht enthaltene Bereiche sind gesperrt
  await page.getByTestId('backup-file').setInputFiles(partFile);
  const load = page.getByRole('group', { name: 'Bereiche einspielen' });
  await expect(load.getByText(`${before} Spulen`)).toBeVisible();
  await expect(load.getByRole('checkbox', { name: /^Projekte/ })).toBeDisabled();
  await expect(load.getByRole('checkbox', { name: /^Kunden/ })).toBeChecked();
  await load.getByRole('checkbox', { name: /^Kunden/ }).uncheck();
  page.once('dialog', (d) => {
    expect(d.message()).toContain('ersetzt: Filament.');
    void d.accept();
  });
  await page.getByRole('button', { name: 'Einspielen', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Backup eingespielt: Filament.');
  expect(await spools()).toBe(before);

  // Komplettes Backup: alles vorausgewählt
  await page.getByTestId('backup-file').setInputFiles(file);
  await expect(load.getByRole('checkbox', { name: 'Alles' })).toBeChecked();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Einspielen', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Backup eingespielt: Projekte, Kunden');
  expect(await spools()).toBe(before);

  // Keine ZIP-Datei: verständliche Meldung, Daten bleiben
  const junk = info.outputPath('kaputt.zip');
  writeFileSync(junk, 'kein zip');
  await page.getByTestId('backup-file').setInputFiles(junk);
  await expect(page.getByText('Das ist keine ZIP-Datei von Druckwerk.')).toBeVisible();
  expect(await spools()).toBe(before);
});
