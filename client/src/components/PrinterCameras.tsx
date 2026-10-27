import {
  CAMERA_ROTATIONS,
  type HaCamera,
  type Printer,
  type PrinterCamera,
  type PrinterCameraInput,
} from '@3dapp/shared';
import {
  ChevronDown,
  ChevronUp,
  Maximize,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  VideoOff,
} from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useCameraSave, useCameras, useHaCameras, useHaStatus } from '../api';
import { Button, ErrorText, Field, Modal, Select, TextInput, cx } from './ui';

/** Standbilder der Vorschauen und im Ersatzbetrieb so oft neu laden */
const THUMB_MS = 10_000;
const FALLBACK_MS = 3_000;

/**
 * Sichtbar = Seite im Vordergrund und Element im Bild. Streams laufen sonst weiter und belegen
 * Verbindungen (Browser erlauben nur sechs pro Server) und mobile Daten.
 */
function useVisible(ref: RefObject<HTMLElement | null>) {
  const [inView, setInView] = useState(true);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const onChange = () => setPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return inView && pageVisible;
}

/** Zählt alle ms hoch – als Cache-Brecher für Standbilder */
function useTick(ms: number, active: boolean) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms, active]);
  return tick;
}

/**
 * Bild im 16:9-Rahmen drehen. Bei 90/270° wird das Bild so groß gemacht, dass es gedreht
 * genau in den Rahmen passt (Breite = Rahmenhöhe, Höhe = Rahmenbreite).
 */
function rotated(rotation: number): CSSProperties {
  const sideways = rotation === 90 || rotation === 270;
  return {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: sideways ? '56.25%' : '100%',
    height: sideways ? '177.78%' : '100%',
    objectFit: 'contain',
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
  };
}

/** Kamerabilder eines Druckers: gewählte Kamera live, weitere als Vorschau zum Umschalten */
export function PrinterCameras({ printer }: { printer: Printer }) {
  const { data: cameras = [] } = useCameras(printer.id);
  return cameras.length ? <CameraStrip cameras={cameras} /> : null;
}

