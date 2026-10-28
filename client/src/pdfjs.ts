// pdf.js mit Worker – gemeinsam für das Auslesen von Rechnungen und die PDF-Anzeige.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };

/**
 * Alle Seiten eines PDFs als Bilder in `container` zeichnen, so breit wie der Container. Android-
 * Browser und die Home-Assistant-App zeigen PDFs nicht selbst an, daher rendern wir sie.
 */
export async function renderPdfPages(data: ArrayBuffer, container: HTMLElement) {
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await task.promise;
  try {
    const width = container.clientWidth || 600;
    const ratio = window.devicePixelRatio || 1;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (width / base.width) * ratio });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      canvas.style.width = '100%';
      canvas.className = 'rounded-md bg-white shadow-sm';
      canvas.setAttribute('aria-label', `Seite ${n} von ${doc.numPages}`);
      canvas.setAttribute('role', 'img');
      await page.render({ canvas, viewport }).promise;
      container.appendChild(canvas);
    }
    return doc.numPages;
  } finally {
    await task.destroy();
  }
}
