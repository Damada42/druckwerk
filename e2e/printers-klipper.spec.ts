import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { FAKE_HA_PORT } from '../playwright.config';

// Läuft nach printer.spec.ts: die Verbindung zum nachgebauten Home Assistant steht schon.
test.describe.configure({ mode: 'serial' });

/** Nachgebautes Home Assistant aus global-setup.ts, mit dem Klipper-Drucker A20 (Moonraker) */
const HA = `http://127.0.0.1:${FAKE_HA_PORT}`;

async function klipperPrint(request: APIRequestContext, state: string, options: object = {}) {
  const res = await request.post(`${HA}/test/klipper`, { data: [state, options] });
  expect(res.status()).toBe(204);
}

const a20 = (page: Page) => page.getByRole('region', { name: 'A20 Werkstatt', exact: true });

test('Klipper-Drucker: verknüpfen, Spule zuordnen, Tempo ändern, Verbrauch in Gramm abbuchen', async ({
  page,
  request,
}) => {
  const printer = (await (
    await request.post('/api/printers', { data: { name: 'A20 Werkstatt', model: 'Geeetech A20' } })
  ).json()) as { id: number };
  const live = async () =>
    (
      (await (await request.get(`/api/printers/${printer.id}/live`)).json()) as {
        live?: { state: string };
      }
    ).live?.state;

  await page.goto('/drucker');
  await page.getByRole('button', { name: 'A20 Werkstatt bearbeiten' }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Home-Assistant-Gerät (Live-Status)')
    .selectOption({ label: 'A20 (Klipper)' });
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();

  // Nach dem letzten Druck: „Fertig“, ein Platz für die Spule, ohne „Übernehmen“ (kein AMS)
  const card = a20(page);
  await expect(card.getByText('Fertig', { exact: true })).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Filament' })).toBeVisible();
  await expect(card.getByText('Spule im Drucker')).toBeVisible();
  await expect(card.getByRole('button', { name: /übernehmen/ })).toHaveCount(0);

  const types = (await (await request.get('/api/filament-types')).json()) as {
    id: number;
    name: string;
  }[];
  const spool = (await (
    await request.post('/api/spools', {
      data: {
        typeId: types.find((t) => t.name === 'PLA')!.id,
        manufacturer: 'Sunlu',
        colorName: 'Klipper Beige E2E',
        diameter: 1.75,
        weightTotalG: 1000,
      },
    })
  ).json()) as { id: number };
  await page.reload();
  const select = a20(page).getByLabel('Spule im Drucker');
  const value = await select
    .locator('option', { hasText: 'Klipper Beige E2E' })
    .getAttribute('value');
  await select.selectOption(value!);
  await expect
    .poll(
      async () =>
        ((await (await request.get(`/api/spools/${spool.id}`)).json()) as { haTrayEntity: string })
          .haTrayEntity,
    )
    .toBe('sensor.a20_filament_used');

  // Druck läuft: Tempo in % umschalten
  await klipperPrint(request, 'printing', { meters: 2, progress: 30, file: 'e2e-klipper.gcode' });
  await expect.poll(live).toBe('running');
  await page.reload();
  await expect(card.getByText('e2e-klipper.gcode')).toBeVisible();
  await expect(card.getByText('2 m Filament')).toBeVisible();
  const speed = card.getByRole('group', { name: 'Geschwindigkeit' });
  await expect(speed.getByRole('button', { name: '100 %' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await speed.getByRole('button', { name: '125 %' }).click();
  await expect
    .poll(async () => {
      const calls = (await (await request.get(`${HA}/test/calls`)).json()) as {
        service: string;
        entityId?: string;
        data: Record<string, unknown>;
      }[];
      return calls.at(-1);
    })
    .toMatchObject({
      service: 'set_value',
      entityId: 'number.a20_speed_factor',
      data: { value: 125 },
    });

  // Fertig: 9,5 m PLA (1,75 mm) = 28,3 g werden abgebucht
  await klipperPrint(request, 'printing', { meters: 9.5, progress: 90, file: 'e2e-klipper.gcode' });
  await expect
    .poll(async () => await (await request.get(`/api/printers/${printer.id}/live`)).json())
    .toMatchObject({ live: { filamentUsedM: 9.5 } });
  // Der Server fragt alle 0,5 s nach – einmal abwarten, damit er die 9,5 m sieht
  await page.waitForTimeout(1200);
  await klipperPrint(request, 'complete');
  await expect
    .poll(
      async () =>
        (
          (await (await request.get(`/api/spools/${spool.id}`)).json()) as {
            weightRemainingG: number;
          }
        ).weightRemainingG,
      { timeout: 10_000 },
    )
    .toBe(971.7);
  await page.reload();
  await expect(card.getByText(/28 g.*Klipper Beige E2E/)).toBeVisible();
});
