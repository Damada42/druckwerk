import {
  SMALL_BUSINESS_NOTE,
  calcDocumentTotals,
  itemUnitPrice,
  nextDocumentNumber,
  type ProjectDocument,
} from '@3dapp/shared';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

let app: Awaited<ReturnType<typeof buildApp>>['app'];
let uploadDir: string;

beforeEach(async () => {
  uploadDir = mkdtempSync(path.join(tmpdir(), '3dapp-test-'));
  ({ app } = await buildApp({ dbFile: ':memory:', uploadDir }));
});

afterEach(async () => {
  await app.close();
  rmSync(uploadDir, { recursive: true, force: true });
});

async function send<T>(method: 'POST' | 'PUT', url: string, payload: object) {
  const res = await app.inject({ method, url, payload });
  return { status: res.statusCode, body: res.json() as T };
}

/** Text aller Seiten eines PDFs aus dem Upload-Ordner */
async function pdfText(filePath: string) {
  const data = new Uint8Array(readFileSync(path.join(uploadDir, path.basename(filePath))));
  const pdf = await getDocument({ data, verbosity: 0 }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    text += content.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n';
  }
  return text;
}

/** Wie im PDF: österreichisches Format, z.B. „€ 22,00“ */
// Im PDF-Text wird das geschützte Leerzeichen nach dem €-Zeichen zu einem normalen
const eur = (n: number) =>
  n.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' }).replace(/\u00a0/g, ' ');

const company = {
  name: '3D-Druck Muster',
  address: 'Hauptstraße 1\n4020 Linz',
  email: 'info@example.at',
  iban: 'AT61 1904 3002 3457 3201',
};

const offer = {
  kind: 'offer',
  date: '2026-10-28',
  dueDate: '2026-11-27',
  recipient: 'Erika Muster\nRingstraße 5\n1010 Wien',
  intro: 'Vielen Dank für deine Anfrage.',
  items: [
    { description: 'Gehäuse für Wetterstation, PETG schwarz', quantity: 2, unitPrice: 24.5 },
    { description: 'Konstruktion', quantity: 1.5, unitPrice: 40 },
    { description: '', quantity: 1, unitPrice: 99 },
  ],
};

async function project() {
  const res = await send<{ id: number }>('POST', '/api/projects', { title: 'Wetterstation' });
  return res.body.id;
}

describe('Rechenregeln', () => {
  it('rechnet mit und ohne Umsatzsteuer', () => {
    const items = [{ description: 'A', quantity: 3, unitPrice: 10.1 }];
    expect(calcDocumentTotals(items, true, 20)).toEqual({ net: 30.3, vat: 0, gross: 30.3 });
    expect(calcDocumentTotals(items, false, 20)).toEqual({ net: 30.3, vat: 6.06, gross: 36.36 });
  });

  it('rechnet den Aufschlag in den Einzelpreis ein (auf Cent gerundet)', () => {
    expect(
      itemUnitPrice({ description: 'A', quantity: 1, unitPrice: 33.08, markupPercent: 10 }),
    ).toBe(36.39);
    // Ältere Dokumente ohne Aufschlag bleiben unverändert
    expect(itemUnitPrice({ description: 'A', quantity: 1, unitPrice: 12.5 })).toBe(12.5);
    const items = [{ description: 'A', quantity: 3, unitPrice: 10, markupPercent: 10 }];
    expect(calcDocumentTotals(items, false, 20)).toEqual({ net: 33, vat: 6.6, gross: 39.6 });
  });

  it('zählt Nummern pro Art und Jahr weiter', () => {
    const existing = ['RE-2026-001', 'RE-2026-009', 'AN-2026-020', 'RE-2025-050'];
    expect(nextDocumentNumber('invoice', 2026, existing)).toBe('RE-2026-010');
    expect(nextDocumentNumber('offer', 2026, existing)).toBe('AN-2026-021');
    expect(nextDocumentNumber('invoice', 2027, existing)).toBe('RE-2027-001');
  });
});

describe('Firmendaten', () => {
  it('speichert nur bekannte Felder mit passendem Typ', async () => {
    const res = await send('PUT', '/api/company', { ...company, fremd: 1, logoPath: '/x' });
    expect(res.body).toMatchObject({ ...company, smallBusiness: true, logoPath: null });
    expect((await send('PUT', '/api/company', { vatRate: 'zwanzig' })).status).toBe(400);
  });
});

