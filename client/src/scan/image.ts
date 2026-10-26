/**
 * Dekodiert ein Foto genau einmal und verkleinert es sofort auf Arbeitsgröße.
 * Handyfotos (12 MP+) brauchen dekodiert ~50 MB – mehrfach gleichzeitig im Speicher
 * bringt schwächere Handys dazu, den Browser-Tab zu beenden.
 */
export async function prepareImage(file: Blob, maxSide: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  try {
    return drawScaled(bitmap, bitmap.width, bitmap.height, maxSide);
  } finally {
    bitmap.close();
  }
}

/** Kleinere Kopie eines bereits vorbereiteten Bildes (billig, kein erneutes Dekodieren). */
export function scaledCopy(src: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
  return drawScaled(src, src.width, src.height, maxSide);
}

/** Gibt den Bildspeicher eines Canvas sofort frei, statt auf die Speicherbereinigung zu warten. */
export function release(...canvases: HTMLCanvasElement[]) {
  for (const c of canvases) {
    c.width = 0;
    c.height = 0;
  }
}

function drawScaled(source: CanvasImageSource, width: number, height: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Live-Kamera gibt der Browser nur über HTTPS oder localhost frei. */
export const canUseLiveCamera = () =>
  window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
