import {
  PRINT_SPEEDS,
  PRINT_SPEED_LABELS,
  type AmsSlot,
  type FilamentSpool,
  type FilamentType,
  type Printer,
  type PrinterLive,
  type PrintState,
} from '@3dapp/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  Gauge,
  Lightbulb,
  LightbulbOff,
  PackagePlus,
  Pause,
  Play,
  Scissors,
  Square,
  Undo2,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  useAmsImport,
  useAmsLink,
  useBookings,
  useList,
  usePrintAdjust,
  usePrinterControl,
  usePrinterLive,
} from '../api';
import { Button, ColorDot, ErrorText, Modal, Select, cx, dateDe, grams } from './ui';

const STATE_STYLE: Record<PrintState, string> = {
  idle: 'bg-surface-2 text-muted',
  prepare: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  slicing: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  init: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  running: 'bg-accent-soft text-accent-strong dark:text-orange-300',
  pause: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  finish: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  failed: 'bg-red-500/10 text-red-600',
  offline: 'bg-surface-2 text-muted',
  unknown: 'bg-surface-2 text-muted',
};

const PRINTING: PrintState[] = ['prepare', 'init', 'running', 'pause'];

/** 83 → „1 h 23 min“ */
function duration(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

/** Endzeit: heute nur Uhrzeit, sonst mit Datum */
function clock(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${dateDe(iso)} ${time}`;
}

const temp = (now: number | null, target: number | null) =>
  now === null
    ? '–'
    : target
      ? `${Math.round(now)} / ${Math.round(target)} °C`
      : `${Math.round(now)} °C`;

export function StateBadge({ live }: { live: PrinterLive }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold',
        STATE_STYLE[live.state],
      )}
    >
      {live.stateLabel}
      {live.state === 'running' && live.progress !== null && ` · ${live.progress} %`}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-surface-2"
      role="progressbar"
      aria-valuenow={value}
    >
      <div
        className="h-full rounded-full bg-accent transition-all"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

/** Live-Status, Steuerung, AMS und automatische Abbuchungen eines Druckers */
export function PrinterLivePanel({ printer }: { printer: Printer }) {
  const { data, isLoading } = usePrinterLive(printer.id);

  if (isLoading || !data) return <Hint>Lade Live-Status…</Hint>;
  if (data.status === 'unconfigured')
    return (
      <Hint>
        Live-Status über Home Assistant:{' '}
        <Link to="/einstellungen" className="text-accent hover:underline">
          in den Einstellungen verbinden
        </Link>
        .
      </Hint>
    );
  if (data.status === 'unlinked')
    return <Hint>Für den Live-Status unter „Bearbeiten“ das Home-Assistant-Gerät wählen.</Hint>;
  if (data.status === 'error') return <p className="mt-4 text-sm text-red-600">{data.error}</p>;
  return <LiveDetails printer={printer} live={data.live} />;
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 rounded-lg border border-dashed border-line px-3 py-2 text-xs text-muted">
      {children}
    </div>
  );
}

function LiveDetails({ printer, live }: { printer: Printer; live: PrinterLive }) {
  const control = usePrinterControl(printer.id);
  const qc = useQueryClient();

  // Nach Druckende bucht der Server ab (er fragt HA alle 20 s): Bestand und Buchungen nachladen
  useEffect(() => {
    if (live.state !== 'finish' && live.state !== 'failed') return;
    const reload = () => {
      qc.invalidateQueries({ queryKey: ['bookings', printer.id] });
      qc.invalidateQueries({ queryKey: ['spools'] });
    };
    reload();
    const later = setTimeout(reload, 25_000);
    return () => clearTimeout(later);
  }, [live.state, printer.id, qc]);
  const printing = PRINTING.includes(live.state);
  const showJob =
    printing || ((live.state === 'finish' || live.state === 'failed') && live.taskName);
  const end = live.endTime && clock(live.endTime);

  return (
    <section className="mt-4 space-y-4 border-t border-line pt-4" aria-label="Live-Status">
      <div className="flex items-center justify-between gap-2">
        <StateBadge live={live} />
        {live.light !== null && (
          <Button
            variant="ghost"
            className="!px-2 !py-1"
            aria-label={live.light ? 'Licht ausschalten' : 'Licht einschalten'}
            title={live.light ? 'Licht ausschalten' : 'Licht einschalten'}
            disabled={control.isPending}
            onClick={() => control.mutate(live.light ? 'light_off' : 'light_on')}
          >
            {live.light ? (
              <Lightbulb size={16} className="text-amber-500" />
            ) : (
              <LightbulbOff size={16} />
            )}
          </Button>
        )}
      </div>

      {showJob && (
        <div className="flex gap-3">
          {live.coverVersion && (
            <img
              src={`/api/printers/${printer.id}/cover?v=${encodeURIComponent(live.coverVersion)}`}
              alt=""
              className="h-16 w-16 shrink-0 rounded-lg border border-line bg-surface-2 object-contain"
              onError={(e) => (e.currentTarget.style.display = 'none')}
            />
          )}
          <div className="min-w-0 flex-1 space-y-1.5 text-sm">
            <div className="truncate font-medium">{live.taskName ?? 'Druckauftrag'}</div>
            {live.progress !== null && <ProgressBar value={live.progress} />}
            <div className="flex flex-wrap gap-x-3 text-xs text-muted tabular-nums">
              {live.progress !== null && <span>{live.progress} %</span>}
              {live.totalLayers ? (
                <span>
                  Schicht {live.layer ?? 0} / {live.totalLayers}
                </span>
              ) : null}
              {printing && !!live.remainingMin && <span>noch {duration(live.remainingMin)}</span>}
              {printing && end && <span>fertig ca. {end}</span>}
              {live.weightG !== null && <span>{grams(live.weightG)}</span>}
            </div>
          </div>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-muted">Düsentemperatur</dt>
        <dd className="text-right tabular-nums">{temp(live.nozzleTemp, live.nozzleTarget)}</dd>
        <dt className="text-muted">Betttemperatur</dt>
        <dd className="text-right tabular-nums">{temp(live.bedTemp, live.bedTarget)}</dd>
      </dl>

      {(live.canPause || live.canResume || live.canStop) && (
        <div className="flex flex-wrap gap-2">
          {live.canPause && (
            <Button onClick={() => control.mutate('pause')} disabled={control.isPending}>
              <Pause size={15} /> Pause
            </Button>
          )}
          {live.canResume && (
            <Button onClick={() => control.mutate('resume')} disabled={control.isPending}>
              <Play size={15} /> Fortsetzen
            </Button>
          )}
          {live.canStop && (
            <Button
              variant="danger"
              disabled={control.isPending}
              onClick={() =>
                confirm(
                  `Druck „${live.taskName ?? ''}“ wirklich abbrechen? Das lässt sich nicht fortsetzen.`,
                ) && control.mutate('stop')
              }
            >
              <Square size={15} /> Abbrechen
            </Button>
          )}
        </div>
      )}
      <ErrorText error={control.error} />

      {printing && <PrintAdjust printer={printer} live={live} />}

      {live.ams.length > 0 && <AmsSlots printerId={printer.id} slots={live.ams} />}
      <Bookings printerId={printer.id} />
    </section>
  );
}

/** Geschwindigkeitsstufe umschalten und Teile überspringen – nur während eines Drucks */
function PrintAdjust({ printer, live }: { printer: Printer; live: PrinterLive }) {
  const { speed, skip } = usePrintAdjust(printer.id);
  const [skipping, setSkipping] = useState(false);
  const skippedCount = live.objects.filter((o) => o.skipped).length;

  return (
    <div className="space-y-3">
      {live.speed !== null && (
        <div>
          <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
            <Gauge size={13} /> Geschwindigkeit
          </h3>
          <div
            className="grid grid-cols-4 gap-1 rounded-lg bg-surface-2 p-1"
            role="group"
            aria-label="Geschwindigkeit"
          >
            {PRINT_SPEEDS.map((s) => {
              // Nach dem Klick sofort die gewählte Stufe zeigen, bis HA sie bestätigt
              const active = (speed.isPending ? speed.variables : live.speed) === s;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={active}
                  disabled={!live.canSetSpeed || speed.isPending}
                  onClick={() => !active && speed.mutate(s)}
                  className={cx(
                    'rounded-md px-1 py-1.5 text-xs font-medium transition disabled:opacity-60',
                    active ? 'bg-surface text-main shadow-sm' : 'text-muted hover:text-main',
                  )}
                >
                  {PRINT_SPEED_LABELS[s].label}
                  <span className="block text-[10px] font-normal tabular-nums">
                    {PRINT_SPEED_LABELS[s].percent} %
                  </span>
                </button>
              );
            })}
          </div>
          <ErrorText error={speed.error} />
        </div>
      )}

      {(live.canSkip || skippedCount > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {live.canSkip && (
            <Button onClick={() => setSkipping(true)}>
              <Scissors size={15} /> Teile überspringen
            </Button>
          )}
          {skippedCount > 0 && (
            <span className="text-xs text-muted">
              {skippedCount} von {live.objects.length} Teilen übersprungen
            </span>
          )}
        </div>
      )}
      {skipping && (
        <SkipDialog
          printer={printer}
          live={live}
          onClose={() => setSkipping(false)}
          onSkip={(ids) => skip.mutate(ids, { onSuccess: () => setSkipping(false) })}
          pending={skip.isPending}
          error={skip.error}
        />
      )}
    </div>
  );
}

function SkipDialog({
  printer,
  live,
  onClose,
  onSkip,
  pending,
  error,
}: {
  printer: Printer;
  live: PrinterLive;
  onClose: () => void;
  onSkip: (ids: string[]) => void;
  pending: boolean;
  error: unknown;
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const open = live.objects.filter((o) => !o.skipped);
  // Mindestens ein Teil muss weitergedruckt werden
  const tooMany = chosen.size >= open.length;
  const toggle = (id: string) =>
    setChosen((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Modal
      title="Teile überspringen"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button
            variant="danger"
            disabled={!chosen.size || tooMany || pending}
            onClick={() =>
              confirm(
                `${chosen.size} ${chosen.size === 1 ? 'Teil' : 'Teile'} nicht weiterdrucken? Das lässt sich nicht rückgängig machen.`,
              ) && onSkip([...chosen])
            }
          >
            <Scissors size={15} /> {chosen.size || ''} überspringen
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {live.plateVersion && (
          <img
            src={`/api/printers/${printer.id}/plate?v=${encodeURIComponent(live.plateVersion)}`}
            alt="Druckplatte mit den Teilen"
            className="mx-auto max-h-64 w-full rounded-lg border border-line bg-surface-2 object-contain"
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
        )}
        <p className="text-sm text-muted">
          Die gewählten Teile druckt der Drucker ab jetzt nicht mehr weiter, der Rest läuft normal.
        </p>
        <ul className="divide-y divide-[var(--border)] rounded-lg border border-line">
          {live.objects.map((o) => (
            <li key={o.id}>
              <label
                className={cx(
                  'flex items-center gap-3 px-3 py-2 text-sm',
                  o.skipped ? 'text-muted' : 'cursor-pointer',
                )}
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--color-accent)]"
                  disabled={o.skipped}
                  checked={o.skipped || chosen.has(o.id)}
                  onChange={() => toggle(o.id)}
                />
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                <span className="shrink-0 text-xs text-muted tabular-nums">
                  {o.skipped ? 'übersprungen' : `#${o.id}`}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {tooMany && chosen.size > 0 && (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Mindestens ein Teil muss weitergedruckt werden – für alle bitte den Druck abbrechen.
          </p>
        )}
        <ErrorText error={error} />
      </div>
    </Modal>
  );
}

