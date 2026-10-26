import { expect, test, type Page } from '@playwright/test';
import bwipjs from 'bwip-js';

test.describe.configure({ mode: 'serial' });

const EAN = '4006381333931';

/** Erzeugt ein Barcode-Bild wie ein Foto vom Karton (weißer Rand, Klarschrift darunter). */
async function barcodePhoto(text: string) {
  const buffer = await bwipjs.toBuffer({
    bcid: 'ean13',
    text,
    scale: 4,
    height: 18,
    includetext: true,
    paddingwidth: 40,
    paddingheight: 30,
    backgroundcolor: 'FFFFFF',
  });
  return { name: 'barcode.png', mimeType: 'image/png', buffer };
}

/** Rendert ein Spulen-Etikett im Browser und fotografiert es per Screenshot. */
async function labelPhoto(page: Page) {
  const label = await page.context().newPage();
  await label.setViewportSize({ width: 900, height: 520 });
  await label.setContent(`
    <body style="margin:0;background:#fff;font-family:Arial,sans-serif;color:#111">
      <div style="padding:40px 56px">
        <div style="font-size:54px;font-weight:700">Polymaker</div>
        <div style="font-size:46px;margin-top:12px">PETG Matte</div>
        <div style="font-size:46px">Forest Green</div>
        <div style="font-size:32px;margin-top:24px">Net Weight: 1kg &nbsp; Diameter: 1.75mm</div>
        <div style="font-size:26px;margin-top:12px">Printing Temperature 230-260°C</div>
      </div>
    </body>`);
  const buffer = await label.screenshot();
  await label.close();
  return { name: 'etikett.png', mimeType: 'image/png', buffer };
}

const dialog = (page: Page) => page.getByRole('dialog');

async function openScanner(page: Page) {
  await page.goto('/filament');
  await page.getByRole('button', { name: 'Scannen' }).click();
  await expect(dialog(page).getByRole('heading', { name: 'Filament scannen' })).toBeVisible();
}

test('Neuer Barcode per Foto: Sorte einmal ausfüllen, mehrere Spulen anlegen', async ({ page }) => {
  await openScanner(page);
  await page.getByTestId('barcode-photo').setInputFiles(await barcodePhoto(EAN));

  const d = dialog(page);
  await expect(d.getByText(`Neuer Barcode ${EAN}`)).toBeVisible({ timeout: 15_000 });
  await expect(d.getByLabel('Barcode', { exact: true })).toHaveValue(EAN);

  await d.getByLabel(/^Filamenttyp/).selectOption({ label: 'PLA' });
  await d.getByLabel(/^Hersteller/).fill('Sunlu');
  await d.getByLabel(/^Farbe/).fill('Orange');
  await d.getByLabel(/^Preis pro Spule/).fill('16,99');
  await d.getByRole('button', { name: 'Eine mehr' }).click();
  await d.getByRole('button', { name: 'Eine mehr' }).click();
  await d.getByRole('button', { name: '3 Spulen anlegen' }).click();

  await expect(d.getByText('3 Spulen angelegt')).toBeVisible();
});

test('Bekannter Barcode: alles vorausgefüllt, Bestand wird angezeigt', async ({ page }) => {
  await openScanner(page);
  await page.getByTestId('barcode-photo').setInputFiles(await barcodePhoto(EAN));

  const d = dialog(page);
  await expect(d.getByText('Bekannte Sorte.')).toBeVisible({ timeout: 15_000 });
  await expect(d.getByText(/bereits 3 Spulen \(3 kg\)/)).toBeVisible();
  await expect(d.getByLabel(/^Hersteller/)).toHaveValue('Sunlu');
  await expect(d.getByLabel(/^Farbe/)).toHaveValue('Orange');
  await expect(d.getByLabel(/^Preis pro Spule/)).toHaveValue('16.99');
  await expect(d.getByText('gemerkt').first()).toBeVisible();

  await d.getByRole('button', { name: 'Spule anlegen' }).click();
  await expect(d.getByText('1 Spule angelegt')).toBeVisible();
  await d.getByRole('button', { name: 'Fertig' }).click();

  // Alle 4 Spulen landen in derselben Gruppe
  const group = page.getByRole('button', { name: /Orange/ });
  await expect(group).toContainText('4 Spulen');
  await expect(group).toContainText('4 kg');
});

test('QR-Code mit Herstellerangaben: wird erkannt und füllt das Formular vor', async ({ page }) => {
  const qr = 'https://example.com/filament?brand=Elegoo&material=PETG&color=Black&weight=1kg';
  const buffer = await bwipjs.toBuffer({
    bcid: 'qrcode',
    text: qr,
    scale: 6,
    paddingwidth: 40,
    paddingheight: 40,
    backgroundcolor: 'FFFFFF',
  });
  await openScanner(page);
  await page
    .getByTestId('barcode-photo')
    .setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer });

  const d = dialog(page);
  await expect(d.getByText(`Neuer Barcode ${qr}`)).toBeVisible({ timeout: 15_000 });
  await expect(d.getByLabel('Barcode', { exact: true })).toHaveValue(qr);
  await expect(d.getByLabel(/^Filamenttyp/)).toHaveValue(/.+/);
  await expect(d.getByLabel(/^Filamenttyp/).locator('option:checked')).toHaveText('PETG');
  await expect(d.getByLabel(/^Hersteller/)).toHaveValue('Elegoo');
  await expect(d.getByLabel(/^Farbe/)).toHaveValue('Schwarz');
});