function CameraStrip({ cameras }: { cameras: PrinterCamera[] }) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const ref = useRef<HTMLElement>(null);
  const visible = useVisible(ref);
  const selected = cameras.find((c) => c.id === selectedId) ?? cameras[0];

  return (
    <section ref={ref} className="mt-4 space-y-2" aria-label="Kameras">
      <CameraView key={selected.id} camera={selected} active={visible} />
      {cameras.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Kamera wählen">
          {cameras.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={c.id === selected.id}
              onClick={() => setSelectedId(c.id)}
              className={cx(
                'flex shrink-0 flex-col items-stretch gap-1 rounded-lg border p-1 text-xs',
                c.id === selected.id
                  ? 'border-accent text-main'
                  : 'border-line text-muted hover:bg-surface-2',
              )}
            >
              <Thumbnail camera={c} active={visible && c.id !== selected.id} />
              <span className="max-w-24 truncate px-1">{c.name}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** Live-Stream; scheitert er, Standbilder alle paar Sekunden (sofern die Kamera welche liefert) */
function CameraView({ camera, active }: { camera: PrinterCamera; active: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'live' | 'snapshot' | 'error'>('live');
  // Neuer Versuch: Stream mit neuer Adresse neu öffnen
  const [attempt, setAttempt] = useState(0);
  const tick = useTick(FALLBACK_MS, active && mode === 'snapshot');

  const src =
    mode === 'live'
      ? `/api/cameras/${camera.id}/stream?a=${attempt}`
      : `/api/cameras/${camera.id}/snapshot?t=${tick}`;

  return (
    <div
      ref={box}
      className="relative aspect-video overflow-hidden rounded-lg border border-line bg-black"
    >
      {active && mode !== 'error' && (
        <img
          src={src}
          alt={camera.name}
          style={rotated(camera.rotation)}
          onError={() => setMode(mode === 'live' && camera.hasSnapshot ? 'snapshot' : 'error')}
        />
      )}
      {mode === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white/80">
          <VideoOff size={22} />
          Kamera „{camera.name}“ nicht erreichbar
        </div>
      )}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent px-2 py-1 text-xs text-white">
        <span className="truncate">
          {camera.name}
          {mode === 'snapshot' && ' · Standbild'}
        </span>
        <span className="flex shrink-0 gap-1">
          {mode !== 'live' && (
            <button
              type="button"
              className="rounded p-1 hover:bg-white/20"
              aria-label="Livebild erneut versuchen"
              title="Livebild erneut versuchen"
              onClick={() => {
                setAttempt((a) => a + 1);
                setMode('live');
              }}
            >
              <RefreshCw size={14} />
            </button>
          )}
          {document.fullscreenEnabled && (
            <button
              type="button"
              className="rounded p-1 hover:bg-white/20"
              aria-label="Vollbild"
              title="Vollbild"
              onClick={() =>
                document.fullscreenElement
                  ? document.exitFullscreen()
                  : box.current?.requestFullscreen()
              }
            >
              <Maximize size={14} />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

function Thumbnail({ camera, active }: { camera: PrinterCamera; active: boolean }) {
  const tick = useTick(THUMB_MS, active && camera.hasSnapshot);
  const [failed, setFailed] = useState(false);
  return (
    <span className="relative block h-14 w-24 overflow-hidden rounded bg-black">
      {camera.hasSnapshot && !failed ? (
        <img
          src={`/api/cameras/${camera.id}/snapshot?t=${tick}`}
          alt=""
          style={rotated(camera.rotation)}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-white/60">
          <VideoOff size={16} />
        </span>
      )}
    </span>
  );
}

/** Kurzbeschreibung der Quelle für die Liste im Dialog */
function sourceLabel(camera: PrinterCamera, haCameras: HaCamera[]) {
  if (camera.entityId) {
    const found = haCameras.find(
      (h) => h.entityId === camera.entityId && h.connectionId === camera.haConnectionId,
    );
    return `Home Assistant: ${found ? `${found.deviceName ?? ''} ${found.name}`.trim() : camera.entityId}`;
  }
  return camera.streamUrl ?? '';
}

/** Kameras eines Druckers verwalten: hinzufügen, ändern, sortieren, löschen */
export function CameraDialog({ printer, onClose }: { printer: Printer; onClose: () => void }) {
  const { data: cameras = [] } = useCameras(printer.id);
  const { data: haList } = useHaCameras(true);
  const { save, remove, order } = useCameraSave(printer.id);
  const [editing, setEditing] = useState<PrinterCamera | 'new' | null>(null);
  const haCameras = haList?.cameras ?? [];

  const move = (index: number, by: -1 | 1) => {
    const ids = cameras.map((c) => c.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    order.mutate(ids);
  };

  return (
    <Modal title={`Kameras – ${printer.name}`} onClose={onClose} wide>
      {editing ? (
        <CameraForm
          printer={printer}
          camera={editing === 'new' ? undefined : editing}
          haCameras={haCameras}
          haErrors={haList?.errors ?? []}
          save={save}
          onDone={() => setEditing(null)}
        />
      ) : (
        <div className="space-y-3">
          {cameras.length === 0 ? (
            <p className="text-sm text-muted">
              Noch keine Kamera. Kameras kommen aus Home Assistant (z.B. die Kamera des
              Bambu-Druckers oder Webcams der Moonraker-Integration) oder direkt als MJPEG-Adresse,
              etwa von Crowsnest bei Klipper.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)] rounded-lg border border-line">
              {cameras.map((c, i) => (
                <li
                  key={c.id}
                  className="flex items-center gap-2 px-3 py-2"
                  aria-label={`Kamera ${c.name}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {c.name}
                      {i === 0 && cameras.length > 1 && (
                        <span className="ml-2 text-xs font-normal text-muted">(groß)</span>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted">{sourceLabel(c, haCameras)}</div>
                  </div>
                  <Button
                    variant="ghost"
                    className="!p-1.5"
                    aria-label={`${c.name} nach oben`}
                    disabled={i === 0 || order.isPending}
                    onClick={() => move(i, -1)}
                  >
                    <ChevronUp size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    className="!p-1.5"
                    aria-label={`${c.name} nach unten`}
                    disabled={i === cameras.length - 1 || order.isPending}
                    onClick={() => move(i, 1)}
                  >
                    <ChevronDown size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    className="!p-1.5"
                    aria-label={`${c.name} bearbeiten`}
                    onClick={() => setEditing(c)}
                  >
                    <Pencil size={16} />
                  </Button>
                  <Button
                    variant="danger"
                    className="!p-1.5"
                    aria-label={`${c.name} löschen`}
                    disabled={remove.isPending}
                    onClick={() => confirm(`Kamera „${c.name}“ entfernen?`) && remove.mutate(c.id)}
                  >
                    <Trash2 size={16} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <ErrorText error={remove.error ?? order.error} />
          <div className="flex justify-between gap-2">
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus size={16} /> Kamera hinzufügen
            </Button>
            <Button onClick={onClose}>Fertig</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

const haKey = (c: { connectionId: number; entityId: string }) => `${c.connectionId}|${c.entityId}`;

function CameraForm({
  printer,
  camera,
  haCameras,
  haErrors,
  save,
  onDone,
}: {
  printer: Printer;
  camera?: PrinterCamera;
  haCameras: HaCamera[];
  haErrors: string[];
  save: ReturnType<typeof useCameraSave>['save'];
  onDone: () => void;
}) {
  const { data: ha } = useHaStatus();
  const hasHa = (ha?.connections.length ?? 0) > 0;
  const [source, setSource] = useState<'ha' | 'url'>(
    camera ? (camera.entityId ? 'ha' : 'url') : hasHa ? 'ha' : 'url',
  );
  const [name, setName] = useState(camera?.name ?? '');
  const [haChoice, setHaChoice] = useState(
    camera?.entityId && camera.haConnectionId
      ? haKey({ connectionId: camera.haConnectionId, entityId: camera.entityId })
      : '',
  );
  const [streamUrl, setStreamUrl] = useState(camera?.streamUrl ?? '');
  const [snapshotUrl, setSnapshotUrl] = useState(camera?.snapshotUrl ?? '');
  const [rotation, setRotation] = useState<number>(camera?.rotation ?? 0);

  // Kameras des verknüpften Geräts (oder gleichnamigen Geräts) zuerst
  const own = (c: HaCamera) =>
    (!!printer.haDeviceId && c.deviceId === printer.haDeviceId) ||
    c.deviceName?.toLowerCase() === printer.name.toLowerCase();
  const sorted = [...haCameras].sort((a, b) => Number(own(b)) - Number(own(a)));
  const several = new Set(haCameras.map((c) => c.location)).size > 1;
  const label = (c: HaCamera) =>
    [
      c.deviceName && !c.name.startsWith(c.deviceName) ? `${c.deviceName} – ${c.name}` : c.name,
      several ? ` (${c.location})` : '',
      c.available ? '' : ' – nicht verfügbar',
    ].join('');

  const submit = () => {
    const chosen = haCameras.find((c) => haKey(c) === haChoice);
    const [connectionId, entityId] = haChoice.split('|');
    const body: PrinterCameraInput =
      source === 'ha'
        ? {
            name,
            haConnectionId: chosen?.connectionId ?? (connectionId ? Number(connectionId) : null),
            entityId: chosen?.entityId ?? entityId ?? null,
          }
        : { name, entityId: null, streamUrl, snapshotUrl };
    save.mutate({ id: camera?.id, ...body, rotation }, { onSuccess: onDone });
  };

  return (
    <form
      aria-label={camera ? `${camera.name} bearbeiten` : 'Neue Kamera'}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label="Quelle">
        <Select value={source} onChange={(e) => setSource(e.target.value as 'ha' | 'url')}>
          <option value="ha">Kamera aus Home Assistant</option>
          <option value="url">Direkte Stream-Adresse (MJPEG)</option>
        </Select>
      </Field>

      {source === 'ha' ? (
        <>
          <Field label="Kamera">
            <Select
              value={haChoice}
              onChange={(e) => {
                setHaChoice(e.target.value);
                const chosen = haCameras.find((c) => haKey(c) === e.target.value);
                if (chosen && !name.trim()) setName(chosen.name);
              }}
            >
              <option value="">Bitte wählen…</option>
              {sorted.map((c) => (
                <option key={haKey(c)} value={haKey(c)}>
                  {label(c)}
                </option>
              ))}
              {haChoice && !haCameras.some((c) => haKey(c) === haChoice) && (
                <option value={haChoice}>Bisherige Kamera (gerade nicht gefunden)</option>
              )}
            </Select>
          </Field>
          {!hasHa && (
            <p className="text-xs text-muted">
              Dafür zuerst in den Einstellungen Home Assistant verbinden.
            </p>
          )}
          {haErrors.map((e) => (
            <p key={e} className="text-xs text-red-600">
              {e}
            </p>
          ))}
        </>
      ) : (
        <>
          <Field label="Stream-Adresse">
            <TextInput
              value={streamUrl}
              onChange={(e) => setStreamUrl(e.target.value)}
              placeholder="http://192.168.1.30/webcam/?action=stream"
              inputMode="url"
            />
          </Field>
          <Field label="Standbild-Adresse (optional)">
            <TextInput
              value={snapshotUrl}
              onChange={(e) => setSnapshotUrl(e.target.value)}
              placeholder="bei Crowsnest automatisch (?action=snapshot)"
              inputMode="url"
            />
          </Field>
          <p className="text-xs text-muted">
            Der Server holt das Bild ab – die Kamera muss also vom Server aus erreichbar sein.
            Zugangsdaten gehen als <code>http://name:passwort@…</code>; das Passwort bleibt auf dem
            Server.
          </p>
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <TextInput
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z.B. Düse, Bett, Raum"
          />
        </Field>
        <Field label="Drehung">
          <Select value={rotation} onChange={(e) => setRotation(Number(e.target.value))}>
            {CAMERA_ROTATIONS.map((r) => (
              <option key={r} value={r}>
                {r === 0 ? 'Keine' : `${r}°`}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <ErrorText error={save.error} />
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Zurück</Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          Speichern
        </Button>
      </div>
    </form>
  );
}