function spoolLabel(s: FilamentSpool, types: FilamentType[]) {
  const type = types.find((t) => t.id === s.typeId)?.name ?? '';
  return `${s.manufacturer} ${type} ${s.colorName} · ${grams(s.weightRemainingG)}`;
}

function AmsSlots({ printerId, slots }: { printerId: number; slots: AmsSlot[] }) {
  const { data: spools = [] } = useList('spools');
  const { data: types = [] } = useList('filament-types');
  const link = useAmsLink();
  const importSpool = useAmsImport(printerId);

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">AMS</h3>
      <ul className="grid gap-2">
        {slots.map((slot) => {
          const linked = spools.find((s) => s.haTrayEntity === slot.entityId);
          // Passender Typ zuerst, dann der Rest
          const sorted = [...spools]
            .filter((s) => s.weightRemainingG > 0 || s.id === linked?.id)
            .sort((a, b) => {
              const match = (s: FilamentSpool) =>
                types.find((t) => t.id === s.typeId)?.name.toLowerCase() ===
                slot.type?.toLowerCase()
                  ? 0
                  : 1;
              return match(a) - match(b);
            });
          return (
            <li
              key={slot.entityId}
              className={cx(
                'rounded-lg border p-2.5 text-sm',
                slot.active ? 'border-accent bg-accent-soft/40' : 'border-line',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="w-9 shrink-0 text-xs font-semibold text-muted">{slot.label}</span>
                {slot.color ? (
                  <ColorDot color={slot.color} />
                ) : (
                  <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-dashed border-line" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {slot.empty ? (
                    <span className="text-muted">leer</span>
                  ) : (
                    (slot.name ?? slot.type ?? '?')
                  )}
                </span>
                {slot.remain !== null && (
                  <span className="shrink-0 text-xs text-muted tabular-nums">{slot.remain} %</span>
                )}
              </div>
              {!slot.empty && (
                <div className="mt-2 flex gap-2">
                  <Select
                    aria-label={`Spule in ${slot.label}`}
                    className="min-w-0 flex-1 !py-1.5 !text-xs"
                    value={linked?.id ?? ''}
                    disabled={link.isPending}
                    onChange={(e) =>
                      link.mutate({
                        entityId: slot.entityId,
                        spoolId: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  >
                    <option value="">Spule aus dem Bestand zuordnen…</option>
                    {sorted.map((s) => (
                      <option key={s.id} value={s.id}>
                        {spoolLabel(s, types)}
                      </option>
                    ))}
                  </Select>
                  {!linked && (
                    <Button
                      className="shrink-0 !px-2.5 !py-1.5 !text-xs"
                      title="Spule mit den Daten aus dem AMS im Bestand anlegen und hier zuordnen"
                      aria-label={`${slot.label} in Bestand übernehmen`}
                      disabled={importSpool.isPending}
                      onClick={() => importSpool.mutate(slot.entityId)}
                    >
                      <PackagePlus size={14} /> Übernehmen
                    </Button>
                  )}
                </div>
              )}
              {linked?.notes?.startsWith('Aus AMS') && linked.colorName && (
                <p className="mt-1.5 text-xs text-muted">
                  Im Bestand als „{linked.colorName}“ –{' '}
                  <Link to="/filament" className="text-accent hover:underline">
                    Farbname oder Preis anpassen
                  </Link>
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <ErrorText error={link.error ?? importSpool.error} />
      <p className="mt-2 text-xs text-muted">
        Nach jedem Druck bucht die App das Druckgewicht von der zugeordneten Spule ab.
      </p>
    </div>
  );
}

function Bookings({ printerId }: { printerId: number }) {
  const { list, undo } = useBookings(printerId);
  const { data: spools = [] } = useList('spools');
  const { data: types = [] } = useList('filament-types');
  const bookings = (list.data ?? []).slice(0, 5);
  if (!bookings.length) return null;

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
        Automatisch abgebucht
      </h3>
      <ul className="divide-y divide-[var(--border)] text-sm">
        {bookings.map((b) => {
          const spool = spools.find((s) => s.id === b.spoolId);
          return (
            <li key={b.id} className="flex items-center gap-2 py-1.5">
              {spool && <ColorDot color={spool.colorHex} size={12} />}
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium tabular-nums">
                  {b.estimated && '≈ '}
                  {grams(b.grams)}
                </span>{' '}
                <span className="text-muted">
                  {spool ? spoolLabel(spool, types).split(' · ')[0] : 'Spule gelöscht'}
                  {b.jobName && ` · ${b.jobName}`} · {dateDe(b.createdAt)}
                </span>
              </span>
              <Button
                variant="ghost"
                className="!p-1.5"
                title="Rückgängig (Gramm zurück auf die Spule)"
                aria-label={`Abbuchung ${grams(b.grams)} rückgängig machen`}
                disabled={undo.isPending}
                onClick={() => undo.mutate(b.id)}
              >
                <Undo2 size={15} />
              </Button>
            </li>
          );
        })}
      </ul>
      {bookings.some((b) => b.estimated) && (
        <p className="mt-1 text-xs text-muted">
          ≈ = geschätzt: mehrere Farben (nach Druckzeit aufgeteilt) oder abgebrochener Druck.
        </p>
      )}
    </div>
  );
}

/** Kurzfassung für die Übersicht */
export function PrinterLiveSummary({ printer }: { printer: Printer }) {
  const { data } = usePrinterLive(printer.id);
  if (data?.status !== 'ok') return null;
  const { live } = data;
  const printing = PRINTING.includes(live.state);
  return (
    <li className="space-y-1.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{printer.name}</span>
        <StateBadge live={live} />
      </div>
      {printing && (
        <>
          {live.progress !== null && <ProgressBar value={live.progress} />}
          <div className="flex justify-between gap-2 text-xs text-muted">
            <span className="truncate">{live.taskName}</span>
            {!!live.remainingMin && (
              <span className="shrink-0 tabular-nums">noch {duration(live.remainingMin)}</span>
            )}
          </div>
        </>
      )}
    </li>
  );
}