test('Allgemeiner Hersteller-QR-Code: Hersteller erkannt, Sorte wird nicht gemerkt', async ({
  page,
}) => {
  const buffer = await bwipjs.toBuffer({
    bcid: 'qrcode',
    text: 'https://www.nobufil.com/feinschmelzer',
    scale: 6,
    paddingwidth: 40,
    paddingheight: 40,
    backgroundcolor: 'FFFFFF',
  });
  await openScanner(page);
  await page
    .getByTestId('barcode-photo')
    .setInputFiles({ name: 'qr.png', mimeType: 'image/png', buffer });

  const d = dialog(page);
  await expect(d.getByText(/enthält nur die Hersteller-Webseite/)).toBeVisible({ timeout: 15_000 });
  await expect(d.getByLabel(/^Hersteller/)).toHaveValue('Nobufil');
  await expect(d.getByLabel(/Sorte zu diesem Barcode merken/)).not.toBeChecked();
});

test('Handy ohne Autofokus: Barcode-Knopf öffnet direkt die Kamera-App', async ({ page }) => {
  // So merkt sich die App ein Handy, dessen Kamera dem Browser keinen Autofokus erlaubt
  await page.addInitScript(() => localStorage.setItem('druckwerk.scan.noAutofocus', '1'));
  await openScanner(page);
  const d = dialog(page);
  await expect(d.getByText('Foto aufnehmen (Kamera mit Autofokus)')).toBeVisible();
  await expect(d.getByRole('button', { name: 'Live-Scanner trotzdem versuchen' })).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  await d.getByRole('button', { name: /Barcode \/ QR-Code scannen/ }).click();
  await (await chooser).setFiles(await barcodePhoto(EAN));
  await expect(d.getByText('Bekannte Sorte.')).toBeVisible({ timeout: 15_000 });
});

test('Barcode von Hand eintippen', async ({ page }) => {
  await openScanner(page);
  await dialog(page).getByLabel('Barcode eintippen').fill(EAN);
  await dialog(page).getByRole('button', { name: 'Übernehmen' }).click();
  await expect(dialog(page).getByText('Bekannte Sorte.')).toBeVisible();
  await expect(dialog(page).getByText(/bereits 4 Spulen/)).toBeVisible();
});

test('Fehlende Pflichtfelder werden genannt statt still blockiert', async ({ page }) => {
  await openScanner(page);
  await dialog(page).getByLabel('Barcode eintippen').fill('4012345678901');
  await dialog(page).getByRole('button', { name: 'Übernehmen' }).click();
  const d = dialog(page);
  await expect(d.getByText(/Neuer Barcode 4012345678901/)).toBeVisible();

  await d.getByRole('button', { name: 'Spule anlegen' }).click();
  await expect(d.getByRole('alert')).toContainText('Filamenttyp, Hersteller, Farbe');

  await d.getByLabel(/^Filamenttyp/).selectOption({ label: 'PETG' });
  await d.getByLabel(/^Hersteller/).fill('eSun');
  await d.getByRole('button', { name: 'Spule anlegen' }).click();
  await expect(d.getByRole('alert')).toContainText('Farbe');
  await expect(d.getByRole('alert')).not.toContainText('Hersteller');

  await d.getByLabel(/^Farbe/).fill('Schwarz');
  await d.getByRole('button', { name: 'Spule anlegen' }).click();
  await expect(d.getByText('1 Spule angelegt')).toBeVisible();
});

test('Foto ohne Barcode zeigt verständlichen Hinweis', async ({ page }) => {
  await openScanner(page);
  const blank = await page.screenshot({ clip: { x: 0, y: 0, width: 300, height: 200 } });
  await page
    .getByTestId('barcode-photo')
    .setInputFiles({ name: 'leer.png', mimeType: 'image/png', buffer: blank });
  await expect(dialog(page).getByText(/Kein Barcode oder QR-Code erkannt/)).toBeVisible({
    timeout: 15_000,
  });
});

test('Etikett-Foto: Texterkennung füllt Typ, Hersteller, Farbe, Finish und Gewicht', async ({
  page,
}) => {
  // Lädt beim ersten Lauf die Tesseract-Sprachdaten aus dem Internet
  test.setTimeout(120_000);
  await openScanner(page);
  await page.getByTestId('label-photo').setInputFiles(await labelPhoto(page));

  const d = dialog(page);
  await expect(d.getByText('Aus dem Etikett erkannt')).toBeVisible({ timeout: 90_000 });
  await expect(d.getByLabel(/^Filamenttyp/)).toHaveValue(
    (await d
      .getByLabel(/^Filamenttyp/)
      .locator('option', { hasText: 'PETG' })
      .getAttribute('value')) as string,
  );
  await expect(d.getByLabel(/^Hersteller/)).toHaveValue('Polymaker');
  await expect(d.getByLabel(/^Farbe/)).toHaveValue('Grün');
  await expect(d.getByLabel(/^Art \/ Finish/).locator('option:checked')).toHaveText('Matt');
  await expect(d.getByLabel(/^Gewicht netto/)).toHaveValue('1000');
  await expect(d.getByLabel(/^Durchmesser/)).toHaveValue('1.75');
  await expect(d.getByText('erkannt', { exact: true })).toHaveCount(6);

  await d.getByText('Erkannter Text anzeigen').click();
  await expect(d.locator('pre')).toContainText('Polymaker');

  await d.getByRole('button', { name: 'Spule anlegen' }).click();
  await expect(d.getByText('1 Spule angelegt')).toBeVisible();
});
