import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { FAKE_HA_PORT } from '../playwright.config';

test.describe.configure({ mode: 'serial' });

/** Nachgebautes Home Assistant aus global-setup.ts (echte P1S-Daten) */
const HA = `http://127.0.0.1:${FAKE_HA_PORT}`;
const SLOT_2 = 'sensor.p1s_01p09a431900844_ams_1_slot_2';

async function setPrint(request: APIRequestContext, state: string, options: object = {}) {
  const res = await request.post(`${HA}/test/print`, { data: [state, options] });
  expect(res.status()).toBe(204);
}

async function haCalls(request: APIRequestContext) {
  return (await (await request.get(`${HA}/test/calls`)).json()) as { entityId: string }[];
}

const p1s = (page: Page) => page.getByRole('region', { name: 'P1S', exact: true });

let spoolId: number;

test('Home Assistant in den Einstellungen verbinden', async ({ page }) => {
  await page.goto('/einstellungen');
  await expect(page.getByText('Nicht eingerichtet')).toBeVisible();
  await page.getByLabel('Adresse').fill(`127.0.0.1:${FAKE_HA_PORT}`);
  await page.getByLabel('Token').fill('falsch');
  await page.getByRole('button', { name: 'Verbinden' }).click();
  await expect(page.getByText(/lehnt den Token ab/)).toBeVisible();

  await page.getByLabel('Token').fill('test-token');
  await page.getByRole('button', { name: 'Verbinden' }).click();
  await expect(page.getByText('Verbunden (HA 2026.10.4)')).toBeVisible();
  await expect(page.getByText(/Gefundene Drucker: the_one \(P1S\)/)).toBeVisible();
  // Token-Feld ist wieder leer, der Token bleibt auf dem Server
  await expect(page.getByLabel(/Neuer Token/)).toHaveValue('');
});

test('Drucker verknüpfen: Live-Status und AMS-Slots erscheinen', async ({ page, request }) => {
  await page.goto('/drucker');
  await expect(p1s(page).getByText(/Home-Assistant-Gerät wählen/)).toBeVisible();
  await page.getByRole('button', { name: 'P1S bearbeiten' }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Home-Assistant-Gerät (Live-Status)')
    .selectOption({ label: 'the_one (P1S)' });
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();

  const card = p1s(page);
  await expect(card.getByText('Bereit', { exact: true })).toBeVisible();
  await expect(card.getByText('29 °C')).toBeVisible();
  await expect(card.getByRole('listitem').filter({ hasText: 'A1' })).toContainText(
    'Bambu PETG Basic',
  );
  await expect(card.getByRole('listitem').filter({ hasText: 'A3' })).toContainText('61 %');

  // Spule aus dem Bestand dem Slot A2 zuordnen
  const types = (await (await request.get('/api/filament-types')).json()) as {
    id: number;
    name: string;
  }[];
  const res = await request.post('/api/spools', {
    data: {
      typeId: types.find((t) => t.name === 'PLA')!.id,
      manufacturer: 'Bambu Lab',
      colorName: 'Jade Weiß E2E',
      colorHex: '#f0f0ea',
      weightTotalG: 1000,
    },
  });
  spoolId = ((await res.json()) as { id: number }).id;
  await page.reload();
  const select = p1s(page).getByLabel('Spule in A2');
  const value = await select.locator('option', { hasText: 'Jade Weiß E2E' }).getAttribute('value');
  await select.selectOption(value!);
  await expect
    .poll(
      async () =>
        ((await (await request.get(`/api/spools/${spoolId}`)).json()) as { haTrayEntity: string })
          .haTrayEntity,
    )
    .toBe(SLOT_2);
});

test('AMS-Spule mit einem Klick in den Bestand übernehmen', async ({ page, request }) => {
  await page.goto('/drucker');
  const card = p1s(page);
  await card.getByRole('button', { name: 'A3 in Bestand übernehmen' }).click();
  // Danach ist die neue Spule im Slot gewählt und der Knopf verschwindet
  const select = card.getByLabel('Spule in A3');
  await expect(select.locator('option:checked')).toHaveText(/Bambu Lab PLA Dunkelblau · 610 g/);
  await expect(card.getByRole('button', { name: 'A3 in Bestand übernehmen' })).toBeHidden();
  await expect(card.getByText('Im Bestand als „Dunkelblau“')).toBeVisible();

  const spools = (await (await request.get('/api/spools')).json()) as {
    colorHex: string;
    haTrayEntity: string | null;
  }[];
  expect(
    spools.find((s) => s.haTrayEntity === 'sensor.p1s_01p09a431900844_ams_1_slot_3'),
  ).toMatchObject({
    colorHex: '#0a2989',
  });
});

test('Laufender Druck: Fortschritt, Pause, Licht – danach automatisch abgebucht', async ({
  page,
  request,
}) => {
  await page.goto('/drucker');
  await setPrint(request, 'running', {
    slot: 2,
    progress: 40,
    weight: 25,
    task: 'E2E-Halter',
    start: 'e2e-1',
  });
  // Im Leerlauf fragt die Seite nur alle 15 s nach: warten, bis der Server den Druck kennt, dann neu laden
  await expect
    .poll(
      async () =>
        ((await (await request.get('/api/printers/1/live')).json()) as { live?: { state: string } })
          .live?.state,
    )
    .toBe('running');
  await page.reload();
  const card = p1s(page);
  await expect(card.getByText('Druckt · 40 %')).toBeVisible();
  await expect(card.getByText('E2E-Halter')).toBeVisible();
  await expect(card.getByRole('progressbar')).toBeVisible();

  await card.getByRole('button', { name: 'Pause' }).click();
  await card.getByRole('button', { name: 'Licht einschalten' }).click();
  await expect
    .poll(async () => (await haCalls(request)).map((c) => c.entityId))
    .toEqual(['button.the_one_druckvorgang_anhalten', 'light.the_one_druckraumbeleuchtung']);
  await expect(card.getByRole('button', { name: 'Licht ausschalten' })).toBeVisible({
    timeout: 10_000,
  });

  // Der Server muss den aktiven Slot mindestens einmal beim Drucken gesehen haben
  await page.waitForTimeout(1500);
  await setPrint(request, 'finish', { slot: null, progress: 100 });
  await expect(card.getByText('Fertig', { exact: true })).toBeVisible({ timeout: 20_000 });
  const booking = card.getByRole('listitem').filter({ hasText: 'E2E-Halter' });
  await expect(booking).toContainText('25 g', { timeout: 10_000 });
  await expect(booking).toContainText('Jade Weiß E2E');

  const remaining = async () =>
    ((await (await request.get(`/api/spools/${spoolId}`)).json()) as { weightRemainingG: number })
      .weightRemainingG;
  expect(await remaining()).toBe(975);

  // Im Bestand ist die Spule als „im AMS“ markiert
  await page.goto('/filament');
  await page.getByText('Jade Weiß E2E').first().click();
  await expect(page.getByText('Im AMS, Slot 2').first()).toBeVisible();

  // Rückgängig machen
  await page.goto('/drucker');
  await p1s(page)
    .getByRole('button', { name: /Abbuchung 25 g rückgängig/ })
    .click();
  await expect(p1s(page).getByText('Automatisch abgebucht')).toBeHidden();
  expect(await remaining()).toBe(1000);
});
