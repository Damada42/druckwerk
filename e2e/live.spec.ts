import { expect, test } from '@playwright/test';
import { LIVE_EAN } from './global-setup';

test('Live-Scanner erkennt Barcode direkt im Kamerabild (über HTTPS)', async ({ page }) => {
  await page.goto('/filament');
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);

  await page.getByRole('button', { name: 'Scannen' }).click();
  const dialog = page.getByRole('dialog');
  // Über HTTPS bietet die App den Live-Modus statt des Foto-Umwegs an
  await expect(dialog.getByText('Live mit der Kamera')).toBeVisible();
  await dialog.getByRole('button', { name: 'Barcode / QR-Code scannen' }).click();

  await expect(dialog.locator('video')).toBeVisible();
  await expect(dialog.getByText(`Neuer Barcode ${LIVE_EAN}`)).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByLabel('Barcode', { exact: true })).toHaveValue(LIVE_EAN);
});
