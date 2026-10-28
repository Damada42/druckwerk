import {
  DEFAULT_COMPANY,
  DOCUMENT_KINDS,
  DOCUMENT_KIND_LABELS,
  calcDocumentTotals,
  nextDocumentNumber,
  type CompanyProfile,
  type DocumentInput,
  type DocumentItem,
  type DocumentKind,
} from '@3dapp/shared';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { schema, type Db } from '../db/index.js';
import { renderDocumentPdf } from '../documents/pdf.js';
import { parseId } from './crud.js';
import { removeUpload } from './invoices.js';

const { invoices, projectDocuments, projects, settings } = schema;

const LOGO_TYPES: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg' };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const fail = (message: string, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

export function readCompany(db: Db): CompanyProfile {
  const row = db.select().from(settings).where(eq(settings.key, 'company')).get();
  return { ...DEFAULT_COMPANY, ...(row ? JSON.parse(row.value) : {}) };
}

function writeCompany(db: Db, company: CompanyProfile) {
  const value = JSON.stringify(company);
  db.insert(settings)
    .values({ key: 'company', value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

const optionalDate = (v: unknown, label: string) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !ISO_DATE.test(v)) throw fail(`Ungültiges Datum: ${label}`);
  return v;
};

function parseItems(raw: unknown): DocumentItem[] {
  if (!Array.isArray(raw)) throw fail('Positionen fehlen.');
  const items = raw
    .map((i) => ({
      description: String(i?.description ?? '').trim(),
      quantity: Number(i?.quantity),
      unitPrice: Number(i?.unitPrice),
      markupPercent: Number(i?.markupPercent ?? 0),
    }))
    .filter((i) => i.description);
  if (!items.length) throw fail('Bitte mindestens eine Position mit Beschreibung eintragen.');
  if (items.some((i) => !Number.isFinite(i.quantity) || !Number.isFinite(i.unitPrice)))
    throw fail('Menge und Preis müssen Zahlen sein.');
  // Negativ = Rabatt, aber nicht unter null
  if (items.some((i) => !Number.isFinite(i.markupPercent) || i.markupPercent < -100))
    throw fail('Der Aufschlag muss eine Zahl ab -100 % sein.');
  return items;
}

/** Firmendaten, Logo sowie Angebote und Rechnungen als PDF */
export function registerDocumentRoutes(app: FastifyInstance, db: Db, uploadDir: string) {
  app.get('/company', () => readCompany(db));

  app.put<{ Body: Partial<CompanyProfile> }>('/company', (req) => {
    const company = readCompany(db);
    for (const [key, value] of Object.entries(req.body ?? {})) {
      if (!(key in DEFAULT_COMPANY) || key === 'logoPath') continue;
      const expected = typeof DEFAULT_COMPANY[key as keyof CompanyProfile];
      if (typeof value !== expected) throw fail(`Ungültiger Wert für ${key}`);
      if (expected === 'number' && (!Number.isFinite(value) || (value as number) < 0))
        throw fail(`Ungültiger Wert für ${key}`);
      (company as unknown as Record<string, unknown>)[key] =
        typeof value === 'string' ? value.trim() : value;
    }
    writeCompany(db, company);
    return company;
  });

  /** Logo hochladen – der Browser wandelt jedes Bildformat vorher in PNG um */
  app.post('/company/logo', async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'Keine Datei' });
    const ext = LOGO_TYPES[file.mimetype];
    if (!ext) {
      file.file.resume();
      return reply.code(400).send({ error: 'Logo bitte als PNG oder JPEG' });
    }
    const buffer = await file.toBuffer();
    const stored = `logo-${randomUUID()}${ext}`;
    await writeFile(path.join(uploadDir, stored), buffer);
    const company = readCompany(db);
    await removeUpload(uploadDir, company.logoPath);
    company.logoPath = `/uploads/${stored}`;
    writeCompany(db, company);
    return company;
  });

  app.delete('/company/logo', async () => {
    const company = readCompany(db);
    await removeUpload(uploadDir, company.logoPath);
    company.logoPath = null;
    writeCompany(db, company);
    return company;
  });

  const numbers = () =>
    db
      .select({ number: projectDocuments.number })
      .from(projectDocuments)
      .all()
      .map((r) => r.number);

  app.get<{ Querystring: { kind?: string } }>('/documents/next-number', (req) => {
    const kind = (DOCUMENT_KINDS as readonly string[]).includes(req.query.kind ?? '')
      ? (req.query.kind as DocumentKind)
      : 'invoice';
    return { number: nextDocumentNumber(kind, new Date().getFullYear(), numbers()) };
  });

  app.get<{ Params: { id: string } }>('/projects/:id/documents', (req) =>
    db
      .select()
      .from(projectDocuments)
      .where(eq(projectDocuments.projectId, parseId(req.params.id)))
      .orderBy(desc(projectDocuments.id))
      .all(),
  );

  app.post<{ Params: { id: string }; Body: DocumentInput }>(
    '/projects/:id/documents',
    async (req, reply) => {
      const projectId = parseId(req.params.id);
      if (!db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get())
        return reply.code(404).send({ error: 'Projekt nicht gefunden' });
      const company = readCompany(db);
      if (!company.name || !company.address)
        throw fail(
          'Bitte zuerst unter „Einstellungen“ deine Firmendaten (Name, Adresse) eintragen.',
        );

      const body = req.body ?? ({} as DocumentInput);
      if (!(DOCUMENT_KINDS as readonly string[]).includes(body.kind))
        throw fail('Unbekannte Dokumentart');
      const kind = body.kind;
      const date = optionalDate(body.date, 'Datum') ?? new Date().toISOString().slice(0, 10);
      const recipient = String(body.recipient ?? '').trim();
      if (!recipient) throw fail('Bitte den Empfänger eintragen.');
      const items = parseItems(body.items);
      const existing = numbers();
      const number =
        String(body.number ?? '').trim() ||
        nextDocumentNumber(kind, Number(date.slice(0, 4)), existing);
      if (existing.includes(number))
        return reply.code(409).send({ error: `Die Nummer ${number} ist schon vergeben.` });

      const doc = {
        kind,
        number,
        date,
        serviceDate: kind === 'invoice' ? optionalDate(body.serviceDate, 'Leistungsdatum') : null,
        dueDate: optionalDate(body.dueDate, kind === 'invoice' ? 'Zahlbar bis' : 'Gültig bis'),
        recipient,
        intro: String(body.intro ?? '').trim() || null,
        notes: String(body.notes ?? '').trim() || null,
        items,
        smallBusiness: company.smallBusiness,
        showVatId: body.showVatId !== false,
        vatRate: company.smallBusiness ? 0 : company.vatRate,
        ...calcDocumentTotals(items, company.smallBusiness, company.vatRate),
      };
      const logo = company.logoPath ? path.join(uploadDir, path.basename(company.logoPath)) : null;
      const pdf = await renderDocumentPdf(doc, company, logo);
      const stored = `${randomUUID()}.pdf`;
      await writeFile(path.join(uploadDir, stored), pdf);
      const filePath = `/uploads/${stored}`;
      const label = `${DOCUMENT_KIND_LABELS[kind]} ${number}`;

      const row = db.transaction((tx) => {
        // Eine Rechnung erscheint auch unter „Rechnungen“ als Ausgang
        const invoice =
          kind === 'invoice'
            ? tx
                .insert(invoices)
                .values({
                  projectId,
                  type: 'outgoing',
                  date,
                  number,
                  amount: doc.gross,
                  description: label,
                  filePath,
                  fileName: `${label}.pdf`,
                })
                .returning()
                .get()
            : null;
        return tx
          .insert(projectDocuments)
          .values({ ...doc, projectId, filePath, invoiceId: invoice?.id ?? null })
          .returning()
          .get();
      });
      return reply.code(201).send(row);
    },
  );

  app.delete<{ Params: { id: string } }>('/documents/:id', async (req, reply) => {
    const row = db
      .delete(projectDocuments)
      .where(eq(projectDocuments.id, parseId(req.params.id)))
      .returning()
      .get();
    if (!row) return reply.code(404).send({ error: 'Nicht gefunden' });
    if (row.invoiceId) db.delete(invoices).where(eq(invoices.id, row.invoiceId)).run();
    await removeUpload(uploadDir, row.filePath);
    return reply.code(204).send();
  });
}
