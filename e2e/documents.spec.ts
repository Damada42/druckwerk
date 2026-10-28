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

  // PDF öffnet in der App (nicht in einem neuen Fenster, das hinter HA-Ingress keine Anmeldung hätte)
  await page.getByRole('button', { name: 'PDF' }).first().click();
  const viewer = page.getByRole('dialog', { name: `Rechnung RE-${year}-001.pdf` });
  await expect(viewer.getByRole('img', { name: 'Seite 1 von 1' })).toBeVisible();
  await expect(viewer.getByRole('link', { name: 'Herunterladen' })).toHaveAttribute(
    'download',
    `Rechnung RE-${year}-001.pdf`,
  );
  await viewer.getByRole('button', { name: 'Schließen' }).click();
  const docs = await (await request.get(`/api/projects/${project.id}/documents`)).json();
  const pdf = await request.get(docs[0].filePath);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  const body = await pdf.body();
  expect(body.subarray(0, 4).toString()).toBe('%PDF');
  writeFileSync(testInfo.outputPath('rechnung.pdf'), body);

  // Die Rechnung steht auch unter „Rechnungen“ als Ausgang
  await page.getByRole('button', { name: /^Rechnungen/ }).click();
  await expect(page.getByText(`Rechnung RE-${year}-001`)).toBeVisible();
  await expect(page.getByText('109,90 €')).toBeVisible();
});

test('Aufschlag und UID-Nummer: Vorschlag aus dem Projekt, je Angebot änderbar', async ({
  page,
  request,
}) => {
  await request.put('/api/company', { data: { vatId: 'ATU12345678' } });
  const project = await (
    await request.post('/api/projects', {
      data: { title: 'Lampenschirm', price: 20, markupPercent: 10, showVatId: false },
    })
  ).json();

  // Vorgaben unter „Allgemein“
  await page.goto(`/projekte/${project.id}`);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Aufschlag / Marge (%)')).toHaveValue('10');
  await expect(dialog.getByLabel('UID-Nummer auf Angebot und Rechnung')).not.toBeChecked();

  // Im Angebot vorgeschlagen, dort nur für dieses Dokument geändert
  await dialog.getByRole('button', { name: 'Angebot & Rechnung' }).click();
  await dialog.getByRole('button', { name: 'Angebot erstellen' }).click();
  const editor = dialog.getByRole('group', { name: 'Angebot erstellen' });
  await expect(editor.getByLabel('Position 1 Aufschlag in Prozent')).toHaveValue('10');
  await expect(editor.getByText('22,00 €').first()).toBeVisible();
  await editor.getByLabel('Position 1 Aufschlag in Prozent').fill('25');
  await expect(editor.getByText('25,00 €').first()).toBeVisible();
  const uid = editor.getByLabel(/UID-Nummer \(ATU12345678\)/);
  await expect(uid).not.toBeChecked();
  await uid.check();
  // Neue Position bekommt wieder den Projektwert
  await editor.getByRole('button', { name: 'Position', exact: true }).click();
  await expect(editor.getByLabel('Position 2 Aufschlag in Prozent')).toHaveValue('10');
  await editor.getByRole('button', { name: 'Position 2 entfernen' }).click();
  await editor.getByLabel('Empfänger').fill('Max Muster\n4020 Linz');
  await editor.getByRole('button', { name: 'Angebot erstellen' }).click();
  await expect(dialog.getByText(/^Angebot AN-/).first()).toBeVisible();

  const docs = await (await request.get(`/api/projects/${project.id}/documents`)).json();
  expect(docs[0]).toMatchObject({ showVatId: true, gross: 25 });
  expect(docs[0].items[0]).toMatchObject({ unitPrice: 20, markupPercent: 25 });
  // Projektvorgaben bleiben unverändert
  const saved = await (await request.get(`/api/projects/${project.id}`)).json();
  expect(saved).toMatchObject({ markupPercent: 10, showVatId: false });
});

