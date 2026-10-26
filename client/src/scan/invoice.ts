import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { prepareImage, release } from './image';
import { recognizeText } from './ocr';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Rechnungen stehen auf den ersten Seiten; mehr zu lesen kostet nur Zeit */
const MAX_PAGES = 3;
/** Weniger Zeichen in der Textebene = eingescanntes PDF ohne Text → Texterkennung nötig */
const MIN_TEXT_CHARS = 40;

export interface InvoiceText {
  text: string;
  /** Woher der Text stammt: Textebene des PDFs oder Texterkennung (Foto/Scan) */
  source: 'pdf' | 'ocr';
}

type Progress = (status: string, pct?: number) => void;

interface TextItem {
  str: string;
  transform: number[];
}

/**
 * Setzt die Textstücke einer PDF-Seite wieder zu Zeilen zusammen. pdf.js liefert sie in
 * Zeichenreihenfolge, Tabellenzellen einer Zeile aber oft getrennt – für die Erkennung
 * („Gesamtbetrag … 35,65 €“) müssen sie in einer Zeile stehen.
 */
function toLines(items: TextItem[]): string {
  const rows: { y: number; parts: { x: number; s: string }[] }[] = [];
  for (const item of items) {
    if (!item.str.trim()) continue;
    const [, , , , x, y] = item.transform;
    let row = rows.find((r) => Math.abs(r.y - y) < 3);
    if (!row) rows.push((row = { y, parts: [] }));
    row.parts.push({ x, s: item.str });
  }
  return rows
    .sort((a, b) => b.y - a.y)
    .map((r) =>
      r.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.s)
        .join('  '),
    )
    .join('\n');
}

async function readPdf(file: File, onProgress: Progress): Promise<InvoiceText> {
  onProgress('Lese PDF…');
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(toLines(content.items.filter((i) => 'str' in i) as TextItem[]));
    }
    const text = pages.join('\n');
    if (text.replace(/\s/g, '').length >= MIN_TEXT_CHARS) return { text, source: 'pdf' };

    // Eingescanntes PDF: erste Seite als Bild rendern und Text erkennen
    onProgress('PDF ist ein Scan – erkenne Text…', 0);
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: Math.min(3, 2400 / Math.max(base.width, base.height)),
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    try {
      await page.render({ canvas, viewport }).promise;
      return {
        text: await recognizeText(canvas, (pct) => onProgress('Erkenne Text…', pct)),
        source: 'ocr',
      };
    } finally {
      release(canvas);
    }
  } finally {
    await task.destroy();
  }
}

async function readImage(file: File, onProgress: Progress): Promise<InvoiceText> {
  onProgress('Erkenne Text… (beim ersten Mal werden Sprachdaten geladen)', 0);
  // Rechnungen haben kleine Schrift – deutlich größer als beim Etikett lassen
  const image = await prepareImage(file, 2400);
  try {
    return {
      text: await recognizeText(image, (pct) => onProgress('Erkenne Text…', pct)),
      source: 'ocr',
    };
  } finally {
    release(image);
  }
}

/** Holt den Text aus einer Rechnung (PDF oder Foto). */
export function readInvoiceText(file: File, onProgress: Progress): Promise<InvoiceText> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  return isPdf ? readPdf(file, onProgress) : readImage(file, onProgress);
}
