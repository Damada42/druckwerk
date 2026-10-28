// Angebote und Rechnungen an Kunden, erzeugt als PDF mit den eigenen Firmendaten.

/** Pflichthinweis für Kleinunternehmer (Österreich) */
export const SMALL_BUSINESS_NOTE = 'Kleinunternehmer gemäß § 6 Abs. 1 Z 27 UStG';

/** Eigene Firmendaten für Angebote und Rechnungen */
export interface CompanyProfile {
  name: string;
  /** Mehrzeilig: Straße, PLZ Ort, Land */
  address: string;
  email: string;
  phone: string;
  website: string;
  /** UID-Nummer, falls vorhanden */
  vatId: string;
  bank: string;
  iban: string;
  bic: string;
  /** Kleinunternehmer: keine Umsatzsteuer, dafür der Hinweis auf dem Dokument */
  smallBusiness: boolean;
  /** Umsatzsteuersatz in Prozent (nur ohne Kleinunternehmerregelung) */
  vatRate: number;
  /** Zahlungsziel einer Rechnung in Tagen */
  paymentDays: number;
  /** Gültigkeit eines Angebots in Tagen */
  offerValidDays: number;
  /** Logo als PNG unter /uploads */
  logoPath: string | null;
}

export const DEFAULT_COMPANY: CompanyProfile = {
  name: '',
  address: '',
  email: '',
  phone: '',
  website: '',
  vatId: '',
  bank: '',
  iban: '',
  bic: '',
  smallBusiness: true,
  vatRate: 20,
  paymentDays: 14,
  offerValidDays: 30,
  logoPath: null,
};

export const DOCUMENT_KINDS = ['offer', 'invoice'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  offer: 'Angebot',
  invoice: 'Rechnung',
};

/** Kürzel für die fortlaufende Nummer, z.B. RE-2026-001 */
export const DOCUMENT_PREFIX: Record<DocumentKind, string> = { offer: 'AN', invoice: 'RE' };

export interface DocumentItem {
  description: string;
  quantity: number;
  /** Einzelpreis netto (bei Kleinunternehmern = Endpreis), ohne Aufschlag */
  unitPrice: number;
  /** Aufschlag auf den Einzelpreis in Prozent; fehlt bei älteren Dokumenten */
  markupPercent?: number;
}

/**
 * Einzelpreis mit Aufschlag, auf Cent gerundet – so steht er auf dem Dokument. Der Kunde sieht
 * nur diesen Preis, den Aufschlag selbst nicht.
 */
export function itemUnitPrice(item: DocumentItem): number {
  return round2(item.unitPrice * (1 + (item.markupPercent ?? 0) / 100));
}

export interface DocumentTotals {
  net: number;
  vat: number;
  gross: number;
}

export interface ProjectDocument extends DocumentTotals {
  id: number;
  projectId: number;
  kind: DocumentKind;
  number: string;
  date: string;
  /** Leistungsdatum (Rechnung) */
  serviceDate: string | null;
  /** Zahlbar bis (Rechnung) bzw. gültig bis (Angebot) */
  dueDate: string | null;
  /** Empfänger, mehrzeilig – beim Erstellen festgehalten */
  recipient: string;
  intro: string | null;
  notes: string | null;
  items: DocumentItem[];
  smallBusiness: boolean;
  /** Eigene UID-Nummer steht auf dem Dokument */
  showVatId: boolean;
  vatRate: number;
  filePath: string;
  /** Zugehöriger Eintrag unter „Rechnungen“ (nur bei Rechnungen) */
  invoiceId: number | null;
  createdAt: string;
}

export type DocumentInput = Pick<
  ProjectDocument,
  'kind' | 'date' | 'serviceDate' | 'dueDate' | 'recipient' | 'intro' | 'notes' | 'items'
> & {
  /** Leer = nächste freie Nummer */
  number?: string;
  /** Ohne Angabe: UID-Nummer drucken (sofern in den Firmendaten eingetragen) */
  showVatId?: boolean;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Netto, Umsatzsteuer und Brutto; Kleinunternehmer zahlen keine Umsatzsteuer */
export function calcDocumentTotals(
  items: DocumentItem[],
  smallBusiness: boolean,
  vatRate: number,
): DocumentTotals {
  const net = round2(items.reduce((sum, i) => sum + round2(i.quantity * itemUnitPrice(i)), 0));
  const vat = smallBusiness ? 0 : round2((net * vatRate) / 100);
  return { net, vat, gross: round2(net + vat) };
}

/** Nächste Nummer im Jahr, z.B. RE-2026-004 nach RE-2026-003 */
export function nextDocumentNumber(kind: DocumentKind, year: number, existing: string[]): string {
  const prefix = `${DOCUMENT_PREFIX[kind]}-${year}-`;
  const max = existing
    .filter((n) => n.startsWith(prefix))
    .map((n) => Number(n.slice(prefix.length)))
    .filter(Number.isFinite)
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}
