import {
  MAINTENANCE_KIND_LABELS,
  MAINTENANCE_KINDS,
  MAINTENANCE_LEVEL_LABELS,
  describeRemaining,
  isoDate,
  partLabel,
  taskStatus,
  templateForModel,
  type MaintenanceLevel,
  type MaintenanceTask,
  type MaintenanceTemplateItem,
  type Printer,
  type SparePart,
  type TaskStatus,
} from '@3dapp/shared';
import { CheckCheck, History, Pencil, Plus, Undo2, Wrench } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, useList, useMaintenance, usePrinterLive, useSettings } from '../api';
import { EntityForm, type FieldDef } from './EntityForm';
import {
  Badge,
  Button,
  ErrorText,
  Field,
  Modal,
  NumberInput,
  TextArea,
  TextInput,
  cx,
  dateDe,
} from './ui';

const hoursText = (h: number) => `${h.toLocaleString('de-DE', { maximumFractionDigits: 1 })} h`;

export const LEVEL_TEXT: Record<MaintenanceLevel, string> = {
  ok: 'text-emerald-600 dark:text-emerald-400',
  soon: 'text-amber-600 dark:text-amber-400',
  due: 'text-red-600',
};

const LEVEL_BAR: Record<MaintenanceLevel, string> = {
  ok: 'bg-emerald-500',
  soon: 'bg-amber-500',
  due: 'bg-red-500',
};

/** Betriebsstunden: live aus Home Assistant, sonst der gespeicherte Stand */
export function usePrinterHours(printer: Printer) {
  const { data } = usePrinterLive(printer.id);
  const live = data?.status === 'ok' ? data.live.totalHours : null;
  return {
    hours: live ?? printer.operatingHours,
    fromHa: !!printer.haDeviceId && (live !== null || !!printer.operatingHoursAt),
  };
}

/** Benötigtes Teil eines Punkts mit Lagerstand */
export function PartStock({ task, part }: { task: MaintenanceTask; part: SparePart | undefined }) {
  if (!part) return null;
  const missing = Math.max(0, task.partQty - part.stockQty);
  return (
    <span className="text-xs text-muted">
      {task.partQty > 1 ? `${task.partQty} × ` : ''}
      {partLabel(part)} ·{' '}
      <span className={cx('tabular-nums', missing > 0 && 'font-medium text-red-600')}>
        {part.stockQty} auf Lager{missing > 0 && `, ${missing} fehlt`}
      </span>
    </span>
  );
}

function ProgressBar({ status }: { status: TaskStatus }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        className={cx('h-full rounded-full', LEVEL_BAR[status.level])}
        style={{ width: `${Math.min(100, Math.round(status.progress * 100))}%` }}
      />
    </div>
  );
}

function taskFields(parts: SparePart[], warnHours: number, modelId: number | null): FieldDef[] {
  // Teile, die zum Modell des Druckers passen, zuerst
  const fits = (p: SparePart) => modelId !== null && p.modelIds.includes(modelId);
  const mixed = parts.some(fits) && !parts.every(fits);
  const sorted = [...parts].sort(
    (a, b) =>
      Number(fits(b)) - Number(fits(a)) ||
      partLabel(a).localeCompare(partLabel(b), 'de', { numeric: true }),
  );
  return [
    { key: 'name', label: 'Wartungspunkt', required: true, wide: true },
    {
      key: 'kind',
      label: 'Art',
      type: 'select',
      required: true,
      options: MAINTENANCE_KINDS.map((k) => ({ value: k, label: MAINTENANCE_KIND_LABELS[k] })),
    },
    { key: 'intervalHours', label: 'Intervall (Betriebsstunden)', type: 'number' },
    { key: 'intervalMonths', label: 'Intervall (Monate)', type: 'number', step: 'any' },
    {
      key: 'currentHours',
      label: 'Aktueller Stand (h)',
      type: 'number',
      step: 'any',
      placeholder: '0',
    },
    { key: 'lastDoneAt', label: 'Zuletzt erledigt', type: 'date' },
    {
      key: 'partId',
      label: 'Benötigtes Ersatzteil',
      type: 'select',
      options: sorted.map((p) => ({
        value: p.id,
        label: `${partLabel(p)}${p.manufacturer ? ` (${p.manufacturer})` : ''}${mixed && fits(p) ? ' ✓ passt' : ''}`,
      })),
    },
    { key: 'partQty', label: 'Stück', type: 'number' },
    {
      key: 'warnHours',
      label: 'Vorwarnung (h)',
      type: 'number',
      placeholder: `Standard: ${warnHours}`,
    },
    { key: 'notes', label: 'Notizen', type: 'textarea' },
  ];
}

