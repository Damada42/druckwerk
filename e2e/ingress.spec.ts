import { expect, test } from '@playwright/test';
import { INGRESS_PORT } from '../playwright.config';
import { INGRESS_PATH } from './ingress-proxy';

/** So erreicht der Browser Druckwerk als Home-Assistant-App */
const BASE = `http://127.0.0.1:${INGRESS_PORT}${INGRESS_PATH}`;

test('Als Home-Assistant-App: Seiten, Daten und Bilder bleiben unter dem Ingress-Pfad', async ({
  page,
}) => {
  // Jede Anfrage an den HA-Server muss unter dem Ingress-Pfad liegen, sonst landet sie bei HA
  const outside: string[] = [];
  page.on('request', (r) => {
    const url = r.url();
    if (url.startsWith(`http://127.0.0.1:${INGRESS_PORT}/`) && !url.startsWith(`${BASE}/`))
      outside.push(url);
  });

  await page.goto(`${BASE}/`);
  await expect(page.getByRole('heading', { name: 'Übersicht', level: 1 })).toBeVisible();
  // Logo (relativ zur Basis) ist geladen
  await expect
    .poll(() =>
      page
        .locator('img[src="icon.svg"]')
        .first()
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);

  // Navigation im Router hängt am Ingress-Pfad
  await page.getByRole('link', { name: 'Drucker' }).first().click();
  await expect(page).toHaveURL(`${BASE}/drucker`);
  await expect(page.getByRole('region', { name: 'P1S', exact: true })).toBeVisible();

  // Neu laden auf einer Unterseite: index.html kommt mit dem richtigen <base href>
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Drucker', level: 1 })).toBeVisible();
  await expect(page.locator('base')).toHaveAttribute('href', `${INGRESS_PATH}/`);

  // Speichern über die API
  await page.goto(`${BASE}/kunden`);
  await page.getByRole('button', { name: 'Kunde' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill('Ingress Kunde');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Ingress Kunde')).toBeVisible();

  // Direkt aufgerufene Unterseite
  await page.goto(`${BASE}/projekte`);
  await expect(page.getByRole('heading', { name: 'Projekte', level: 1 })).toBeVisible();

  expect(outside).toEqual([]);
});
