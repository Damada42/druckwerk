import { expect, test } from '@playwright/test';

// Lagerplätze: einschalten, Regal mit Unterplätzen anlegen, Spule zuordnen, wieder ausschalten.
test.describe.configure({ mode: 'serial' });

test('Lagerplätze einrichten und Spulen zuordnen', async ({ page, request }) => {
  const spool = await (
    await request.post('/api/spools', {
      data: { typeId: 1, manufacturer: 'Lagertest', colorName: 'Ocker', location: 'Kiste' },
    })
  ).json();

  // Ausgeschaltet: kein Menüpunkt, freies Feld „Lagerort“
  await page.goto('/einstellungen');
  const nav = page.getByRole('complementary');
  await expect(nav.getByRole('link', { name: 'Lager' })).toHaveCount(0);
  // Gesteuertes Kästchen: legt sich erst nach dem Speichern um, daher click statt check
  await page.getByLabel(/Lagerplätze verwalten/).click();
  await expect(page.getByLabel(/Lagerplätze verwalten/)).toBeChecked();
  await expect(nav.getByRole('link', { name: 'Lager' })).toBeVisible();
  await page.getByRole('link', { name: /Lagerplätze einrichten/ }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Lager' })).toBeVisible();
  await page.getByRole('button', { name: 'Regal / Schrank' }).click();
  await page.getByLabel('Name des Lagerplatzes').fill('Wandregal');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.getByRole('button', { name: 'Fertig' }).click();

  await page.getByRole('button', { name: 'Unterplatz in Wandregal' }).click();
  for (const name of ['Rechts', 'Links']) {
    await page.getByLabel('Name des Lagerplatzes').fill(name);
    await page.getByRole('button', { name: 'Anlegen' }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Fertig' }).click();
  // Links vor Rechts sortieren
  await page.getByRole('button', { name: 'Links nach oben' }).click();
  await expect(page.getByRole('button', { name: 'Links nach oben' })).toBeDisabled();

  await page.getByRole('button', { name: 'Unterplatz in Links' }).click();
  await page.getByLabel('Name des Lagerplatzes').fill('Reihe 2');
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.getByRole('button', { name: 'Fertig' }).click();

  // Spule ohne Platz zeigt den alten Freitext und lässt sich direkt zuordnen
  const unplaced = page.locator('[aria-label="Ohne Lagerplatz"]');
  await expect(unplaced.getByText('bisher: Kiste')).toBeVisible();
  await unplaced
    .getByLabel(/Lagerplatz für PLA Lagertest Ocker/)
    .selectOption({ label: 'Wandregal › Links › Reihe 2' });
  const regal = page.locator('[aria-label="Lagerplatz Wandregal"]');
  await expect(regal.getByText('PLA Lagertest Ocker')).toBeVisible();
  await expect(regal.getByText(/^1 Spule/).first()).toBeVisible();

  // Auf der Filament-Seite steht der Pfad, im Formular die Auswahl
  await page.goto('/filament');
  await page.getByRole('button', { name: /Ocker/ }).click();
  await expect(page.getByText('Wandregal › Links › Reihe 2')).toBeVisible();
  await page.getByRole('button', { name: 'Bearbeiten' }).last().click();
  await expect(page.getByRole('dialog').getByLabel('Lagerplatz')).toHaveValue(
    String((await (await request.get(`/api/spools/${spool.id}`)).json()).storageLocationId),
  );
  await page.getByRole('button', { name: 'Abbrechen' }).click();

  // Regal löschen: Spule verliert nur den Platz
  await page.goto('/lager');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Wandregal löschen' }).click();
  await expect(page.getByText('Noch keine Lagerplätze')).toBeVisible();
  const after = await (await request.get(`/api/spools/${spool.id}`)).json();
  expect(after.storageLocationId).toBeNull();

  // Wieder ausschalten, damit die anderen Tests das alte Formular sehen
  await request.put('/api/settings', { data: { storageLocations: false } });
  await request.delete(`/api/spools/${spool.id}`);
});
