import {
  DOCUMENT_KIND_LABELS,
  SMALL_BUSINESS_NOTE,
  type CompanyProfile,
  type ProjectDocument,
} from '@3dapp/shared';
import PDFDocument from 'pdfkit';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 50;
const W = PAGE_W - 2 * M;
/** Platz unten für die Fußzeile */
const BOTTOM = 95;
const GREY = '#666666';
const LINE = '#cccccc';

const money = (n: number) => n.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' });
const date = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('de-AT') : '';
const qty = (n: number) => n.toLocaleString('de-AT', { maximumFractionDigits: 2 });
const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

type Doc = Omit<ProjectDocument, 'id' | 'projectId' | 'filePath' | 'invoiceId' | 'createdAt'>;

/** Angebot oder Rechnung als A4-PDF; logoFile = PNG/JPEG auf der Platte */
export function renderDocumentPdf(
  doc: Doc,
  company: CompanyProfile,
  logoFile: string | null,
): Promise<Buffer> {
  const title = `${DOCUMENT_KIND_LABELS[doc.kind]} ${doc.number}`;
  const pdf = new PDFDocument({
    size: 'A4',
    margins: { top: M, left: M, right: M, bottom: BOTTOM },
    bufferPages: true,
    info: { Title: title, Author: company.name },
  });
  const chunks: Buffer[] = [];
  pdf.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });

  // Kopf: Logo rechts, Firma links
  if (logoFile) {
    try {
      pdf.image(logoFile, PAGE_W - M - 170, 40, { fit: [170, 70], align: 'right' });
    } catch {
      // Defektes Logo soll das Dokument nicht verhindern
    }
  }
  pdf
    .font('Helvetica-Bold')
    .fontSize(14)
    .fillColor('black')
    .text(company.name, M, 45, {
      width: W - 190,
    });
  pdf
    .font('Helvetica')
    .fontSize(9)
    .fillColor(GREY)
    .text(lines(company.address).join('\n'), { width: W - 190 });

  // Absenderzeile und Empfänger
  const top = 150;
  pdf
    .fontSize(7)
    .fillColor(GREY)
    .text([company.name, ...lines(company.address)].join(' · '), M, top, {
      width: 260,
      underline: true,
    });
  pdf
    .fontSize(10)
    .fillColor('black')
    .text(lines(doc.recipient).join('\n'), M, top + 16, {
      width: 260,
    });
  const recipientEnd = pdf.y;

  // Infoblock rechts
  const info: [string, string][] = [
    [doc.kind === 'invoice' ? 'Rechnungsnummer' : 'Angebotsnummer', doc.number],
    [doc.kind === 'invoice' ? 'Rechnungsdatum' : 'Datum', date(doc.date)],
  ];
  if (doc.kind === 'invoice' && doc.serviceDate)
    info.push(['Leistungsdatum', date(doc.serviceDate)]);
  if (doc.dueDate)
    info.push([doc.kind === 'invoice' ? 'Zahlbar bis' : 'Gültig bis', date(doc.dueDate)]);
  if (company.vatId) info.push(['UID-Nr.', company.vatId]);
  const infoX = PAGE_W - M - 210;
  let y = top + 16;
  pdf.fontSize(9);
  for (const [label, value] of info) {
    pdf.fillColor(GREY).text(label, infoX, y, { width: 100 });
    pdf.fillColor('black').text(value, infoX + 100, y, { width: 110, align: 'right' });
    y += 14;
  }

  // Titel und Einleitung
  y = Math.max(recipientEnd, y) + 30;
  pdf.font('Helvetica-Bold').fontSize(18).fillColor('black').text(title, M, y, { width: W });
  pdf.moveDown(0.6);
  if (doc.intro) pdf.font('Helvetica').fontSize(10).text(doc.intro, { width: W }).moveDown(0.6);

  // Positionen
  const cols = { pos: M, desc: M + 28, qty: M + W - 220, unit: M + W - 160, total: M + W - 80 };
  const descW = cols.qty - cols.desc - 10;
  const bottomLimit = PAGE_H - BOTTOM;
  const header = () => {
    const hy = pdf.y + 4;
    pdf.font('Helvetica-Bold').fontSize(9).fillColor('black');
    pdf.text('Pos.', cols.pos, hy, { width: 26 });
    pdf.text('Beschreibung', cols.desc, hy, { width: descW });
    pdf.text('Menge', cols.qty, hy, { width: 50, align: 'right' });
    pdf.text(doc.smallBusiness ? 'Einzelpreis' : 'Einzelpreis netto', cols.unit - 20, hy, {
      width: 90,
      align: 'right',
    });
    pdf.text('Gesamt', cols.total, hy, { width: 80, align: 'right' });
    const ly = hy + 14;
    pdf
      .moveTo(M, ly)
      .lineTo(M + W, ly)
      .strokeColor(LINE)
      .lineWidth(0.8)
      .stroke();
    pdf.y = ly + 6;
  };
  header();
  pdf.font('Helvetica').fontSize(10);
  doc.items.forEach((item, i) => {
    const h = pdf.heightOfString(item.description, { width: descW });
    if (pdf.y + h + 4 > bottomLimit) {
      pdf.addPage();
      pdf.y = M;
      header();
      pdf.font('Helvetica').fontSize(10);
    }
    const ry = pdf.y;
    pdf.fillColor('black');
    pdf.text(String(i + 1), cols.pos, ry, { width: 26 });
    pdf.text(qty(item.quantity), cols.qty, ry, { width: 50, align: 'right' });
    pdf.text(money(item.unitPrice), cols.unit, ry, { width: 70, align: 'right' });
    pdf.text(money(item.quantity * item.unitPrice), cols.total, ry, { width: 80, align: 'right' });
    pdf.text(item.description, cols.desc, ry, { width: descW });
    pdf.y = Math.max(pdf.y, ry + h) + 6;
  });
  pdf
    .moveTo(M, pdf.y)
    .lineTo(M + W, pdf.y)
    .strokeColor(LINE)
    .lineWidth(0.8)
    .stroke();

  // Summen
  const sums: [string, string, boolean][] = doc.smallBusiness
    ? [['Gesamtbetrag', money(doc.gross), true]]
    : [
        ['Summe netto', money(doc.net), false],
        [`zzgl. ${qty(doc.vatRate)} % USt.`, money(doc.vat), false],
        ['Gesamtbetrag', money(doc.gross), true],
      ];
  if (pdf.y + sums.length * 16 + 10 > bottomLimit) {
    pdf.addPage();
    pdf.y = M;
  }
  y = pdf.y + 8;
  for (const [label, value, strong] of sums) {
    pdf.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 11 : 10);
    pdf.text(label, M + W - 260, y, { width: 170, align: 'right' });
    pdf.text(value, cols.total - 10, y, { width: 90, align: 'right' });
    y += 16;
  }

  // Hinweise
  const notes: string[] = [];
  if (doc.smallBusiness) notes.push(SMALL_BUSINESS_NOTE);
  if (doc.kind === 'invoice' && doc.dueDate)
    notes.push(
      `Zahlbar ohne Abzug bis ${date(doc.dueDate)}` +
        (company.iban ? ' auf das unten angeführte Konto' : '') +
        `. Verwendungszweck: ${doc.number}`,
    );
  if (doc.kind === 'offer' && doc.dueDate)
    notes.push(`Dieses Angebot ist gültig bis ${date(doc.dueDate)}.`);
  if (doc.notes) notes.push(doc.notes);
  pdf.font('Helvetica').fontSize(10).fillColor('black');
  pdf.x = M;
  pdf.y = y + 14;
  for (const note of notes) {
    if (pdf.y + pdf.heightOfString(note, { width: W }) > bottomLimit) {
      pdf.addPage();
      pdf.y = M;
    }
    pdf.text(note, M, pdf.y, { width: W }).moveDown(0.5);
  }

  // Fußzeile auf jeder Seite
  const contact = [company.phone && `Tel. ${company.phone}`, company.email, company.website].filter(
    Boolean,
  ) as string[];
  const bank = [
    company.bank,
    company.iban && `IBAN ${company.iban}`,
    company.bic && `BIC ${company.bic}`,
  ].filter(Boolean) as string[];
  const columns = [[company.name, ...lines(company.address)], contact, bank].filter(
    (c) => c.length,
  );
  const range = pdf.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    pdf.switchToPage(range.start + i);
    // Ohne unteren Rand, sonst bricht pdfkit die Fußzeile auf eine neue Seite um
    pdf.page.margins.bottom = 0;
    const fy = PAGE_H - BOTTOM + 25;
    pdf
      .moveTo(M, fy - 8)
      .lineTo(M + W, fy - 8)
      .strokeColor(LINE)
      .lineWidth(0.5)
      .stroke();
    pdf.font('Helvetica').fontSize(7.5).fillColor(GREY);
    const colW = W / Math.max(columns.length, 1);
    columns.forEach((col, c) =>
      pdf.text(col.join('\n'), M + c * colW, fy, { width: colW - 8, lineGap: 1 }),
    );
    if (range.count > 1)
      pdf.text(`Seite ${i + 1} von ${range.count}`, M, PAGE_H - 22, { width: W, align: 'right' });
  }

  pdf.end();
  return done;
}
