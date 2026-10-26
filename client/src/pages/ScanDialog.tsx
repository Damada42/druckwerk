import { manufacturerFromUrl, parseSpoolLabel, type LabelGuess } from '@3dapp/shared';
import type { LiveScan } from '../scan/live';
import { Camera, Keyboard, ScanBarcode, ScanText } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useList } from '../api';
import { clientLog, errorInfo } from '../clientLog';
import { Button, ErrorText, Field, Modal, TextInput } from '../components/ui';
import { canUseLiveCamera } from '../scan/image';

export interface ScanResult {
  barcode?: string;
  guess?: LabelGuess;
  /** Erkannter Rohtext des Etiketts */
  text?: string;
  /**
   * QR-Code mit allgemeiner Hersteller-Adresse ohne Angaben zur Sorte – gilt für alle Farben
   * und Materialien und eignet sich daher nicht zum Merken einer Sorte.
   */
  generic?: boolean;
}

type Mode = 'choose' | 'live' | 'working';

export function ScanDialog({
  onResult,
  onClose,
}: {
  onResult: (r: ScanResult) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>('choose');
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const barcodeInput = useRef<HTMLInputElement>(null);
  const labelInput = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const { data: types = [] } = useList('filament-types');
  const { data: finishes = [] } = useList('finishes');
  const { data: spools = [] } = useList('spools');
  const live = canUseLiveCamera();
  // Handys ohne Autofokus im Browser: dort ist das Foto (Kamera-App mit Autofokus) zuverlässiger
  const [noAutofocus, setNoAutofocus] = useState(() => readFlag(NO_AUTOFOCUS));
  const preferLive = live && !noAutofocus;

  useEffect(() => clientLog('scan-open', { live, noAutofocus }), [live, noAutofocus]);

  /**
   * QR-Codes mancher Hersteller enthalten Klartext oder eine Adresse mit Material/Farbe –
   * daraus wie beim Etikett einen Vorschlag machen. Reine Zahlen (EAN/UPC) bleiben ohne.
   */
  const resultFor = (code: string): ScanResult => {
    if (/^\d+$/.test(code)) return { barcode: code };
    let text = code;
    try {
      text = decodeURIComponent(code);
    } catch {
      // kein gültiges URL-Encoding – Rohtext verwenden
    }
    text = text.replace(/[/?&=_+,;|-]+/g, ' ');
    const manufacturers = [...new Set(spools.map((s) => s.manufacturer))];
    const guess = parseSpoolLabel(text, {
      types: types.map((t) => t.name),
      finishes: finishes.map((f) => f.name),
      manufacturers,
    });
    const isUrl = /^https?:\/\//i.test(code);
    // Sorte steht drin, wenn Material oder Farbe erkannt wurde – sonst nur Werbe-/Firmenadresse
    const generic = isUrl && !guess.typeName && !guess.colorName;
    if (isUrl) guess.manufacturer ??= manufacturerFromUrl(code, manufacturers);
    const found = Object.values(guess).some((v) => v !== undefined);
    return { barcode: code, ...(found && { guess, text }), ...(generic && { generic }) };
  };
  const resultForRef = useRef(resultFor);
  resultForRef.current = resultFor;

  // Live-Kamera starten/stoppen
  const liveScan = useRef<LiveScan | null>(null);
  const [focus, setFocus] = useState<{ range: NonNullable<LiveScan['focus']>; value: number }>();
  useEffect(() => {
    if (mode !== 'live' || !video.current) return;
    let cancelled = false;
    const startedAt = Date.now();
    import('../scan/live')
      .then(({ startLiveScan }) =>
        startLiveScan(
          video.current!,
          (code, format) => {
            clientLog('scan-live-found', { code, format, ms: Date.now() - startedAt });
            onResult(resultForRef.current(code));
          },
          (stats) => clientLog('scan-live-stats', { ...stats }),
        ),
      )
      .then((scan) => {
        clientLog('scan-live', {
          engine: scan.engine,
          width: scan.width,
          height: scan.height,
          autofocus: scan.autofocus,
          capabilities: scan.capabilities,
        });
        if (cancelled) return scan.stop();
        liveScan.current = scan;
        if (scan.autofocus === false) {
          writeFlag(NO_AUTOFOCUS);
          setNoAutofocus(true);
        }
        if (scan.focus) setFocus({ range: scan.focus, value: scan.focus.min });
      })
      .catch((e) => {
        clientLog('scan-error', { stage: 'live', ...errorInfo(e) });
        setError('Kamera nicht verfügbar. Bitte Zugriff erlauben oder ein Foto aufnehmen.');
        setMode('choose');
      });
    return () => {
      cancelled = true;
      liveScan.current?.stop();
      liveScan.current = null;
      setFocus(undefined);
    };
  }, [mode, onResult]);

  /** Kamera sofort freigeben – sonst kollidiert sie mit der Kamera-App beim Foto-Umweg. */
  const stopLive = () => {
    liveScan.current?.stop();
    liveScan.current = null;
  };

  const fail = (message: string) => {
    setError(message);
    setProgress(null);
    setMode('choose');
  };

  /** Foto einmal dekodieren und verkleinern; meldet Bildgröße fürs Log. */
  const prepare = async (file: File, kind: string, maxSide: number) => {
    clientLog('scan-photo', { kind, size: file.size, type: file.type });
    const { prepareImage } = await import('../scan/image');
    const image = await prepareImage(file, maxSide);
    clientLog('scan-image', { kind, width: image.width, height: image.height });
    return image;
  };

  const decode = async (image: HTMLCanvasElement, stage: string) => {
    const { decodeBarcode, hasNativeDetector } = await import('../scan/barcode');
    try {
      const code = await decodeBarcode(image);
      clientLog('scan-barcode', { stage, found: !!code, code, native: hasNativeDetector() });
      return code;
    } catch (e) {
      clientLog('scan-error', { stage: `${stage}-barcode`, ...errorInfo(e) });
      return null;
    }
  };

  const onBarcodePhoto = async (file: File) => {
    setError(null);
    setMode('working');
    setStatus('Suche Barcode…');
    const { release } = await import('../scan/image');
    let image: HTMLCanvasElement | undefined;
    try {
      // Groß genug, dass auch kleine QR-Codes auf Etiketten lesbar bleiben
      image = await prepare(file, 'barcode', 2400);
      const code = await decode(image, 'barcode');
      if (code) onResult(resultFor(code));
      else
        fail(
          'Kein Barcode oder QR-Code erkannt. Näher rangehen, scharf stellen und gerade fotografieren.',
        );
    } catch (e) {
      clientLog('scan-error', { stage: 'barcode-image', ...errorInfo(e) });
      fail('Das Foto konnte nicht gelesen werden. Bitte nochmal versuchen.');
    } finally {
      if (image) release(image);
    }
  };

  const onLabelPhoto = async (file: File) => {
    setError(null);
    setMode('working');
    setStatus('Lese Etikett… (beim ersten Mal werden Sprachdaten geladen)');
    setProgress(0);
    const { release } = await import('../scan/image');
    let image: HTMLCanvasElement | undefined;
    try {
      image = await prepare(file, 'label', 1600);
      // Nacheinander statt gleichzeitig, damit der Speicher auf schwächeren Handys reicht
      const code = await decode(image, 'label');
      const { recognizeText } = await import('../scan/ocr');
      const text = await recognizeText(image, (pct) => {
        setStatus('Erkenne Text…');
        setProgress(pct);
      });
      const guess = parseSpoolLabel(text, {
        types: types.map((t) => t.name),
        finishes: finishes.map((f) => f.name),
        manufacturers: [...new Set(spools.map((s) => s.manufacturer))],
      });
      const found = Object.values(guess).some((v) => v !== undefined);
      clientLog('scan-ocr', {
        chars: text.length,
        recognized: Object.keys(guess).filter((k) => guess[k as keyof LabelGuess] !== undefined),
        sample: text.slice(0, 200),
      });
      if (!found && !code) {
        return fail(
          'Auf dem Foto wurde nichts Brauchbares erkannt. Etikett gut ausleuchten und formatfüllend fotografieren.',
        );
      }
      onResult({ barcode: code ?? undefined, guess, text });
    } catch (e) {
      clientLog('scan-error', { stage: 'ocr', ...errorInfo(e) });
      fail('Texterkennung fehlgeschlagen. Beim ersten Mal wird eine Internetverbindung benötigt.');
    } finally {
      if (image) release(image);
    }
  };

  const pick = (input: HTMLInputElement | null) => {
    if (input) {
      input.value = '';
      input.click();
    }
  };

  return (
    <Modal title="Filament scannen" onClose={onClose}>
      <input
        ref={barcodeInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-testid="barcode-photo"
        onChange={(e) => e.target.files?.[0] && onBarcodePhoto(e.target.files[0])}
      />
      <input
        ref={labelInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-testid="label-photo"
        onChange={(e) => e.target.files?.[0] && onLabelPhoto(e.target.files[0])}
      />

      {mode === 'choose' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Choice
              icon={<ScanBarcode size={26} />}
              title="Barcode / QR-Code scannen"
              text={preferLive ? 'Live mit der Kamera' : 'Foto aufnehmen (Kamera mit Autofokus)'}
              onClick={() => (preferLive ? setMode('live') : pick(barcodeInput.current))}
            />
            <Choice
              icon={<ScanText size={26} />}
              title="Etikett fotografieren"
              text="Text wird erkannt und vorausgefüllt"
              onClick={() => pick(labelInput.current)}
            />
          </div>
          {live && (
            <button
              type="button"
              className="text-sm text-accent hover:underline"
              onClick={() => (preferLive ? pick(barcodeInput.current) : setMode('live'))}
            >
              {preferLive ? 'Barcode lieber als Foto aufnehmen' : 'Live-Scanner trotzdem versuchen'}
            </button>
          )}
          <form
            className="flex items-end gap-2 border-t border-line pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (manual.trim()) onResult({ barcode: manual.trim() });
            }}
          >
            <Field label="Barcode eintippen" className="flex-1">
              <TextInput
                inputMode="numeric"
                placeholder="z.B. 6975337031234"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={!manual.trim()}>
              <Keyboard size={16} /> Übernehmen
            </Button>
          </form>
          {!live && (
            <p className="text-xs text-muted">
              Live-Kamera braucht HTTPS. Über die Heimnetz-Adresse wird deshalb ein Foto aufgenommen
              – das funktioniert genauso.
            </p>
          )}
          <ErrorText error={error} />
        </div>
      )}

      {mode === 'live' && (
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-xl bg-black">
            <video ref={video} className="aspect-[4/3] w-full object-cover" muted playsInline />
            <div className="pointer-events-none absolute inset-x-8 top-1/2 h-32 -translate-y-1/2 rounded-lg border-2 border-white/80" />
          </div>
          {noAutofocus ? (
            <div className="space-y-2 rounded-lg border border-line bg-surface-2 p-3 text-sm">
              <p>
                Dein Handy lässt den Browser nicht automatisch scharfstellen – das Live-Bild bleibt
                deshalb oft unscharf. Ein Foto mit der Kamera-App klappt zuverlässiger.
              </p>
              <Button
                variant="primary"
                className="w-full justify-center"
                onClick={() => {
                  stopLive();
                  pick(barcodeInput.current);
                }}
              >
                <Camera size={16} /> Foto aufnehmen
              </Button>
            </div>
          ) : (
            <p className="text-center text-sm text-muted">
              Barcode oder QR-Code in den Rahmen halten…
            </p>
          )}
          {focus && (
            <Field label="Schärfe (stellt sich auch von selbst ein)">
              <input
                type="range"
                className="w-full accent-[var(--color-accent)]"
                min={focus.range.min}
                max={Math.min(focus.range.max, 2)}
                step={focus.range.step || 0.01}
                value={focus.value}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  focus.range.set(value);
                  setFocus({ ...focus, value });
                }}
              />
            </Field>
          )}
          <div className="flex justify-between">
            <Button onClick={() => setMode('choose')}>Zurück</Button>
            <Button
              onClick={() => {
                stopLive();
                pick(barcodeInput.current);
              }}
            >
              <Camera size={16} /> Foto stattdessen
            </Button>
          </div>
        </div>
      )}

      {mode === 'working' && (
        <div className="space-y-3 py-6 text-center" role="status">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-accent/30 border-t-accent" />
          <p className="text-sm">{status}</p>
          {progress !== null && (
            <div className="mx-auto h-2 max-w-xs overflow-hidden rounded-full bg-surface-2">
              <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Choice({
  icon,
  title,
  text,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-6 text-center transition hover:border-accent/60"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent-strong dark:text-orange-300">
        {icon}
      </span>
      <span className="font-semibold">{title}</span>
      <span className="text-xs text-muted">{text}</span>
    </button>
  );
}

const NO_AUTOFOCUS = 'druckwerk.scan.noAutofocus';

/** Merker im Browser – darf fehlen (privater Modus, gesperrter Speicher) */
function readFlag(key: string) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string) {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // ohne Speicher wird es beim nächsten Scan einfach erneut erkannt
  }
}
