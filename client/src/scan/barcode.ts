import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { release, scaledCopy } from './image';

// Auf Filamentkartons üblich: EAN-13/8, UPC; dazu Code 128 und QR für eigene Etiketten
const FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
];

export function createReader() {
  const hints = new Map<DecodeHintType, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, FORMATS],
    [DecodeHintType.TRY_HARDER, true],
  ]);
  return new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
}

interface NativeDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string; format: string }[]>;
}

interface NativeDetectorClass {
  new (options?: { formats: string[] }): NativeDetector;
  getSupportedFormats(): Promise<string[]>;
}

// Bewusst ohne ITF und Code 39: deren schwache Prüfung liefert auf unscharfen Bildern Fantasie-Codes
const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code', 'data_matrix'];

const PRODUCT_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

let nativeDetector: Promise<NativeDetector | null> | undefined;

/**
 * Eingebaute Erkennung des Browsers (Android, nur über HTTPS) – deutlich schneller und
 * robuster als ZXing, gerade bei Live-Video. Wird einmal angelegt und wiederverwendet.
 */
export function getNativeDetector(): Promise<NativeDetector | null> {
  nativeDetector ??= (async () => {
    const Detector = (window as unknown as { BarcodeDetector?: NativeDetectorClass })
      .BarcodeDetector;
    if (!Detector) return null;
    try {
      const supported = await Detector.getSupportedFormats();
      const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
      return formats.length ? new Detector({ formats }) : null;
    } catch {
      return null;
    }
  })();
  return nativeDetector;
}

/**
 * Bereinigt den gelesenen Inhalt: manche Scanner stellen eine Symbologie-Kennung voran
 * (z.B. „]C1“ für GS1-128) und trennen GS1-Felder mit unsichtbaren Steuerzeichen.
 */
export function cleanCode(raw: string): string {
  return raw
    .replace(/^\][A-Za-z][0-9A-Za-z]/, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
}

async function nativeDetect(source: CanvasImageSource): Promise<string | null> {
  const detector = await getNativeDetector();
  if (!detector) return null;
  try {
    const found = await detector.detect(source);
    // Mehrere Codes im Bild (Etikett mit EAN und QR): der Produkt-Strichcode benennt die
    // genaue Sorte, QR-Codes führen oft nur auf die Hersteller-Webseite
    const rank = (format: string) => (PRODUCT_FORMATS.includes(format) ? 0 : 1);
    const best = [...found].sort((a, b) => rank(a.format) - rank(b.format))[0];
    return best ? cleanCode(best.rawValue) || null : null;
  } catch {
    return null;
  }
}

export const hasNativeDetector = () => 'BarcodeDetector' in window;

/**
 * Sucht einen Barcode in einem vorbereiteten Bild. Probiert zusätzlich eine kleinere Kopie –
 * ZXing findet Barcodes auf großen, leicht unscharfen Fotos verkleinert oft besser.
 */
export async function decodeBarcode(image: HTMLCanvasElement): Promise<string | null> {
  const reader = createReader();
  const attempt = async (canvas: HTMLCanvasElement) => {
    const native = await nativeDetect(canvas);
    if (native) return native;
    try {
      return cleanCode(reader.decodeFromCanvas(canvas).getText()) || null;
    } catch {
      return null;
    }
  };
  const found = await attempt(image);
  if (found) return found;
  const small = scaledCopy(image, 900);
  try {
    return await attempt(small);
  } finally {
    release(small);
  }
}
