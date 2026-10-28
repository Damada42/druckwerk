import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

// Firmendaten mit Logo eintragen, dann Angebot und daraus eine Rechnung als PDF erstellen.
test.describe.configure({ mode: 'serial' });

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80">
  <rect x="2" y="2" width="76" height="76" rx="14" fill="#f97316"/>
  <text x="90" y="52" font-family="Arial" font-size="30" font-weight="bold" fill="#1f2937">Muster</text>
</svg>`;

test('Angebot und Rechnung als PDF', async ({ page, request }, testInfo) => {
  const customer = await (
    await request.post('/api/customers', {
      data: { name: 'Erika Muster', company: 'Muster GmbH', address: 'Ringstraße 5\n1010 Wien' },
    })
  ).json();
  const project = await (
    await request.post('/api/projects', {
      data: { title: 'Wetterstation-Gehäuse', customerId: customer.id, price: 49.9 },
    })
  ).json();

  // Ohne Firmendaten geht es noch nicht
  await page.goto(`/projekte/${project.id}`);
  await page.getByRole('button', { name: 'Angebot & Rechnung' }).click();
  await expect(page.getByText(/deine Firmendaten/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Angebot erstellen' })).toBeDisabled();

  await page.goto('/einstellungen');
  const form = page.getByRole('form', { name: 'Firmendaten' });
  await page.getByTestId('logo-file').setInputFiles({
    name: 'logo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(LOGO_SVG),
  });
  await expect(form.getByRole('img', { name: 'Logo' })).toBeVisible();
  await form.getByLabel('Name / Firma').fill('3D-Druck Muster');
  await form.getByLabel('Adresse').fill('Hauptstraße 1\n4020 Linz');
  await form.getByLabel('IBAN').fill('AT61 1904 3002 3457 3201');
  await expect(form.getByLabel(/Kleinunternehmer/)).toBeChecked();
  await form.getByRole('button', { name: 'Firmendaten speichern' }).click();
  await expect(form.getByText('Gespeichert')).toBeVisible();
  const company = await (await request.get('/api/company')).json();
  expect(company).toMatchObject({ name: '3D-Druck Muster', smallBusiness: true });
  expect(company.logoPath).toMatch(/^\/uploads\/logo-.*\.png$/);

  // Angebot: Empfänger und Position kommen aus dem Projekt
  await page.goto(`/projekte/${project.id}`);
  await page.getByRole('button', { name: 'Angebot & Rechnung' }).click();
  await page.getByRole('button', { name: 'Angebot erstellen' }).click();
  const editor = page.getByRole('group', { name: 'Angebot erstellen' });
  await expect(editor.getByLabel('Empfänger')).toHaveValue(
    'Muster GmbH\nErika Muster\nRingstraße 5\n1010 Wien',
  );
  await expect(editor.getByLabel('Position 1 Beschreibung')).toHaveValue('Wetterstation-Gehäuse');
  await editor.getByRole('button', { name: 'Position', exact: true }).click();
  await editor.getByLabel('Position 2 Beschreibung').fill('Konstruktion (Stunden)');
  await editor.getByLabel('Position 2 Menge').fill('1,5');
  await editor.getByLabel('Position 2 Einzelpreis').fill('40');
  // Enter im Feld darf das Projekt nicht speichern und schließen
  await editor.getByLabel('Position 2 Einzelpreis').press('Enter');
  await expect(editor.getByText('109,90 €')).toBeVisible();
  await expect(editor.getByText('Kleinunternehmer gemäß § 6 Abs. 1 Z 27 UStG')).toBeVisible();
  await editor.getByRole('button', { name: 'Angebot erstellen' }).click();

  const year = new Date().getFullYear();
  await expect(page.getByText(`Angebot AN-${year}-001`)).toBeVisible();

  // Daraus eine Rechnung
  await page.getByRole('button', { name: 'Als Rechnung' }).click();
  const invoiceEditor = page.getByRole('group', { name: 'Rechnung erstellen' });
  await expect(invoiceEditor.getByLabel('Position 2 Menge')).toHaveValue('1,5');
  await invoiceEditor.getByRole('button', { name: 'Rechnung erstellen' }).click();
  await expect(page.getByText(`Rechnung RE-${year}-001`)).toBeVisible();

  // PDF lässt sich laden
  const href = await page.getByRole('link', { name: 'PDF' }).first().getAttribute('href');
  const pdf = await request.get(`/${href}`);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  const body = await pdf.body();
  expect(body.subarray(0, 4).toString()).toBe('%PDF');
  writeFileSync(testInfo.outputPath('rechnung.pdf'), body);

  // Die Rechnung steht auch unter „Rechnungen“ als Ausgang
  await page.getByRole('button', { name: /^Rechnungen/ }).click();
  await expect(page.getByText(`Rechnung RE-${year}-001`)).toBeVisible();
  await expect(page.getByText('109,90 €')).toBeVisible();
});
