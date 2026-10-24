import { expect, test, type Page } from '@playwright/test';

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test('Handy: untere Navigation statt Seitenleiste', async ({ page }) => {
  await page.goto('/');
  const bottomNav = page.locator('nav').last();
  await expect(bottomNav).toBeVisible();
  await expect(page.locator('aside')).toBeHidden();
  await expectNoHorizontalScroll(page);

  for (const [label, heading] of [
    ['Projekte', 'Projekte'],
    ['Kunden', 'Kunden'],
    ['Filament', 'Filament'],
    ['Drucker', 'Drucker'],
    ['Übersicht', 'Übersicht'],
  ]) {
    await bottomNav.getByRole('link', { name: label }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
});

test('Handy: Projekt-Dialog passt auf den Bildschirm', async ({ page }) => {
  await page.goto('/projekte');
  await page.getByRole('button', { name: 'Neues Projekt' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  await expect(dialog.getByRole('button', { name: 'Speichern' })).toBeInViewport();
  await dialog.getByRole('button', { name: 'Schließen' }).click();
  await expect(dialog).toBeHidden();
});
