import { BarcodeFormat } from '@zxing/library';
import { cleanCode, createReader, getNativeDetector } from './barcode';
import { release, scaledCopy } from './image';

/** Für die Fehlersuche: wie viele Bilder geprüft wurden und was darauf zu sehen war */
export interface LiveStats {
  frames: number;
  nativeErrors: number;
  lastError?: string;
  engine: 'native' | 'zxing';
  /** Kontrast (Standardabweichung der Helligkeit) des letzten Bildes – nahe 0 = schwarz/leer */
  contrast?: number;
  /** Fokusabstand beim letzten Bild (nur bei manuellem Fokus) */
  focusDistance?: number;
  /** Gelesene Codes, die (noch) nicht bestätigt wurden – viele davon deuten auf Fehllesungen */
  unconfirmed?: number;
  /** true, sobald der Fokus von Hand eingestellt wurde */
  manualFocus?: boolean;
  /** Kleines Vorschaubild als JPEG-Data-URL */
  sample?: string;
  stopped?: boolean;
}

export interface FocusRange {
  min: number;
  max: number;
  step: number;
}

export interface LiveScan {
  stop(): void;
  /** Welche Erkennung läuft: eingebaut (Browser) oder ZXing */
  engine: 'native' | 'zxing';
  width?: number;
  height?: number;
  /**
   * Von Hand einstellbarer Fokus – vorhanden, wenn das Handy dem Browser keinen Autofokus
   * anbietet. Ohne Eingriff fährt der Scanner den Bereich selbst ab.
   */
  focus?: FocusRange & {
    /** Fokus setzen; beendet das automatische Durchfahren */
    set(distance: number): void;
  };
  /**
   * Ob der Browser den Autofokus nutzen darf; undefined, wenn die Kamera nichts dazu meldet
   * (z.B. Webcams). Ohne Autofokus bleibt das Video im Nahbereich meist zu unscharf.
   */
  autofocus?: boolean;
  /** Kamera-Fähigkeiten für die Fehlersuche */
  capabilities: Record<string, unknown>;
}

/** Helligkeits-Standardabweichung auf einer 32×32-Verkleinerung – billig und reicht zum Erkennen leerer Bilder */
function contrastOf(canvas: HTMLCanvasElement, probe: CanvasRenderingContext2D) {
  probe.drawImage(canvas, 0, 0, 32, 32);
  const px = probe.getImageData(0, 0, 32, 32).data;
  let sum = 0;
  let sq = 0;
  for (let i = 0; i < px.length; i += 4) {
    const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    sum += y;
    sq += y * y;
  }
  const n = px.length / 4;
  return Math.round(Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)) * 10) / 10;
}

function thumbnail(canvas: HTMLCanvasElement) {
  const small = scaledCopy(canvas, 320);
  try {
    return small.toDataURL('image/jpeg', 0.6);
  } finally {
    release(small);
  }
}

/**
 * Fokuswerte für das automatische Durchfahren, gleichmäßig über den ganzen Bereich: Die
 * Einheit unterscheidet sich je nach Handy (Samsung meldet z.B. 0–0,79 ohne Angabe), daher
 * keine Annahme, wo „nah“ liegt.
 */
export function focusSweep({ min, max }: FocusRange, steps = 10): number[] {
  const hi = Number.isFinite(max) ? max : min + 2;
  if (hi <= min) return [min];
  return Array.from({ length: steps }, (_, i) => min + ((hi - min) * i) / (steps - 1));
}

/** Formate mit starker Prüfziffer/Fehlerkorrektur – ein einzelner Treffer reicht */
const RELIABLE = new Set(['ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code', 'data_matrix']);
/** Andere Formate (Code 128) müssen zweimal gleich gelesen werden, sonst drohen Fehllesungen */
const CONFIRM_MS = 2500;
/** Leichter Zoom: Codes erscheinen größer, und der Abstand liegt eher im scharfen Bereich */
const ZOOM = 2;

/** Zeit pro Fokusstufe – genug, damit die Linse anfährt und ein paar Bilder geprüft werden */
const SWEEP_MS = 450;

/**
 * Startet die Rückkamera in HD und meldet den ersten erkannten Barcode oder QR-Code.
 * Prüft laufend Einzelbilder aus dem Video (eingebaute Erkennung + ZXing als zweite Meinung).
 */
