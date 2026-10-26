import { expect, test } from '@playwright/test';

/**
 * Hinter Authentik (Cloudflare-Tunnel → Outpost → Druckwerk) leitet der Outpost nach Ablauf der
 * Sitzung jede Anfrage zur Anmeldung um. Die App soll dann neu laden statt leere Listen zu zeigen.
 */
test('Abgelaufene Anmeldung am Login-Proxy: Seite lädt neu, statt leer zu bleiben', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Übersicht' })).toBeVisible();

  // Einmal so antworten wie der Outpost bei abgelaufener Sitzung
  let redirected = false;
  // Den HA-Status lädt erst die Drucker-Seite – sicher eine frische Anfrage
  await page.route('**/api/ha/status', async (route) => {
    if (redirected) return route.continue();
    redirected = true;
    await route.fulfill({
      status: 302,
      headers: { location: 'https://auth.example.test/application/o/authorize/' },
    });
  });

  const reloaded = page.waitForEvent('load');
  await page.getByRole('link', { name: 'Drucker' }).first().click();
  await reloaded;
  expect(redirected).toBe(true);
  // Nach dem Neuladen (in echt: nach dem Login) ist alles wieder da
  await expect(page.getByRole('heading', { level: 1, name: 'Drucker' })).toBeVisible();
  await expect(page.getByText('Anmeldung abgelaufen')).toBeHidden();
});
