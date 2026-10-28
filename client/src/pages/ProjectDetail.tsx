import {
  INVOICE_TYPES,
  INVOICE_TYPE_LABELS,
  MEMBER_ROLES,
  MEMBER_ROLE_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  calcPrinterHourly,
  calcProjectCosts,
  describeInvoice,
  parseInvoice,
  type ProjectCost,
  type ProjectFilament,
  type ProjectMember,
  type ProjectWithDetails,
} from '@3dapp/shared';
import { Camera, Check, FileText, Paperclip, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useInvoices, useList, useSave } from '../api';
import { clientLog, errorInfo } from '../clientLog';
import { FileLink } from '../components/FileViewer';
import { UnitSuggestions } from '../components/CostCategoriesCard';
import { DocumentsTab } from '../components/DocumentsTab';
import {
  Avatar,
  Button,
  Card,
  ColorDot,
  Empty,
  ErrorText,
  Field,
  Modal,
  NumberInput,
  Select,
  TextArea,
  TextInput,
  cx,
  dateDe,
  euro,
  grams,
} from '../components/ui';

const TABS = [
  'Allgemein',
  'Team',
  'Material',
  'Zusatzkosten',
  'Rechnungen',
  'Angebot & Rechnung',
] as const;
type Tab = (typeof TABS)[number];

type Draft = Omit<ProjectWithDetails, 'id' | 'createdAt' | 'updatedAt' | 'position' | 'invoices'>;

const emptyDraft = (): Draft => ({
  title: '',
  description: null,
  status: 'open',
  customerId: null,
  printerId: null,
  dueDate: null,
  priority: 'normal',
  price: null,
  printHours: null,
  markupPercent: 0,
  priceAuto: true,
  showVatId: true,
  notes: null,
  members: [],
  filaments: [],
  costs: [],
});

const numOrNull = (v: string) => (v === '' ? null : Number(v.replace(',', '.')));

