/** Aus dem Text einer Rechnung erkannte Angaben – alles Vorschläge, die man prüfen sollte */
export interface InvoiceGuess {
  /** Endbetrag (brutto) in Euro */
  amount?: number;
  /** ISO-Datum JJJJ-MM-TT */
  date?: string;
  number?: string;
  /** Händler/Aussteller */
  vendor?: string;
  /** Gekaufte Artikel (Bezeichnungen aus der Positionstabelle) */
  items?: string[];
}

/**
 * Schlüsselwörter für den Endbetrag, stärkste zuerst. „Summe“/„Total“ allein stehen auch
 * vor Zwischensummen, daher erst nach den eindeutigen Begriffen.
 */
const AMOUNT_KEYWORDS = [
  /gesamtbetrag|rechnungsbetrag|endbetrag|zahlbetrag|zu\s*zahlen|zahlungsbetrag|gesamtsumme|summe\s*brutto|brutto\s*summe|bruttobetrag|grand\s*total|amount\s*due|total\s*due|order\s*total|invoice\s*total/i,
  /gesamt\s*\(?brutto|total\s*\(?incl|inkl\.?\s*mwst|brutto/i,
  /gesamt|summe|total|betrag/i,
];

/** Zeilen mit diesen Begriffen sind nie der Endbetrag */
const NEVER_TOTAL = /zwischensumme|subtotal|netto|\bnet\b/i;
/** Bei den schwachen Schlüsselwörtern („Summe“, „Betrag“) zusätzlich Steuer, Versand usw. ausschließen */
const NOT_WEAK_TOTAL =
  /mwst|ust\.|umsatzsteuer|steuer|tax|vat|versand|shipping|rabatt|discount|skonto|gutschein/i;

const DATE_KEYWORDS = /rechnungsdatum|invoice\s*date|belegdatum|datum|date/i;

const NUMBER_KEYWORDS =
  /(?:rechnungs?|beleg|invoice|bill)[\s-]*(?:nummer|nr\.?|no\.?|number|#)|rechnung\s*nr\.?|re[\s.-]*nr\.?/i;

const KNOWN_VENDORS = [
  'Amazon',
  'AliExpress',
  'eBay',
  'Reichelt',
  'Conrad',
  'Pollin',
  'Berrybase',
  'Voelkner',
  'Kaufland',
  'Otto',
  'Bambu Lab',
  'Prusa',
  '3DJake',
  'Elegoo',
  'Anycubic',
  'Creality',
  'Sunlu',
  'Polymaker',
  'Nobufil',
  'Extrudr',
  'Hornbach',
  'Bauhaus',
  'OBI',
  'Toom',
  'Hagebau',
  'Würth',
  'Mouser',
  'DigiKey',
  'LCSC',
  'JLCPCB',
  'Temu',
];

const MONTHS: Record<string, number> = {
  jan: 1,
  januar: 1,
  january: 1,
  feb: 2,
  februar: 2,
  february: 2,
  mär: 3,
  mar: 3,
  märz: 3,
  maerz: 3,
  march: 3,
  apr: 4,
  april: 4,
  mai: 5,
  may: 5,
  jun: 6,
  juni: 6,
  june: 6,
  jul: 7,
  juli: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  okt: 10,
  oct: 10,
  oktober: 10,
  october: 10,
  nov: 11,
  november: 11,
  dez: 12,
  dec: 12,
  dezember: 12,
  december: 12,
};

/**
 * Geldbeträge in einer Zeile: deutsch „1.234,56“, englisch „1,234.56“ oder ohne Tausender.
 * Nur Zahlen mit genau zwei Nachkommastellen – so fallen Mengen, Daten und Nummern raus.
 */
export function findAmounts(line: string): number[] {
  // Nicht mitten in Zahlen und nicht vor weiteren Ziffern (sonst wäre „12.03.2026“ ein Betrag)
  const re =
    /(?<![\d.,])(?:(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})|(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2}))(?![.,]?\d)/g;
  return [...line.matchAll(re)].map(([, deInt, deDec, enInt, enDec]) =>
    deInt !== undefined
      ? Number(`${deInt.replace(/\./g, '')}.${deDec}`)
      : Number(`${enInt.replace(/,/g, '')}.${enDec}`),
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

function isoDate(y: number, m: number, d: number): string | undefined {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return undefined;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return undefined; // z.B. 31.02.
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Erstes Datum in einer Zeile, als ISO-String */
export function findDate(line: string): string | undefined {
  let m = line.match(/(?<!\d)(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4}|\d{2})(?!\d)/);
  if (m) return isoDate(+m[3], +m[2], +m[1]);
  m = line.match(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = line.match(/(?<!\d)(\d{1,2})\/(\d{1,2})\/(\d{4})(?!\d)/);
  if (m) return isoDate(+m[3], +m[2], +m[1]); // europäisch TT/MM/JJJJ
  // „12. März 2026“ / „12 Mar 2026“
  m = line.match(/(?<!\d)(\d{1,2})\.?\s+([a-zäA-ZÄ]{3,9})\.?\s+(\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return isoDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  // „March 12, 2026“
  m = line.match(/([a-zA-Z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return isoDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  return undefined;
}

function findTotal(lines: string[]): number | undefined {
  for (const [tier, keyword] of AMOUNT_KEYWORDS.entries()) {
    // Bei mehreren Treffern zählt der letzte: der Endbetrag steht unten
    let found: number | undefined;
    lines.forEach((line, i) => {
      if (!keyword.test(line) || NEVER_TOTAL.test(line)) return;
      if (tier > 0 && NOT_WEAK_TOTAL.test(line) && !/inkl|incl/i.test(line)) return;
      // Betrag in derselben Zeile, sonst in der nächsten (Tabellen-Layout)
      const amounts = findAmounts(line);
      const value = amounts.length
        ? amounts[amounts.length - 1]
        : findAmounts(lines[i + 1] ?? '')[0];
      if (value !== undefined && value > 0) found = value;
    });
    if (found !== undefined) return found;
  }
  // Notlösung: größter Betrag mit Euro-Zeichen
  const withCurrency = lines
    .filter((l) => /€|eur\b/i.test(l))
    .flatMap(findAmounts)
    .filter((v) => v > 0);
  return withCurrency.length ? Math.max(...withCurrency) : undefined;
}

function findInvoiceDate(lines: string[]): string | undefined {
  for (const [i, line] of lines.entries()) {
    if (!DATE_KEYWORDS.test(line) || /liefer|leistung|fällig|due|bestell|order/i.test(line))
      continue;
    const date = findDate(line) ?? findDate(lines[i + 1] ?? '');
    if (date) return date;
  }
  for (const line of lines) {
    const date = findDate(line);
    if (date) return date;
  }
  return undefined;
}

function findNumber(lines: string[]): string | undefined {
  for (const [i, line] of lines.entries()) {
    const m = line.match(NUMBER_KEYWORDS);
    if (!m) continue;
    const rest = line.slice(m.index! + m[0].length).replace(/^[\s:#.-]+/, '');
    const candidates = [rest, lines[i + 1] ?? ''];
    for (const text of candidates) {
      // Erstes „Wort“ mit mindestens einer Ziffer, z.B. RE-2026-0042 oder 302-1234567-1234567
      const token = text.split(/\s+/).find((t) => /\d/.test(t) && !findDate(t));
      if (token) return token.replace(/[,;.]+$/, '');
    }
  }
  return undefined;
}

function findVendor(lines: string[]): string | undefined {
  const text = lines.join(' ');
  const known = KNOWN_VENDORS.find((v) =>
    new RegExp(`(^|[^a-zäöü])${v.replace(/\s+/g, '\\s*')}([^a-zäöü]|$)`, 'i').test(text),
  );
  if (known) return known;
  // Firmenname mit Rechtsform, meist im Kopf oder Fuß der Rechnung
  const company = lines.find((l) =>
    /\b(GmbH|AG|UG|KG|OHG|e\.K\.|Ltd\.?|Inc\.?|LLC|S\.?à\.?r\.?l\.?|B\.V\.)(\s|$|,)/.test(l),
  );
  return company
    ?.replace(/\s{2,}.*$/, '')
    .replace(/[,|].*$/, '')
    .trim()
    .slice(0, 60);
}

/**
 * Kopfzeile der Positionstabelle: Bezeichnungs- und Mengen-/Preisspalte. Auf Fotos verstümmelt
 * die Texterkennung oft „Beschreibung“ – dann reichen Mengen- und Preisspalte.
 */
const ITEM_HEADER =
  /(?=.*(beschreibung|bezeichnung|artikel|produkt|leistung|description|item))(?=.*(menge|anzahl|stück|qty|quantity|preis|price|betrag|amount))|(menge|anzahl|qty|quantity).*(preis|price)/i;
/** Zeilen nach der Tabelle (Summen, Versand, Steuer) beenden die Artikelliste */
const ITEM_TABLE_END =
  /^(zwischensumme|summe|gesamt|total|subtotal|versand|shipping|rechnungsbetrag|zahlbetrag|endbetrag|netto|mwst|ust\b|rabatt|gutschein)/i;
/** Artikel-/Produktnummern-Zeilen gehören zum vorigen Artikel und schließen ihn ab */
const ITEM_CODE = /\b(asin|ean|gtin|sku|art(ikel)?\.?\s*-?\s*nr\.?)\s*[:.]?\s*\S+/gi;
const MAX_ITEMS = 5;
const MAX_ITEM_CHARS = 80;

/**
 * Preis als eigene Tabellenspalte: frei stehend oder mit Währung. „1.75mm“ im Namen zählt nicht.
 */
const PRICE_COLUMN =
  /(?<=^|\s|\$)(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}(?=\s|$|€)|(?<=^|\s|\$)(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}(?=\s|$|€)/;

/**
 * Bezeichnung aus einer Tabellenzeile: alles vor der ersten Preisspalte, ohne Menge,
 * Positionsnummer, Klammern und Artikelnummern. Zahlen im Namen („257 x 257 mm“) bleiben.
 */
function itemText(line: string, hasPosColumn: boolean): string {
  // Auch „419€“: der Texterkennung geht das Komma gern verloren
  const columns = [line.search(PRICE_COLUMN), line.search(/(?<=\s)\d[\d.,]*\s?€/)];
  const price = Math.min(...columns.map((i) => (i < 0 ? Infinity : i)));
  let text = line
    .slice(0, price)
    .replace(/\([^)]*\)?/g, ' ')
    .replace(ITEM_CODE, ' ')
    .replace(/\bB0[A-Z0-9]{8}\b/g, ' ') // Amazon-ASIN ohne Beschriftung
    .replace(/\s+/g, ' ')
    .trim();
  const trim = (s: string) => s.replace(/^[\s|,;:.…–‚'"„“”-]+|[\s|,;:.…–‚'"„“”-]+$/g, '');
  text = trim(text);
  if (price < Infinity) text = trim(text.replace(/\s\d+$/, '')); // Mengenspalte
  if (hasPosColumn) text = text.replace(/^\d{1,3}\.?\s+/, '');
  return text;
}

function shorten(text: string): string {
  if (text.length <= MAX_ITEM_CHARS) return text;
  const cut = text.slice(0, MAX_ITEM_CHARS);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : undefined).replace(/[,;:–-]+$/, '')}…`;
}

/**
 * Artikelbezeichnungen aus der Positionstabelle. Lange Bezeichnungen sind oft auf mehrere
 * Zeilen umbrochen; eine Zeile mit Preisen gehört zum noch offenen Artikel, sonst beginnt sie
 * einen neuen.
 */
function findItems(lines: string[]): string[] {
  const start = lines.findIndex((l) => ITEM_HEADER.test(l));
  if (start < 0) return [];
  const hasPosColumn = /\bpos/i.test(lines[start]);
  const items: { parts: string[]; priced: boolean; closed: boolean }[] = [];
  for (const line of lines.slice(start + 1, start + 40)) {
    if (ITEM_TABLE_END.test(line) || items.length > MAX_ITEMS) break;
    const current = items.at(-1);
    const hasCode = new RegExp(ITEM_CODE.source, 'i').test(line);
    const priced = PRICE_COLUMN.test(line);
    // Reste neben einer Artikelnummer sind Rauschen, kein Teil des Namens
    const text = hasCode ? '' : itemText(line, hasPosColumn);
    if ((text.match(/[a-zäöüß]/gi) ?? []).length >= 3) {
      // Zeilen ohne Preis setzen den Artikel darüber fort; eine Zeile mit Preis und Text
      // beginnt einen neuen (unbepreiste Reste davor sind meist Kopfzeilen-Rauschen)
      if (current && !current.closed && !priced) {
        if (current.parts.length < 2) current.parts.push(text);
        current.priced ||= priced;
      } else {
        items.push({ parts: [text], priced, closed: false });
      }
    } else if (priced && current && !current.priced) {
      current.priced = true;
    }
    if (hasCode && items.length) items.at(-1)!.closed = true;
  }
  return items
    .filter((i) => i.priced)
    .slice(0, MAX_ITEMS)
    .map((i) => shorten(i.parts.join(' ')));
}

/** Beschreibung für die Rechnungsliste: Artikel, dazu der Händler in Klammern */
export function describeInvoice(guess: InvoiceGuess): string | undefined {
  const items = guess.items ?? [];
  if (!items.length) return guess.vendor;
  const what = items.length > 2 ? `${items[0]} + ${items.length - 1} weitere` : items.join(', ');
  return guess.vendor ? `${what} (${guess.vendor})` : what;
}

/**
 * Liest Endbetrag, Rechnungsdatum, Rechnungsnummer, Händler und Artikel aus dem Text einer Rechnung
 * (aus PDF oder Texterkennung). Robust gegen OCR-typische Zeilenumbrüche, aber nicht perfekt –
 * die Werte sind Vorschläge.
 */
export function parseInvoice(raw: string): InvoiceGuess {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return {
    amount: findTotal(lines),
    date: findInvoiceDate(lines),
    number: findNumber(lines),
    vendor: findVendor(lines),
    items: findItems(lines),
  };
}