describe('Angebote und Rechnungen', () => {
  it('verlangt zuerst die Firmendaten', async () => {
    const id = await project();
    const res = await send('POST', `/api/projects/${id}/documents`, offer);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/Firmendaten/);
  });

  it('erstellt ein Angebot als Kleinunternehmer mit Hinweis', async () => {
    await send('PUT', '/api/company', company);
    const id = await project();
    const res = await send<ProjectDocument>('POST', `/api/projects/${id}/documents`, offer);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ number: 'AN-2026-001', gross: 109, vat: 0, invoiceId: null });
    // Leere Position fällt weg
    expect(res.body.items).toHaveLength(2);
    const text = await pdfText(res.body.filePath);
    expect(text).toContain('Angebot AN-2026-001');
    expect(text).toContain(SMALL_BUSINESS_NOTE);
    expect(text).toContain('Erika Muster');
    // Eigene Adresse nur im Kopf und in der Fußzeile, nicht noch einmal über dem Empfänger
    expect(text.split('Hauptstraße 1').length - 1).toBe(2);
    expect(text).toContain('27.11.2026');
    expect(text).not.toContain('USt.');
  });

  it('erstellt eine Rechnung mit Umsatzsteuer und Eintrag unter Rechnungen', async () => {
    await send('PUT', '/api/company', { ...company, smallBusiness: false, vatId: 'ATU12345678' });
    const id = await project();
    const res = await send<ProjectDocument>('POST', `/api/projects/${id}/documents`, {
      ...offer,
      kind: 'invoice',
      serviceDate: '2026-10-20',
    });
    expect(res.body).toMatchObject({ number: 'RE-2026-001', net: 109, vat: 21.8, gross: 130.8 });
    const text = await pdfText(res.body.filePath);
    expect(text).toContain('Rechnung RE-2026-001');
    expect(text).toContain('ATU12345678');
    expect(text).toContain('20 % USt.');
    expect(text).not.toContain(SMALL_BUSINESS_NOTE);

    const detail = (await app.inject(`/api/projects/${id}`)).json();
    expect(detail.invoices).toEqual([
      expect.objectContaining({ type: 'outgoing', amount: 130.8, number: 'RE-2026-001' }),
    ]);

    // Gleiche Nummer ein zweites Mal geht nicht
    const dup = await send('POST', `/api/projects/${id}/documents`, {
      ...offer,
      kind: 'invoice',
      number: 'RE-2026-001',
    });
    expect(dup.status).toBe(409);

    // Rechnungseintrag löschen lässt das PDF des Dokuments stehen
    await app.inject({ method: 'DELETE', url: `/api/invoices/${detail.invoices[0].id}` });
    expect(existsSync(path.join(uploadDir, path.basename(res.body.filePath)))).toBe(true);

    // Dokument löschen entfernt das PDF
    const del = await app.inject({ method: 'DELETE', url: `/api/documents/${res.body.id}` });
    expect(del.statusCode).toBe(204);
    expect(existsSync(path.join(uploadDir, path.basename(res.body.filePath)))).toBe(false);
  });

  it('Aufschlag und UID-Nummer pro Dokument: im PDF nur der Endpreis, UID abschaltbar', async () => {
    await send('PUT', '/api/company', { ...company, vatId: 'ATU12345678' });
    const id = await project();
    // Projektvorgaben werden gespeichert (die Vorschläge im Formular kommen von dort)
    const saved = await send<{ markupPercent: number; showVatId: boolean }>(
      'PUT',
      `/api/projects/${id}`,
      { title: 'Wetterstation', markupPercent: 10, showVatId: false },
    );
    expect(saved.body).toMatchObject({ markupPercent: 10, showVatId: false });

    const res = await send<ProjectDocument>('POST', `/api/projects/${id}/documents`, {
      ...offer,
      showVatId: false,
      items: [
        { description: 'Gehäuse', quantity: 2, unitPrice: 20, markupPercent: 10 },
        { description: 'Konstruktion', quantity: 1, unitPrice: 40, markupPercent: 0 },
      ],
    });
    expect(res.status).toBe(201);
    // 2 × 22,00 + 40,00
    expect(res.body).toMatchObject({ gross: 84, showVatId: false });
    expect(res.body.items[0]).toMatchObject({ unitPrice: 20, markupPercent: 10 });
    const text = await pdfText(res.body.filePath);
    expect(text).toContain(eur(22));
    expect(text).toContain(eur(44));
    expect(text).not.toContain(eur(20));
    expect(text).not.toContain('ATU12345678');

    // Ohne Angabe steht die UID wie bisher drauf
    const withUid = await send<ProjectDocument>('POST', `/api/projects/${id}/documents`, offer);
    expect(withUid.body.showVatId).toBe(true);
    expect(await pdfText(withUid.body.filePath)).toContain('ATU12345678');

    const bad = await send('POST', `/api/projects/${id}/documents`, {
      ...offer,
      items: [{ description: 'X', quantity: 1, unitPrice: 10, markupPercent: -150 }],
    });
    expect(bad.status).toBe(400);
  });

  it('bricht lange Positionslisten auf mehrere Seiten um', async () => {
    await send('PUT', '/api/company', company);
    const id = await project();
    const items = Array.from({ length: 45 }, (_, i) => ({
      description: `Teil ${i + 1} mit etwas längerer Beschreibung`,
      quantity: 1,
      unitPrice: 1,
    }));
    const res = await send<ProjectDocument>('POST', `/api/projects/${id}/documents`, {
      ...offer,
      items,
    });
    const text = await pdfText(res.body.filePath);
    expect(text).toContain('Teil 45');
    expect(text).toContain('Seite 2 von 2');
  });
});
