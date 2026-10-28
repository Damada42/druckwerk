import { expect, test } from '@playwright/test';

test('Sorte bearbeiten: Preis einmal für alle Spulen derselben Sorte', async ({
  page,
  request,
}) => {
  const types = (await (await request.get('/api/filament-types')).json()) as {
    id: number;
    name: string;
  }[];
  const base = {
    typeId: types.find((t) => t.name === 'PLA')!.id,
    manufacturer: 'Sortenhersteller',
    colorName: 'Sortenweiß',
    colorHex: '#ffffff',
    weightTotalG: 1000,
    price: 20,
  };
  const a = await (await request.post('/api/spools', { data: { ...base } })).json();
  const b = await (
    await request.post('/api/spools', { data: { ...base, weightRemainingG: 840 } })
  ).json();

  await page.goto('/filament');
  await page.getByRole('button', { name: /Sortenweiß/ }).click();
  await page.getByRole('button', { name: 'Sorte bearbeiten (alle 2)' }).click();
  const dialog = page.getByRole('dialog', { name: /Sorte bearbeiten: Sortenweiß/ });
  await expect(
    dialog.getByText('Gilt für alle 2 Spulen dieser Sorte.', { exact: false }),
  ).toBeVisible();
  // Restmenge gehört nicht zur Sorte
  await expect(dialog.getByLabel('Restmenge (g)')).toHaveCount(0);
  await dialog.getByLabel('Preis pro Spule (€)').fill('24.99');
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toBeHidden();

  const spool = async (id: number) => (await request.get(`/api/spools/${id}`)).json();
  expect(await spool(a.id)).toMatchObject({ price: 24.99, weightRemainingG: 1000 });
  expect(await spool(b.id)).toMatchObject({ price: 24.99, weightRemainingG: 840 });
  await expect(page.getByText('24,99 €').first()).toBeVisible();
});
