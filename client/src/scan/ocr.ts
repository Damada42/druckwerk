import { createWorker } from 'tesseract.js';

/**
 * Liest den Text eines vorbereiteten Bildes (Etikett, Rechnung) auf Deutsch + Englisch.
 * Die Sprachdaten lädt Tesseract beim ersten Mal aus dem Internet; danach liegen sie im Browser-Cache.
 */
export async function recognizeText(
  image: HTMLCanvasElement,
  onProgress: (pct: number) => void,
): Promise<string> {
  const worker = await createWorker(['deu', 'eng'], 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress(Math.round(m.progress * 100));
    },
  });
  try {
    const { data } = await worker.recognize(image);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