export async function startLiveScan(
  video: HTMLVideoElement,
  /** frame: das ganze Bild beim Treffer, z.B. um das Etikett daneben zu lesen */
  onCode: (code: string, format: string, frame: HTMLCanvasElement) => void,
  onStats?: (stats: LiveStats) => void,
): Promise<LiveScan> {
  // HD statt Standard-VGA: feine Striche von EAN-Codes brauchen Auflösung
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });
  const track = stream.getVideoTracks()[0];
  const caps = (track.getCapabilities?.() ?? {}) as {
    focusMode?: string[];
    focusDistance?: FocusRange;
    zoom?: { min: number; max: number };
  } & Record<string, unknown>;
  const apply = (c: Record<string, unknown>) =>
    track.applyConstraints({ advanced: [c as MediaTrackConstraintSet] }).catch(() => undefined);

  // Manche Handys (z.B. Samsung mit Android 10) bieten dem Browser keinen Autofokus an,
  // nur manuellen – das Video bleibt dann im Nahbereich unscharf.
  const range =
    !caps.focusMode?.includes('continuous') &&
    caps.focusMode?.includes('manual') &&
    caps.focusDistance &&
    caps.focusDistance.max > caps.focusDistance.min
      ? caps.focusDistance
      : undefined;
  if (caps.focusMode?.includes('continuous')) void apply({ focusMode: 'continuous' });
  if (caps.zoom && caps.zoom.max > 1) {
    void apply({ zoom: Math.max(caps.zoom.min, Math.min(ZOOM, caps.zoom.max)) });
  }
  const { width, height } = track.getSettings();

  let stopped = false;
  let sweepTimer: ReturnType<typeof setTimeout> | undefined;
  const stopStream = () => {
    stopped = true;
    clearTimeout(sweepTimer);
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
  /** Ganzes Videobild als eigenes Canvas (bis 1600 px), bevor die Kamera ausgeht */
  const snapshot = () => {
    const frame = document.createElement('canvas');
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
    frame.width = Math.round(video.videoWidth * scale);
    frame.height = Math.round(video.videoHeight * scale);
    frame.getContext('2d')!.drawImage(video, 0, 0, frame.width, frame.height);
    return frame;
  };
  const found = (code: string, format: string) => {
    if (stopped) return;
    const frame = snapshot();
    stopStream();
    onCode(code, format, frame);
  };
  let candidate: { code: string; at: number } | undefined;
  /** true, wenn der Code übernommen werden kann (zuverlässiges Format oder bestätigt) */
  const accept = (code: string, format: string) => {
    if (RELIABLE.has(format)) return true;
    const now = Date.now();
    if (candidate?.code === code && now - candidate.at < CONFIRM_MS) return true;
    candidate = { code, at: now };
    return false;
  };

  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();

  const detector = await getNativeDetector();
  const reader = createReader();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const probeCanvas = document.createElement('canvas');
  probeCanvas.width = probeCanvas.height = 32;
  const probe = probeCanvas.getContext('2d', { willReadFrequently: true })!;

  const stats: LiveStats = { frames: 0, nativeErrors: 0, engine: detector ? 'native' : 'zxing' };
  let reported = false;

  // Fokus automatisch durchfahren, bis der Fokus von Hand eingestellt wird
  if (range) {
    const distances = focusSweep(range);
    let i = 0;
    const next = () => {
      if (stopped) return;
      stats.focusDistance = distances[i];
      void apply({ focusMode: 'manual', focusDistance: distances[i] });
      i = (i + 1) % distances.length;
      sweepTimer = setTimeout(next, SWEEP_MS);
    };
    next();
  }

  // Einzelbild aus dem Video: abwechselnd der Bereich um den Rahmen in voller Auflösung
  // (feine Striche bleiben erhalten) und das ganze Bild verkleinert
  const grab = (band: boolean) => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const sh = band ? Math.round(vh * 0.4) : vh;
    const sy = band ? Math.round((vh - sh) / 2) : 0;
    const scale = Math.min(1, (band ? 1920 : 1280) / Math.max(vw, sh));
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(sh * scale);
    ctx.drawImage(video, 0, sy, vw, sh, 0, 0, canvas.width, canvas.height);
  };

  const tick = async () => {
    if (stopped) return;
    if (video.readyState >= 2 && video.videoWidth) {
      stats.frames++;
      grab(stats.frames % 2 === 1);
      stats.contrast = contrastOf(canvas, probe);
      let hit: { code: string; format: string } | undefined;
      if (detector) {
        try {
          const [first] = await detector.detect(canvas);
          if (first) hit = { code: cleanCode(first.rawValue), format: first.format };
        } catch (e) {
          stats.nativeErrors++;
          stats.lastError ??= e instanceof Error ? e.message : String(e);
        }
      }
      // ZXing als zweite Meinung (ohne eingebaute Erkennung jedes Bild, sonst jedes dritte)
      if (!hit && (!detector || stats.frames % 3 === 0)) {
        try {
          const result = reader.decodeFromCanvas(canvas);
          hit = {
            code: cleanCode(result.getText()),
            format: BarcodeFormat[result.getBarcodeFormat()].toLowerCase(),
          };
        } catch {
          // nichts gefunden
        }
      }
      if (hit?.code) {
        if (accept(hit.code, hit.format)) return found(hit.code, hit.format);
        stats.unconfirmed = (stats.unconfirmed ?? 0) + 1;
      }
      if (!reported && stats.frames >= 40) {
        reported = true;
        onStats?.({ ...stats, sample: thumbnail(canvas) });
      }
    }
    setTimeout(tick, 80);
  };
  void tick();

  return {
    stop: () => {
      if (!stopped && stats.frames) {
        onStats?.({
          ...stats,
          sample: canvas.width ? thumbnail(canvas) : undefined,
          stopped: true,
        });
      }
      stopStream();
      release(canvas, probeCanvas);
    },
    engine: stats.engine,
    width,
    height,
    focus: range && {
      min: range.min,
      max: range.max,
      step: range.step,
      set: (distance) => {
        clearTimeout(sweepTimer);
        sweepTimer = undefined;
        stats.focusDistance = distance;
        stats.manualFocus = true;
        void apply({ focusMode: 'manual', focusDistance: distance });
      },
    },
    autofocus: caps.focusMode
      ? caps.focusMode.includes('continuous') || caps.focusMode.includes('single-shot')
      : undefined,
    capabilities: caps,
  };
}