/** Wartungsplan eines Druckers in seiner Karte */
export function PrinterMaintenance({ printer }: { printer: Printer }) {
  const { data: settings } = useSettings();
  const on = !!settings?.maintenance;
  const { data: allTasks = [] } = useList('maintenance-tasks', on);
  const { data: parts = [] } = useList('spare-parts', on);
  const { hours, fromHa } = usePrinterHours(printer);
  const [editing, setEditing] = useState<MaintenanceTask | 'new' | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [editHours, setEditHours] = useState<number | null | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);
  const maintenance = useMaintenance(printer.id, logOpen);
  const qc = useQueryClient();

  if (!settings?.maintenance) return null;
  const defaults = {
    warnHours: settings.maintenanceWarnHours,
    warnDays: settings.maintenanceWarnDays,
  };
  const tasks = allTasks.filter((t) => t.printerId === printer.id);
  const now = new Date();
  const status = (t: MaintenanceTask) => taskStatus(t, hours, now, defaults);
  const template = templateForModel(printer.model);

  return (
    <section className="mt-4 border-t border-line pt-4" aria-label={`Wartung ${printer.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Wrench size={15} /> Wartung
        </h3>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted">Betriebsstunden</span>
          {editHours !== undefined ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (editHours === null) return;
                maintenance.hours.mutate(editHours, { onSuccess: () => setEditHours(undefined) });
              }}
            >
              <NumberInput
                aria-label="Betriebsstunden"
                className="!w-24 !py-1"
                value={editHours}
                onChange={setEditHours}
                min={0}
                autoFocus
              />
              <Button type="submit" variant="primary" className="!px-2 !py-1">
                OK
              </Button>
            </form>
          ) : (
            <>
              <span className="font-semibold tabular-nums" data-testid="operating-hours">
                {hoursText(hours)}
              </span>
              {fromHa ? (
                <Badge>aus Home Assistant</Badge>
              ) : (
                <Button
                  variant="ghost"
                  className="!p-1"
                  aria-label="Betriebsstunden ändern"
                  title="Betriebsstunden ändern"
                  onClick={() => setEditHours(printer.operatingHours)}
                >
                  <Pencil size={14} />
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      <ErrorText error={maintenance.hours.error} />

      {tasks.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          Noch keine Wartungspunkte.{' '}
          {template && 'Für dieses Modell gibt es eine Vorlage mit den typischen Verschleißteilen.'}
        </p>
      ) : (
        <ul className="mt-3 space-y-3" aria-label="Wartungspunkte">
          {tasks.map((t) => {
            const s = status(t);
            return (
              <li key={t.id} className="text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{t.name}</div>
                    <PartStock task={t} part={parts.find((p) => p.id === t.partId)} />
                  </div>
                  <div className="flex shrink-0 items-start gap-1">
                    <div className="text-right">
                      <div className={cx('text-xs font-medium', LEVEL_TEXT[s.level])}>
                        {MAINTENANCE_LEVEL_LABELS[s.level]}
                      </div>
                      <div className="text-xs text-muted tabular-nums">{describeRemaining(s)}</div>
                    </div>
                    <Button
                      variant="ghost"
                      className="!p-1"
                      aria-label={`${t.name} bearbeiten`}
                      title="Bearbeiten"
                      onClick={() => setEditing(t)}
                    >
                      <Pencil size={14} />
                    </Button>
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <ProgressBar status={s} />
                  <span className="shrink-0 text-xs text-muted tabular-nums">
                    {t.intervalHours
                      ? `${hoursText(s.usedHours)} / ${hoursText(t.intervalHours)}`
                      : s.dueDate && `bis ${dateDe(s.dueDate)}`}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {message && <p className="mt-2 text-sm text-muted">{message}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {tasks.length > 0 && (
          <Button variant="primary" onClick={() => setDoneOpen(true)}>
            <CheckCheck size={16} /> Wartung erledigt
          </Button>
        )}
        <Button onClick={() => setEditing('new')}>
          <Plus size={16} /> Punkt
        </Button>
        {template && tasks.length === 0 && (
          <Button onClick={() => setTemplateOpen(true)}>Vorlage übernehmen</Button>
        )}
        <Button variant="ghost" onClick={() => setLogOpen((o) => !o)} aria-expanded={logOpen}>
          <History size={16} /> Protokoll
        </Button>
      </div>

      {logOpen && <MaintenanceLog printerId={printer.id} />}

      {editing && (
        <EntityForm
          resource="maintenance-tasks"
          title={editing === 'new' ? 'Neuer Wartungspunkt' : editing.name}
          fields={taskFields(parts, defaults.warnHours, printer.modelId)}
          initial={
            editing === 'new'
              ? undefined
              : ({ ...editing, currentHours: status(editing).usedHours } as MaintenanceTask)
          }
          defaults={{ kind: 'replace', partQty: 1, lastDoneAt: isoDate(now), currentHours: 0 }}
          onSave={
            editing === 'new'
              ? (data) =>
                  api
                    .post('/maintenance-tasks', { ...data, printerId: printer.id })
                    .then(() => qc.invalidateQueries({ queryKey: ['maintenance-tasks'] }))
              : undefined
          }
          extra={
            editing !== 'new' && (
              <p className="text-xs text-muted">
                Löschen entfernt nur den Punkt, das Ersatzteil bleibt im Lager.
              </p>
            )
          }
          onClose={() => setEditing(null)}
        />
      )}
      {doneOpen && (
        <DoneDialog
          printer={printer}
          tasks={tasks}
          status={status}
          parts={parts}
          onClose={() => setDoneOpen(false)}
          onDone={setMessage}
        />
      )}
      {templateOpen && template && (
        <TemplateDialog
          printerId={printer.id}
          items={template}
          onClose={() => setTemplateOpen(false)}
        />
      )}
    </section>
  );
}

function DoneDialog({
  printer,
  tasks,
  status,
  parts,
  onClose,
  onDone,
}: {
  printer: Printer;
  tasks: MaintenanceTask[];
  status: (t: MaintenanceTask) => TaskStatus;
  parts: SparePart[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { done } = useMaintenance(printer.id);
  // Fällige und bald fällige Punkte sind vorausgewählt
  const [selected, setSelected] = useState(
    () => new Set(tasks.filter((t) => status(t).level !== 'ok').map((t) => t.id)),
  );
  const [bookParts, setBookParts] = useState(true);
  const [doneAt, setDoneAt] = useState(isoDate(new Date()));
  const [note, setNote] = useState('');
  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = () =>
    done.mutate(
      { taskIds: [...selected], bookParts, note, doneAt },
      {
        onSuccess: (result) => {
          const booked = result.entry.items.reduce((n, i) => n + i.booked, 0);
          onDone(
            `Wartung gespeichert, ${result.entry.items.length} Zähler zurückgesetzt` +
              (booked ? `, ${booked} Teil${booked === 1 ? '' : 'e'} abgebucht` : '') +
              (result.missing.length
                ? `. Nicht genug auf Lager: ${result.missing.map((m) => m.name).join(', ')}`
                : '') +
              '.',
          );
          onClose();
        },
      },
    );

  return (
    <Modal
      title="Wartung erledigt"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={submit} disabled={!selected.size || done.isPending}>
            Zähler zurücksetzen
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">
        Die gewählten Punkte zählen ab jetzt wieder von 0 ({printer.name}).
      </p>
      <ul className="space-y-2" aria-label="Erledigte Punkte">
        {tasks.map((t) => {
          const s = status(t);
          return (
            <li key={t.id}>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
                  checked={selected.has(t.id)}
                  onChange={() => toggle(t.id)}
                />
                <span className="min-w-0">
                  <span className="block">
                    {t.name}{' '}
                    <span className={cx('text-xs', LEVEL_TEXT[s.level])}>
                      {MAINTENANCE_LEVEL_LABELS[s.level]}
                    </span>
                  </span>
                  <PartStock task={t} part={parts.find((p) => p.id === t.partId)} />
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <label className="mt-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[var(--color-accent)]"
          checked={bookParts}
          onChange={(e) => setBookParts(e.target.checked)}
        />
        Getauschte Teile vom Lager abbuchen
      </label>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Erledigt am">
          <TextInput type="date" value={doneAt} onChange={(e) => setDoneAt(e.target.value)} />
        </Field>
        <Field label="Notiz" className="sm:col-span-2">
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <ErrorText error={done.error} />
    </Modal>
  );
}

function TemplateDialog({
  printerId,
  items,
  onClose,
}: {
  printerId: number;
  items: MaintenanceTemplateItem[];
  onClose: () => void;
}) {
  const { template } = useMaintenance(printerId);
  // Vorausgewählt sind die Punkte, für die Bambu ein festes Intervall nennt
  const [rows, setRows] = useState(() =>
    items.map((item) => ({ ...item, use: !!(item.intervalHours || item.intervalMonths) })),
  );
  const chosen = rows.filter((r) => r.use);
  const incomplete = chosen.filter((r) => !r.intervalHours && !r.intervalMonths);
  const set = (i: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((list) => list.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Modal
      title="Vorlage übernehmen"
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button
            variant="primary"
            disabled={!chosen.length || incomplete.length > 0 || template.isPending}
            onClick={() =>
              template.mutate(
                chosen.map(({ use: _use, ...item }) => item),
                { onSuccess: onClose },
              )
            }
          >
            {chosen.length} {chosen.length === 1 ? 'Punkt' : 'Punkte'} übernehmen
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">
        Wartung der Bambu Lab P1-Serie laut Bambu-Wiki. Feste Intervalle nennt Bambu nur in Monaten;
        die übrigen Punkte richten sich nach Rollen Filament oder dem Zustand – dafür selbst ein
        Intervall in Stunden oder Monaten eintragen. Benötigte Teile landen mit Link zum Bambu-Shop
        unter „Ersatzteile“.
      </p>
      <ul className="space-y-3" aria-label="Vorlage">
        {rows.map((r, i) => (
          <li
            key={r.name}
            className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem]"
          >
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
                checked={r.use}
                onChange={(e) => set(i, { use: e.target.checked })}
              />
              <span className="min-w-0">
                <span className="block">{r.name}</span>
                <span className="block text-xs text-muted">
                  {MAINTENANCE_KIND_LABELS[r.kind]}
                  {r.part && ` · Teil: ${r.part.name}`}
                </span>
                {r.hint && <span className="block text-xs text-muted italic">{r.hint}</span>}
              </span>
            </label>
            <NumberInput
              aria-label={`${r.name} Intervall Stunden`}
              placeholder="Stunden"
              value={r.intervalHours}
              onChange={(v) => set(i, { intervalHours: v })}
              min={0}
              disabled={!r.use}
            />
            <NumberInput
              aria-label={`${r.name} Intervall Monate`}
              placeholder="Monate"
              value={r.intervalMonths}
              onChange={(v) => set(i, { intervalMonths: v })}
              min={0}
              disabled={!r.use}
            />
          </li>
        ))}
      </ul>
      {incomplete.length > 0 && (
        <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">
          Noch ohne Intervall: {incomplete.map((r) => r.name).join(', ')}
        </p>
      )}
      <ErrorText error={template.error} />
    </Modal>
  );
}

function MaintenanceLog({ printerId }: { printerId: number }) {
  const { log, undo } = useMaintenance(printerId, true);
  const entries = log.data ?? [];
  if (log.isLoading) return null;
  if (!entries.length)
    return <p className="mt-3 text-sm text-muted">Noch keine Wartung eingetragen.</p>;
  return (
    <ul className="mt-3 space-y-2" aria-label="Wartungsprotokoll">
      {entries.map((e, i) => (
        <li key={e.id} className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium">
                {dateDe(e.doneAt)}{' '}
                <span className="text-xs font-normal text-muted tabular-nums">
                  bei {hoursText(e.printerHours)}
                </span>
              </div>
              <div className="text-xs text-muted">
                {e.items
                  .map((item) =>
                    item.booked ? `${item.name} (${item.booked} abgebucht)` : item.name,
                  )
                  .join(', ')}
              </div>
              {e.note && <div className="mt-1 text-xs">{e.note}</div>}
            </div>
            {i === 0 && (
              <Button
                variant="ghost"
                className="!p-1"
                aria-label="Wartung rückgängig"
                title="Rückgängig"
                disabled={undo.isPending}
                onClick={() => confirm('Diese Wartung rückgängig machen?') && undo.mutate(e.id)}
              >
                <Undo2 size={14} />
              </Button>
            )}
          </div>
        </li>
      ))}
      <ErrorText error={undo.error} />
    </ul>
  );
}