export function ProjectDetail({
  project,
  onClose,
  onCreated,
}: {
  project?: ProjectWithDetails;
  onClose: () => void;
  /** Neues Projekt wurde zum ersten Mal gespeichert – Fenster bleibt offen und zeigt es an */
  onCreated?: (project: ProjectWithDetails) => void;
}) {
  const [tab, setTab] = useState<Tab>('Allgemein');
  const [draft, setDraft] = useState<Draft>(() =>
    project ? structuredClone(project) : emptyDraft(),
  );
  const { save, remove } = useSave('projects');
  const { data: spools = [] } = useList('spools');

  // Ungespeicherte Änderungen; nach dem Speichern kurz „Gespeichert“ anzeigen
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty(true);
    setSaved(false);
  };
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 4000);
    return () => clearTimeout(t);
  }, [saved]);
  const { data: printers = [] } = useList('printers');
  const costs = calcProjectCosts(draft, spools, printers);
  // Automatischer Verkaufspreis: Gesamtkosten plus Aufschlag (ohne Kosten bleibt er leer)
  const autoPrice = costs.total
    ? Math.round(costs.total * (1 + (draft.markupPercent || 0) / 100) * 100) / 100
    : null;
  useEffect(() => {
    if (draft.priceAuto && draft.price !== autoPrice) setDraft((d) => ({ ...d, price: autoPrice }));
  }, [draft.priceAuto, draft.price, autoPrice]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!draft.title.trim()) {
      setTab('Allgemein');
      return;
    }
    // Fenster bleibt offen, damit man gleich weiterarbeiten (z.B. ein Angebot erstellen) kann
    save.mutate({ ...draft, id: project?.id } as never, {
      onSuccess: (row) => {
        setDirty(false);
        setSaved(true);
        if (!project) onCreated?.(row as ProjectWithDetails);
      },
    });
  };

  const onDelete = () => {
    if (project && confirm(`Projekt „${project.title}“ wirklich löschen?`)) {
      remove.mutate(project.id, { onSuccess: onClose });
    }
  };

  return (
    <Modal
      wide
      title={project ? project.title : 'Neues Projekt'}
      onClose={onClose}
      footer={
        <>
          {project && (
            <Button variant="danger" className="mr-auto" onClick={onDelete}>
              <Trash2 size={16} /> <span className="max-sm:sr-only">Löschen</span>
            </Button>
          )}
          {saved && (
            <span
              className="mr-1 inline-flex items-center gap-1 self-center text-sm font-medium text-emerald-600 dark:text-emerald-400"
              role="status"
            >
              <Check size={16} /> <span className="max-sm:sr-only">Gespeichert</span>
            </span>
          )}
          <Button onClick={onClose}>{dirty ? 'Abbrechen' : 'Schließen'}</Button>
          <Button
            variant="primary"
            onClick={() => submit()}
            disabled={save.isPending || !draft.title.trim()}
          >
            {save.isPending ? 'Speichere…' : 'Speichern'}
          </Button>
        </>
      }
    >
      <div className="-mx-1 mb-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line px-1 [scrollbar-width:none]">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cx(
              '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium',
              tab === t
                ? 'border-accent text-accent'
                : 'border-transparent text-muted hover:text-main',
            )}
          >
            {t}
            {t === 'Team' && draft.members.length > 0 && ` (${draft.members.length})`}
            {t === 'Material' && draft.filaments.length > 0 && ` (${draft.filaments.length})`}
            {t === 'Zusatzkosten' && draft.costs.length > 0 && ` (${draft.costs.length})`}
            {t === 'Rechnungen' &&
              project &&
              project.invoices.length > 0 &&
              ` (${project.invoices.length})`}
          </button>
        ))}
      </div>

      <form onSubmit={submit}>
        {tab === 'Allgemein' && <GeneralTab draft={draft} set={set} costsTotal={costs.total} />}
        {tab === 'Team' && <TeamTab members={draft.members} onChange={(m) => set('members', m)} />}
        {tab === 'Material' && (
          <MaterialTab filaments={draft.filaments} onChange={(f) => set('filaments', f)} />
        )}
        {tab === 'Zusatzkosten' && (
          <CostsTab costs={draft.costs} onChange={(c) => set('costs', c)} />
        )}
        {tab === 'Rechnungen' &&
          (project ? (
            <InvoicesTab project={project} />
          ) : (
            <Empty>Rechnungen kannst du nach dem ersten Speichern hinzufügen.</Empty>
          ))}
        {tab === 'Angebot & Rechnung' &&
          (project ? (
            <DocumentsTab project={project} />
          ) : (
            <Empty>Angebote und Rechnungen kannst du nach dem ersten Speichern erstellen.</Empty>
          ))}
        <button type="submit" hidden />
      </form>

      <Card className="mt-5 grid grid-cols-2 gap-3 bg-surface-2 p-4 text-sm sm:grid-cols-5">
        <Stat label="Material" value={euro(costs.filament)} />
        <Stat label="Maschine" value={euro(costs.machine)} />
        <Stat label="Zusatzkosten" value={euro(costs.extras)} />
        <Stat label="Kosten gesamt" value={euro(costs.total)} strong />
        <Stat
          label="Gewinn"
          value={draft.price === null ? '–' : euro(draft.price - costs.total)}
          className={
            draft.price !== null && draft.price - costs.total < 0 ? 'text-red-600' : undefined
          }
        />
      </Card>
      <ErrorText error={save.error ?? remove.error} />
    </Modal>
  );
}

function Stat({
  label,
  value,
  strong,
  className,
}: {
  label: string;
  value: string;
  strong?: boolean;
  className?: string;
}) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className={cx('tabular-nums', strong ? 'font-semibold' : 'font-medium', className)}>
        {value}
      </div>
    </div>
  );
}

