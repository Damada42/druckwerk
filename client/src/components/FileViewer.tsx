import { Download } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { appUrl } from '../base';
import { Modal, cx } from './ui';

/**
 * Öffnet eine hochgeladene Datei (PDF, Foto) in der App statt in einem neuen Fenster. Hinter
 * Home-Assistant-Ingress landet ein neues Fenster in der Home-Assistant-App am Handy im externen
 * Browser – ohne Ingress-Anmeldung gibt es dort nur „401 Unauthorized“. Hier wird die Datei mit
 * der bestehenden Anmeldung geladen und angezeigt.
 */
export function FileLink({
  path,
  name,
  className,
  title,
  label,
  children,
}: {
  path: string;
  /** Dateiname zum Herunterladen und als Fenstertitel */
  name: string;
  className?: string;
  title?: string;
  /** Name des Knopfs für Screenreader, wenn er nur ein Symbol zeigt */
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={cx('inline-flex items-center gap-1.5', className)}
        title={title}
        aria-label={label}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      {open && <FileViewer path={path} name={name} onClose={() => setOpen(false)} />}
    </>
  );
}

type Loaded = { url: string; kind: 'pdf' | 'image' | 'other' };

function FileViewer({ path, name, onClose }: { path: string; name: string; onClose: () => void }) {
  const [file, setFile] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<number | null>(null);
  const pagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      const res = await fetch(appUrl(path), { redirect: 'manual' });
      if (!res.ok)
        throw new Error(`Die Datei lässt sich nicht laden (Fehler ${res.status || 'Anmeldung'}).`);
      const blob = await res.blob();
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      const kind =
        blob.type === 'application/pdf' || /\.pdf$/i.test(path)
          ? 'pdf'
          : blob.type.startsWith('image/')
            ? 'image'
            : 'other';
      setFile({ url, kind });
      if (kind === 'pdf') {
        const { renderPdfPages } = await import('../pdfjs');
        // Container erst nach dem Rendern des Fensters da
        await new Promise((r) => requestAnimationFrame(r));
        if (!cancelled && pagesRef.current) {
          // Beschädigtes PDF: Hinweis statt pdf.js-Fehlermeldung, Herunterladen geht weiter
          const count = await renderPdfPages(await blob.arrayBuffer(), pagesRef.current).catch(
            () => 0,
          );
          if (!cancelled) setPages(count);
        }
      }
    })().catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);

  return (
    <Modal
      title={name}
      onClose={onClose}
      wide
      footer={
        file && (
          <a
            href={file.url}
            download={name}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-strong"
          >
            <Download size={16} /> Herunterladen
          </a>
        )
      }
    >
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!file && !error && <p className="text-sm text-muted">Lade Datei…</p>}
      {file?.kind === 'image' && (
        <img src={file.url} alt={name} className="mx-auto max-h-[70dvh] rounded-md" />
      )}
      {file?.kind === 'pdf' && (
        <>
          {pages === null && <p className="text-sm text-muted">Bereite Seiten vor…</p>}
          {pages === 0 && (
            <p className="text-sm text-muted">
              Für dieses PDF gibt es keine Vorschau (Datei beschädigt?) – bitte herunterladen.
            </p>
          )}
          <div ref={pagesRef} className="space-y-3" aria-label="PDF-Seiten" />
        </>
      )}
      {file?.kind === 'other' && (
        <p className="text-sm text-muted">
          Für diese Datei gibt es keine Vorschau – bitte herunterladen.
        </p>
      )}
    </Modal>
  );
}