test('Zusatzkosten-Kategorie mit Einheit und Preis; Angebot listet alle Positionen auf', async ({
  page,
  request,
}) => {
  // Kategorie unter „Einstellungen“
  await page.goto('/einstellungen');
  await page.getByLabel('Neue Kategorie').fill('Versand');
  await page.getByRole('button', { name: 'Hinzufügen' }).last().click();
  const row = page.getByRole('listitem', { name: 'Kategorie Versand' });
  await row.getByLabel('Versand: Einheit').fill('Paket');
  await row.getByLabel('Versand: Einheit').blur();
  await row.getByLabel('Versand: Standardpreis').fill('5,90');
  await row.getByLabel('Versand: Standardpreis').blur();
  await expect
    .poll(async () =>
      ((await (await request.get('/api/cost-categories')).json()) as { name: string }[]).find(
        (c) => c.name === 'Versand',
      ),
    )
    .toMatchObject({ unit: 'Paket', defaultPrice: 5.9 });

  // Im Projekt: Kategorie wählen übernimmt Einheit und Preis
  await page.goto('/projekte?neu=1');
  const d = page.getByRole('dialog');
  await d.getByLabel('Titel *').fill('Versandkarton-Test');
  await d.getByLabel('Aufschlag / Marge (%)').fill('10');
  await d.getByRole('button', { name: /^Zusatzkosten/ }).click();
  await d.getByRole('button', { name: 'Position hinzufügen' }).click();
  const cost = d.getByRole('group', { name: 'Zusatzkosten 1' });
  await cost.getByLabel('Kategorie').selectOption({ label: 'Versand' });
  await expect(cost.getByLabel('Einheit', { exact: true })).toHaveValue('Paket');
  await expect(cost.getByLabel('Preis je Einheit €')).toHaveValue('5,9');
  // Menge: alte Zahl löschen und neu tippen, ohne dass eine 0 hängen bleibt
  await cost.getByLabel('Menge').fill('');
  await cost.getByLabel('Menge').pressSequentially('2');
  await expect(cost.getByLabel('Menge')).toHaveValue('2');
  await d.getByRole('button', { name: 'Position hinzufügen' }).click();
  const second = d.getByRole('group', { name: 'Zusatzkosten 2' });
  await second.getByLabel('Kategorie').selectOption({ label: 'Sonstiges' });
  await second.getByLabel('Beschreibung').fill('Nachbearbeitung');
  // „0“ antippen und tippen ersetzt die Null statt „012“ zu ergeben
  await second.getByLabel('Preis je Einheit €').click();
  await page.keyboard.type('12');
  await expect(second.getByLabel('Preis je Einheit €')).toHaveValue('12');

  await d.getByRole('button', { name: 'Speichern' }).click();
  await expect(d.getByRole('status')).toHaveText('Gespeichert');

  // Angebot: alle Zusatzkosten als eigene Positionen, mit Aufschlag aus dem Projekt
  await d.getByRole('button', { name: 'Angebot & Rechnung' }).click();
  await d.getByRole('button', { name: 'Angebot erstellen' }).click();
  const editor = d.getByRole('group', { name: 'Angebot erstellen' });
  await expect(editor.getByLabel('Position 1 Beschreibung')).toHaveValue('Versand');
  await expect(editor.getByLabel('Position 1 Menge')).toHaveValue('2');
  await expect(editor.getByLabel('Position 1 Einheit')).toHaveValue('Paket');
  await expect(editor.getByLabel('Position 1 Einzelpreis')).toHaveValue('5,9');
  await expect(editor.getByLabel('Position 2 Beschreibung')).toHaveValue('Nachbearbeitung');
  await expect(editor.getByLabel('Position 2 Aufschlag in Prozent')).toHaveValue('10');
  // 2 × 6,49 + 13,20 = 26,18 €
  await expect(editor.getByText('26,18 €').last()).toBeVisible();
  // Umschalten auf eine Pauschalposition geht auch
  await editor.getByRole('button', { name: 'Pauschal (Verkaufspreis)' }).click();
  await expect(editor.getByLabel('Position 1 Beschreibung')).toHaveValue('Versandkarton-Test');
  await expect(editor.getByLabel('Position 2 Beschreibung')).toHaveCount(0);
  await editor.getByRole('button', { name: 'Aus Projektkosten' }).click();
  await editor.getByLabel('Empfänger').fill('Max Muster\n4020 Linz');
  await editor.getByRole('button', { name: 'Angebot erstellen' }).click();
  await expect(d.getByText(/^Angebot AN-/).first()).toBeVisible();
});