function GeneralTab({
  draft,
  set,
  costsTotal,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
  /** Gesamtkosten aus Material, Druckzeit und Zusatzkosten */
  costsTotal: number;
}) {
  const { data: customers = [] } = useList('customers');
  const { data: printers = [] } = useList('printers');
  const printer = printers.find((p) => p.id === draft.printerId);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Titel *" className="sm:col-span-2">
        <TextInput
          autoFocus
          required
          value={draft.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="z.B. Lampenschirm für Wohnzimmer"
        />
      </Field>
      <Field label="Beschreibung" className="sm:col-span-2">
        <TextArea
          value={draft.description ?? ''}
          onChange={(e) => set('description', e.target.value || null)}
        />
      </Field>
      <Field label="Status">
        <Select
          value={draft.status}
          onChange={(e) => set('status', e.target.value as Draft['status'])}
        >
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {PROJECT_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Priorität">
        <Select
          value={draft.priority}
          onChange={(e) => set('priority', e.target.value as Draft['priority'])}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Kunde">
        <Select
          value={draft.customerId ?? ''}
          onChange={(e) => set('customerId', numOrNull(e.target.value))}
        >
          <option value="">– kein Kunde (eigenes Projekt) –</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.company ? ` (${c.company})` : ''}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Drucker">
        <Select
          value={draft.printerId ?? ''}
          onChange={(e) => set('printerId', numOrNull(e.target.value))}
        >
          <option value="">– noch offen –</option>
          {printers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.model})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Fällig am">
        <TextInput
          type="date"
          value={draft.dueDate ?? ''}
          onChange={(e) => set('dueDate', e.target.value || null)}
        />
      </Field>
      <Field
        label={
          printer
            ? `Druckzeit (h) · ${euro(calcPrinterHourly(printer).total)}/h auf ${printer.name}`
            : 'Druckzeit (Stunden)'
        }
      >
        <TextInput
          type="number"
          step="0.25"
          min="0"
          inputMode="decimal"
          placeholder="z.B. 4,5"
          value={draft.printHours ?? ''}
          onChange={(e) => set('printHours', numOrNull(e.target.value))}
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <Field label="Verkaufspreis (€)">
          <NumberInput
            min={0}
            value={draft.price}
            onChange={(v) => {
              if (v === draft.price) return;
              // Selbst eingetragener Preis beendet den Automatikbetrieb
              set('price', v);
              if (draft.priceAuto) set('priceAuto', false);
            }}
          />
        </Field>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--color-accent)]"
            checked={draft.priceAuto}
            onChange={(e) => set('priceAuto', e.target.checked)}
          />
          {draft.priceAuto
            ? `Aus den Kosten: ${euro(costsTotal)}${draft.markupPercent ? ` + ${String(draft.markupPercent).replace('.', ',')} % Aufschlag` : ''}`
            : 'Aus den Kosten berechnen'}
        </label>
      </div>
      <Field label="Aufschlag / Marge (%)">
        <TextInput
          type="number"
          step="1"
          min="-100"
          inputMode="decimal"
          placeholder="z.B. 10"
          value={draft.markupPercent || ''}
          onChange={(e) => set('markupPercent', numOrNull(e.target.value) ?? 0)}
        />
      </Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[var(--color-accent)]"
          checked={draft.showVatId}
          onChange={(e) => set('showVatId', e.target.checked)}
        />
        UID-Nummer auf Angebot und Rechnung
      </label>
      <p className="-mt-2 text-xs text-muted sm:col-span-2">
        Aufschlag und UID-Nummer sind Vorschläge für neue Angebote und Rechnungen – dort lassen sie
        sich je Dokument ändern.
      </p>
      <Field label="Notizen" className="sm:col-span-2">
        <TextArea
          value={draft.notes ?? ''}
          onChange={(e) => set('notes', e.target.value || null)}
        />
      </Field>
    </div>
  );
}

