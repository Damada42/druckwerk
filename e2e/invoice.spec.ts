import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

/** Typische Händler-Rechnung mit Zwischensumme, MwSt und Versand – der Endbetrag steht unten. */
const INVOICE_HTML = `
  <body style="margin:0;background:#fff;font-family:Arial,sans-serif;color:#111;font-size:22px">
    <div style="padding:48px 64px;width:880px">
      <div style="font-size:34px;font-weight:700">reichelt elektronik GmbH &amp; Co. KG</div>
      <div>Elektronikring 1, 26452 Sande</div>
      <div style="font-size:40px;font-weight:700;margin:36px 0 16px">Rechnung</div>
      <table style="font-size:22px;border-collapse:collapse">
        <tr><td style="padding-right:24px">Rechnungsnummer:</td><td>RE-2026-004711</td></tr>
        <tr><td>Rechnungsdatum:</td><td>14.10.2026</td></tr>
        <tr><td>Lieferdatum:</td><td>12.10.2026</td></tr>
      </table>
      <table style="width:100%;margin-top:32px;border-collapse:collapse;font-size:22px">
        <tr style="font-weight:700"><td>Artikel</td><td>Menge</td><td style="text-align:right">Gesamt</td></tr>
        <tr><td>Arduino Nano</td><td>2</td><td style="text-align:right">16,80 €</td></tr>
        <tr><td>WS2812B LED-Streifen 1m</td><td>1</td><td style="text-align:right">12,90 €</td></tr>
        <tr><td>Zwischensumme netto</td><td></td><td style="text-align:right">24,96 €</td></tr>
        <tr><td>MwSt. 19 %</td><td></td><td style="text-align:right">4,74 €</td></tr>
        <tr><td>Versand</td><td></td><td style="text-align:right">5,95 €</td></tr>
        <tr style="font-weight:700"><td>Gesamtbetrag</td><td></td><td style="text-align:right">35,65 €</td></tr>
      </table>
    </div>
  </body>`;

async function render(page: Page) {
  const doc = await page.context().newPage();
  await doc.setViewportSize({ width: 1010, height: 900 });
  await doc.setContent(INVOICE_HTML);
  return doc;
}

async function invoicePdf(page: Page) {
  const doc = await render(page);
  const buffer = await doc.pdf({ format: 'A4', printBackground: true });
  await doc.close();
  return { name: 'reichelt.pdf', mimeType: 'application/pdf', buffer };
}

async function invoicePhoto(page: Page) {
  const doc = await render(page);
  const buffer = await doc.screenshot({ fullPage: true });
  await doc.close();
  return { name: 'rechnung-foto.png', mimeType: 'image/png', buffer };
}

/** Eigenes Projekt pro Test, damit die Tests nicht von anderen Specs abhängen */
async function openInvoices(page: Page, request: APIRequestContext, title: string) {
  const res = await request.post('/api/projects', { data: { title } });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: number };
  await page.goto(`/projekte/${id}`);
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: /^Rechnungen/ }).click();
  return d;
}

test('PDF-Rechnung: Betrag, Datum, Nummer und Händler werden vorausgefüllt', async ({
  page,
  request,
}) => {
  const d = await openInvoices(page, request, 'LED-Lampe (PDF-Rechnung)');
  await d
    .locator('input[type=file]')
    .first()
    .setInputFiles(await invoicePdf(page));

  await expect(d.getByText('Aus der Rechnung erkannt – bitte kurz prüfen.')).toBeVisible({
    timeout: 15_000,
  });
  await expect(d.getByLabel(/^Betrag/)).toHaveValue('35,65');
  await expect(d.getByLabel(/^Datum/)).toHaveValue('2026-10-14');
  await expect(d.getByLabel(/^Rechnungsnummer/)).toHaveValue('RE-2026-004711');
  await expect(d.getByLabel(/^Beschreibung/)).toHaveValue(
    'Arduino Nano, WS2812B LED-Streifen 1m (Reichelt)',
  );
  await expect(d.getByText('erkannt', { exact: true })).toHaveCount(4);

  await d.getByRole('button', { name: 'Hinzufügen' }).click();
  const item = d.getByRole('listitem').filter({ hasText: 'Arduino Nano' });
  await expect(item).toContainText('Nr. RE-2026-004711');
  await expect(item).toContainText('35,65');
  await expect(item).toContainText('14.10.2026');
});

test('Von Hand eingetragene Werte werden nicht überschrieben', async ({ page, request }) => {
  const d = await openInvoices(page, request, 'LED-Lampe (Teilbetrag)');
  await d.getByLabel(/^Betrag/).fill('20,00');
  await d.getByLabel(/^Beschreibung/).fill('Nur die LEDs');
  await d
    .locator('input[type=file]')
    .first()
    .setInputFiles(await invoicePdf(page));

  await expect(d.getByText('Aus der Rechnung erkannt – bitte kurz prüfen.')).toBeVisible({
    timeout: 15_000,
  });
  await expect(d.getByLabel(/^Betrag/)).toHaveValue('20,00');
  await expect(d.getByLabel(/^Beschreibung/)).toHaveValue('Nur die LEDs');
  await expect(d.getByLabel(/^Rechnungsnummer/)).toHaveValue('RE-2026-004711');
});

test('Foto einer Rechnung: Texterkennung füllt die Werte vor', async ({ page, request }) => {
  test.setTimeout(120_000);
  const d = await openInvoices(page, request, 'LED-Lampe (Foto-Rechnung)');
  // Zweites Datei-Feld = Kamera
  await d
    .locator('input[type=file]')
    .nth(1)
    .setInputFiles(await invoicePhoto(page));

  await expect(d.getByText('Aus der Rechnung erkannt – bitte kurz prüfen.')).toBeVisible({
    timeout: 90_000,
  });
  await expect(d.getByLabel(/^Betrag/)).toHaveValue('35,65');
  await expect(d.getByLabel(/^Datum/)).toHaveValue('2026-10-14');
  await expect(d.getByLabel(/^Rechnungsnummer/)).toHaveValue('RE-2026-004711');
});
