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
  return (await (await request.get(`${HA}/test/calls`)).json()) as {
    service: string;
    entityId?: string;
    data: Record<string, unknown>;
  }[];
}

const p1s = (page: Page) => page.getByRole('region', { name: 'P1S', exact: true });

let spoolId: number;

test('Home Assistant in den Einstellungen verbinden', async ({ page }) => {
  await page.goto('/einstellungen');
  await page.getByRole('button', { name: 'Verbinden' }).click();
  const form = page.getByRole('form', { name: 'Neuer Standort' });
  await form.getByLabel('Standort').fill('Zuhause');
  await form.getByLabel('Adresse').fill(`127.0.0.1:${FAKE_HA_PORT}`);
  await form.getByLabel('Token').fill('falsch');
  await form.getByRole('button', { name: 'Verbinden' }).click();
  await expect(
    form.getByText('Home Assistant „Zuhause“ lehnt den Token ab', { exact: false }),
  ).toBeVisible();

  await form.getByLabel('Token').fill('test-token');
  await form.getByRole('button', { name: 'Verbinden' }).click();
  await expect(form).toBeHidden();
  const row = page.getByRole('listitem', { name: 'Standort Zuhause' });
  await expect(row.getByText('Verbunden (HA 2026.10.4)')).toBeVisible();
  await expect(row.getByText(/Gefundene Drucker: the_one \(P1S\)/)).toBeVisible();
  // Adresse nur gekürzt, Token gar nicht: beides steht nirgends auf der Seite
  await expect(row.getByText(`http://127.0.•.•:${FAKE_HA_PORT}`)).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain(`127.0.0.1:${FAKE_HA_PORT}`);
  expect(html).not.toContain('test-token');

  // Umbenennen ohne Adresse und Token neu einzugeben
  await row.getByRole('button', { name: 'Zuhause bearbeiten' }).click();
  const edit = page.getByRole('form', { name: 'Zuhause bearbeiten' });
  await expect(edit.getByLabel(/Neue Adresse/)).toHaveValue('');
  await edit.getByLabel('Standort').fill('Werkstatt');
  await edit.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('listitem', { name: 'Standort Werkstatt' })).toBeVisible();
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
    objects: { '95': 'Halter links', '409': 'Halter rechts', '1463': 'Deckel' },
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

  // Geschwindigkeit: Standard ist aktiv, auf Sport umschalten
  const speeds = card.getByRole('group', { name: 'Geschwindigkeit' });
  await expect(speeds.getByRole('button', { name: /Standard/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await speeds.getByRole('button', { name: /Sport/ }).click();
  await expect
    .poll(async () => (await haCalls(request)).at(-1))
    .toMatchObject({ service: 'select_option', data: { option: 'sport' } });
  await expect(speeds.getByRole('button', { name: /Sport/ })).toHaveAttribute(
    'aria-pressed',
    'true',
    {
      timeout: 10_000,
    },
  );

  // Teile überspringen: „Halter links“ wählen, Rückfrage bestätigen
  await card.getByRole('button', { name: 'Teile überspringen' }).click();
  const dialog = page.getByRole('dialog', { name: 'Teile überspringen' });
  await expect(dialog.getByRole('img', { name: 'Druckplatte mit den Teilen' })).toBeVisible();
  await dialog.getByLabel('Halter links').check();
  page.once('dialog', (d) => d.accept());
  await dialog.getByRole('button', { name: '1 überspringen' }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => (await haCalls(request)).at(-1))
    .toMatchObject({ service: 'skip_objects', data: { objects: '95' } });
  await expect(card.getByText('1 von 3 Teilen übersprungen')).toBeVisible({ timeout: 10_000 });

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

test('Mehrere Kameras: aus Home Assistant und direkt per Stream-Adresse', async ({ page }) => {
  await page.goto('/drucker');
  const card = p1s(page);
  await expect(
    card.getByText('Bereit', { exact: true }).or(card.getByText('Fertig')),
  ).toBeVisible();
  await expect(card.getByRole('region', { name: 'Kameras' })).toHaveCount(0);

  await page.getByRole('button', { name: 'P1S Kameras' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Kamera hinzufügen' }).click();
  let form = dialog.getByRole('form', { name: 'Neue Kamera' });
  // Die Kamera des verknüpften Druckers steht oben, nicht verfügbare sind markiert
  const select = form.getByRole('combobox', { name: 'Kamera', exact: true });
  await expect(select.locator('option').nth(1)).toHaveText('the_one Kamera');
  await expect(select.locator('option', { hasText: 'SidewinderX1 – Kamera' })).toHaveCount(1);
  await expect(
    select.locator('option', { hasText: 'SidewinderX1 Usb – nicht verfügbar' }),
  ).toHaveCount(1);
  await select.selectOption({ label: 'the_one Kamera' });
  await expect(form.getByLabel('Name')).toHaveValue('the_one Kamera');
  await form.getByLabel('Name').fill('Druckraum');
  await form.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog.getByRole('listitem', { name: 'Kamera Druckraum' })).toContainText(
    'Home Assistant: the_one the_one Kamera',
  );

  // Crowsnest-Webcam mit Zugangsdaten, auf dem Kopf montiert
  await dialog.getByRole('button', { name: 'Kamera hinzufügen' }).click();
  form = dialog.getByRole('form', { name: 'Neue Kamera' });
  await form.getByLabel('Quelle').selectOption('url');
  await form
    .getByRole('textbox', { name: 'Stream-Adresse', exact: true })
    .fill(`http://cam:geheim@127.0.0.1:${FAKE_HA_PORT}/webcam/?action=stream`);
  await form.getByLabel('Name').fill('Düse');
  await form.getByLabel('Drehung').selectOption('180');
  await form.getByRole('button', { name: 'Speichern' }).click();
  const duese = dialog.getByRole('listitem', { name: 'Kamera Düse' });
  await expect(duese).toContainText(`http://cam:•••@127.0.0.1:${FAKE_HA_PORT}/webcam/`);

  // Düse nach oben: sie wird groß gezeigt
  await dialog.getByRole('button', { name: 'Düse nach oben' }).click();
  await expect(dialog.getByRole('listitem').first()).toContainText('Düse');
  await dialog.getByRole('button', { name: 'Fertig' }).click();

  const region = card.getByRole('region', { name: 'Kameras' });
  const loaded = (name: string) =>
    expect
      .poll(() =>
        region.getByRole('img', { name }).evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
  await loaded('Düse');
  await expect(region.getByRole('img', { name: 'Düse' })).toHaveCSS('transform', /matrix\(-1/);
  await region.getByRole('tab', { name: 'Druckraum' }).click();
  await loaded('Druckraum');
  await expect(region.getByRole('tab', { name: 'Druckraum' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  // Das Passwort der Webcam landet nie im Browser
  await page.getByRole('button', { name: 'P1S Kameras' }).click();
  await page.getByRole('button', { name: 'Düse bearbeiten' }).click();
  await expect(page.getByRole('textbox', { name: 'Stream-Adresse', exact: true })).toHaveValue(
    `http://cam:•••@127.0.0.1:${FAKE_HA_PORT}/webcam/?action=stream`,
  );
  expect(await page.content()).not.toContain('geheim');
});