function TeamTab({
  members,
  onChange,
}: {
  members: ProjectMember[];
  onChange: (m: ProjectMember[]) => void;
}) {
  const { data: persons = [] } = useList('persons');
  const available = persons.filter((p) => !members.some((m) => m.personId === p.id));

  if (persons.length === 0) {
    return <Empty>Lege zuerst unter „Team“ Personen an, um sie hier zuzuordnen.</Empty>;
  }
  return (
    <div className="space-y-3">
      {members.length === 0 && <p className="text-sm text-muted">Noch niemand zugeordnet.</p>}
      {members.map((m, i) => {
        const person = persons.find((p) => p.id === m.personId);
        return (
          <div key={m.personId} className="flex items-center gap-3">
            <Avatar name={person?.name ?? '?'} size={32} />
            <span className="flex-1 text-sm font-medium">{person?.name}</span>
            <Select
              className="!w-auto"
              value={m.role}
              onChange={(e) =>
                onChange(
                  members.map((x, j) =>
                    j === i ? { ...x, role: e.target.value as ProjectMember['role'] } : x,
                  ),
                )
              }
            >
              {MEMBER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {MEMBER_ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
            <Button
              variant="ghost"
              aria-label="Entfernen"
              onClick={() => onChange(members.filter((_, j) => j !== i))}
            >
              <Trash2 size={16} />
            </Button>
          </div>
        );
      })}
      {available.length > 0 && (
        <Select
          value=""
          onChange={(e) =>
            e.target.value &&
            onChange([...members, { personId: Number(e.target.value), role: 'team' }])
          }
        >
          <option value="">+ Person hinzufügen…</option>
          {available.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}

function MaterialTab({
  filaments,
  onChange,
}: {
  filaments: Omit<ProjectFilament, 'id'>[];
  onChange: (f: ProjectFilament[]) => void;
}) {
  const { data: spools = [] } = useList('spools');
  const { data: types = [] } = useList('filament-types');
  const { data: finishes = [] } = useList('finishes');
  const label = (id: number) => {
    const s = spools.find((x) => x.id === id);
    if (!s) return 'Unbekannte Spule';
    const type = types.find((t) => t.id === s.typeId)?.name ?? '';
    const finish = finishes.find((f) => f.id === s.finishId)?.name;
    return `${type} · ${s.manufacturer} ${s.colorName}${finish && finish !== 'Normal' ? ` (${finish})` : ''}`;
  };
  const update = (i: number, patch: Partial<ProjectFilament>) =>
    onChange(filaments.map((f, j) => (j === i ? { ...f, ...patch } : f)) as ProjectFilament[]);

  if (spools.length === 0) return <Empty>Lege zuerst unter „Filament“ deine Spulen an.</Empty>;

  return (
    <div className="space-y-3">
      {filaments.length === 0 && (
        <p className="text-sm text-muted">Noch kein Material zugeordnet.</p>
      )}
      {filaments.map((f, i) => {
        const spool = spools.find((s) => s.id === f.spoolId);
        return (
          <Card
            key={i}
            className="grid grid-cols-2 items-end gap-3 p-3 sm:grid-cols-[1fr_110px_110px_auto]"
          >
            <div className="col-span-2 flex min-w-0 items-center gap-2 text-sm sm:col-span-1">
              <ColorDot color={spool?.colorHex ?? '#ccc'} />
              <span className="truncate font-medium">{label(f.spoolId)}</span>
              {spool && (
                <span className="shrink-0 text-xs text-muted">
                  ({grams(spool.weightRemainingG)} übrig)
                </span>
              )}
            </div>
            <Field label="Geplant (g)">
              <NumberInput
                min={0}
                emptyValue={0}
                value={f.plannedGrams}
                onChange={(v) => update(i, { plannedGrams: v ?? 0 })}
              />
            </Field>
            <Field label="Verbraucht (g)">
              <NumberInput
                min={0}
                value={f.usedGrams}
                onChange={(v) => update(i, { usedGrams: v })}
              />
            </Field>
            <Button
              variant="ghost"
              aria-label="Entfernen"
              className="col-span-2 sm:col-span-1"
              onClick={() => onChange(filaments.filter((_, j) => j !== i) as ProjectFilament[])}
            >
              <Trash2 size={16} />
            </Button>
          </Card>
        );
      })}
      <Select
        value=""
        onChange={(e) =>
          e.target.value &&
          onChange([
            ...filaments,
            { spoolId: Number(e.target.value), plannedGrams: 0, usedGrams: null },
          ] as ProjectFilament[])
        }
      >
        <option value="">+ Filament hinzufügen…</option>
        {spools.map((s) => (
          <option key={s.id} value={s.id}>
            {label(s.id)} – {grams(s.weightRemainingG)}
          </option>
        ))}
      </Select>
      <p className="text-xs text-muted">
        Kosten werden anteilig aus dem Spulenpreis berechnet (verbraucht, sonst geplant). Den
        Bestand der Spule passt du unter „Filament“ an.
      </p>
    </div>
  );
}

function CostsTab({
  costs,
  onChange,
}: {
  costs: Omit<ProjectCost, 'id'>[];
  onChange: (c: ProjectCost[]) => void;
}) {
  const { data: categories = [] } = useList('cost-categories');
  const update = (i: number, patch: Partial<ProjectCost>) =>
    onChange(costs.map((c, j) => (j === i ? { ...c, ...patch } : c)) as ProjectCost[]);
  // Kategorie wählen übernimmt deren Einheit und Standardpreis als Vorschlag
  const fromCategory = (key: string) => {
    const cat = categories.find((c) => c.key === key);
    return {
      category: key,
      unit: cat?.unit ?? 'Stück',
      ...(cat?.defaultPrice != null ? { unitPrice: cat.defaultPrice } : {}),
    };
  };
  const name = (key: string) => categories.find((c) => c.key === key)?.name ?? key;

  return (
    <div className="space-y-3">
      <UnitSuggestions id="project-cost-units" />
      {costs.length === 0 && (
        <p className="text-sm text-muted">
          Extra-Teile und Leistungen wie Elektronik, Versand oder Nachbearbeitung hier erfassen. Die
          Kategorien mit Einheit und Standardpreis legst du unter „Einstellungen“ an.
        </p>
      )}
      {costs.map((c, i) => (
        <Card
          key={i}
          className="grid grid-cols-2 items-end gap-3 p-3 sm:grid-cols-[150px_1fr_70px_90px_95px_auto]"
          aria-label={`Zusatzkosten ${i + 1}`}
          role="group"
        >
          <Field label="Kategorie">
            <Select value={c.category} onChange={(e) => update(i, fromCategory(e.target.value))}>
              {categories.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.name}
                </option>
              ))}
              {/* Gelöschte Kategorie in alten Projekten trotzdem anzeigen */}
              {!categories.some((k) => k.key === c.category) && (
                <option value={c.category}>{name(c.category)}</option>
              )}
            </Select>
          </Field>
          <Field label="Beschreibung">
            <TextInput
              value={c.description}
              placeholder={name(c.category)}
              onChange={(e) => update(i, { description: e.target.value })}
            />
          </Field>
          <Field label="Menge">
            <NumberInput
              min={0}
              emptyValue={1}
              value={c.quantity}
              onChange={(v) => update(i, { quantity: v ?? 1 })}
            />
          </Field>
          <Field label="Einheit">
            <TextInput
              list="project-cost-units"
              value={c.unit}
              onChange={(e) => update(i, { unit: e.target.value })}
            />
          </Field>
          <Field label="Preis je Einheit €">
            <NumberInput
              min={0}
              emptyValue={0}
              value={c.unitPrice}
              onChange={(v) => update(i, { unitPrice: v ?? 0 })}
            />
          </Field>
          <Button
            variant="ghost"
            aria-label="Entfernen"
            onClick={() => onChange(costs.filter((_, j) => j !== i) as ProjectCost[])}
          >
            <Trash2 size={16} />
          </Button>
        </Card>
      ))}
      <Button
        onClick={() =>
          onChange([
            ...costs,
            {
              description: '',
              quantity: 1,
              unitPrice: 0,
              ...fromCategory(categories[0]?.key ?? 'other'),
            },
          ] as ProjectCost[])
        }
      >
        <Plus size={16} /> Position hinzufügen
      </Button>
      <p className="text-xs text-muted">
        Ohne Beschreibung steht auf Angebot und Rechnung der Name der Kategorie.
      </p>
    </div>
  );
}

type InvoiceForm = {
  type: string;
  date: string;
  number: string;
  amount: string;
  description: string;
};
type ReadState = { status: string; pct?: number } | { done: string[]; text: string } | null;

const today = () => new Date().toISOString().slice(0, 10);

function InvoicesTab({ project }: { project: ProjectWithDetails }) {
  const { add, remove } = useInvoices(project.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState<InvoiceForm>({
    type: 'incoming',
    date: today(),
    number: '',
    amount: '',
    description: '',
  });
  /** Von Hand bearbeitete Felder – die überschreibt die Erkennung nicht */
  const touched = useRef(new Set<keyof InvoiceForm>());
  const [read, setRead] = useState<ReadState>(null);
  const [readError, setReadError] = useState<string | null>(null);
  /** Nur das Ergebnis des zuletzt gewählten Dokuments übernehmen */
  const readId = useRef(0);
  const reading = !!read && 'status' in read;
  const recognized = read && 'done' in read ? read.done : [];

  const edit = (key: keyof InvoiceForm, value: string) => {
    touched.current.add(key);
    setForm((f) => ({ ...f, [key]: value }));
  };

  /** Rechnung lesen und leere (nicht von Hand ausgefüllte) Felder vorschlagen */
  const pickFile = async (picked: File | null) => {
    setFile(picked);
    setReadError(null);
    const id = ++readId.current;
    if (!picked) return setRead(null);
    const started = Date.now();
    setRead({ status: 'Lese Rechnung…' });
    try {
      const { readInvoiceText } = await import('../scan/invoice');
      const { text, source } = await readInvoiceText(picked, (status, pct) => {
        if (id === readId.current) setRead({ status, pct });
      });
      if (id !== readId.current) return;
      const guess = parseInvoice(text);
      const proposal: Partial<InvoiceForm> = {
        amount: guess.amount?.toFixed(2).replace('.', ','),
        date: guess.date,
        number: guess.number,
        description: describeInvoice(guess),
      };
      const done = (Object.keys(proposal) as (keyof InvoiceForm)[]).filter(
        (k) => proposal[k] && !touched.current.has(k),
      );
      setForm((f) => ({ ...f, ...Object.fromEntries(done.map((k) => [k, proposal[k]])) }));
      setRead({ done, text });
      clientLog('invoice-read', {
        source,
        type: picked.type,
        size: picked.size,
        chars: text.length,
        recognized: done,
        ms: Date.now() - started,
        items: guess.items,
        // Ganzer Text (gekürzt), damit sich Fehlerkennungen nachvollziehen lassen
        sample: text.slice(0, 6000),
      });
    } catch (e) {
      if (id !== readId.current) return;
      clientLog('invoice-read-error', errorInfo(e));
      setRead(null);
      setReadError(
        'Die Rechnung konnte nicht gelesen werden. Die Datei wird trotzdem angehängt – bitte Werte von Hand eintragen.',
      );
    }
  };

  const submit = () => {
    const data = new FormData();
    Object.entries(form).forEach(([k, v]) => data.append(k, v));
    if (file) data.append('file', file);
    add.mutate(data, {
      onSuccess: () => {
        setFile(null);
        setRead(null);
        touched.current.clear();
        readId.current++;
        setForm((f) => ({ ...f, date: today(), number: '', amount: '', description: '' }));
      },
    });
  };

  const badge = (key: keyof InvoiceForm) =>
    recognized.includes(key) ? (
      <span className="rounded bg-sky-500/15 px-1.5 py-px text-[10px] font-semibold text-sky-700 dark:text-sky-300">
        erkannt
      </span>
    ) : undefined;

  return (
    <div className="space-y-4">
      {project.invoices.length === 0 ? (
        <p className="text-sm text-muted">Noch keine Rechnungen.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)] rounded-lg border border-line">
          {project.invoices.map((inv) => (
            <li key={inv.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <FileText size={18} className="shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {inv.description || inv.number || INVOICE_TYPE_LABELS[inv.type]}
                </div>
                <div className="text-xs text-muted">
                  {dateDe(inv.date)} · {INVOICE_TYPE_LABELS[inv.type]}
                  {inv.number && ` · Nr. ${inv.number}`}
                </div>
              </div>
              <span className="font-medium tabular-nums">{euro(inv.amount)}</span>
              {inv.filePath && (
                <FileLink
                  path={inv.filePath}
                  name={inv.fileName ?? 'Rechnung'}
                  label="Datei ansehen"
                  className="text-accent hover:underline"
                  title={inv.fileName ?? ''}
                >
                  <Paperclip size={16} />
                </FileLink>
              )}
              <Button
                variant="ghost"
                aria-label="Rechnung löschen"
                onClick={() => confirm('Rechnung löschen?') && remove.mutate(inv.id)}
              >
                <Trash2 size={16} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Card className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">Rechnung hinzufügen</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Art">
            <Select value={form.type} onChange={(e) => edit('type', e.target.value)}>
              {INVOICE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {INVOICE_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Datum" badge={badge('date')}>
            <TextInput
              type="date"
              value={form.date}
              onChange={(e) => edit('date', e.target.value)}
            />
          </Field>
          <Field label="Betrag (€)" badge={badge('amount')}>
            <TextInput
              inputMode="decimal"
              placeholder="0,00"
              value={form.amount}
              onChange={(e) => edit('amount', e.target.value)}
            />
          </Field>
          <Field label="Rechnungsnummer" badge={badge('number')}>
            <TextInput value={form.number} onChange={(e) => edit('number', e.target.value)} />
          </Field>
          <Field label="Beschreibung" className="sm:col-span-2" badge={badge('description')}>
            <TextInput
              value={form.description}
              placeholder="z.B. LEDs von Amazon"
              onChange={(e) => edit('description', e.target.value)}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/*"
            hidden
            onChange={(e) => {
              void pickFile(e.target.files?.[0] ?? null);
              e.target.value = '';
            }}
          />
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              void pickFile(e.target.files?.[0] ?? null);
              e.target.value = '';
            }}
          />
          <Button onClick={() => fileRef.current?.click()}>
            <Paperclip size={16} /> PDF / Bild
          </Button>
          <Button onClick={() => cameraRef.current?.click()}>
            <Camera size={16} /> Foto aufnehmen
          </Button>
          {file && <span className="truncate text-sm text-muted">{file.name}</span>}
          <Button
            variant="primary"
            className="ml-auto"
            onClick={submit}
            disabled={add.isPending || reading}
          >
            Hinzufügen
          </Button>
        </div>
        {read && 'status' in read && (
          <div className="space-y-1.5" role="status">
            <p className="text-sm text-muted">{read.status}</p>
            {read.pct !== undefined && (
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${read.pct}%` }}
                />
              </div>
            )}
          </div>
        )}
        {read && 'done' in read && (
          <div className="space-y-1">
            <p className="text-sm text-muted">
              {read.done.length
                ? 'Aus der Rechnung erkannt – bitte kurz prüfen.'
                : 'Keine Angaben erkannt – bitte von Hand eintragen.'}
            </p>
            <details className="text-xs text-muted">
              <summary className="cursor-pointer">Erkannter Text</summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2">
                {read.text.trim() || '(kein Text)'}
              </pre>
            </details>
          </div>
        )}
        {!read && (
          <p className="text-xs text-muted">
            PDF oder Foto anhängen: Betrag, Datum, Nummer und Händler werden automatisch ausgelesen.
          </p>
        )}
        <ErrorText error={readError} />
        <ErrorText error={add.error ?? remove.error} />
      </Card>
    </div>
  );
}
