import {
  DOCUMENT_KIND_LABELS,
  SMALL_BUSINESS_NOTE,
  calcDocumentTotals,
  type CompanyProfile,
  type DocumentKind,
  type ProjectDocument,
  type ProjectWithDetails,
} from '@3dapp/shared';
import { FileDown, FilePlus2, Plus, Receipt, Trash2, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useCompany, useDocuments, useList, useNextDocumentNumber } from '../api';
import { appUrl } from '../base';
import { Button, ErrorText, Field, TextArea, TextInput, cx, dateDe, euro } from './ui';

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const num = (v: string) => Number(v.replace(',', '.'));
const str = (n: number) => String(n).replace('.', ',');

const INTRO: Record<DocumentKind, string> = {
  offer: 'Gerne biete ich Folgendes an:',
  invoice: 'Für meine Leistungen erlaube ich mir zu verrechnen:',
};

/** Enter in einem Eingabefeld soll nicht das Projekt-Formular absenden */
const noEnter = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault();
};

type Editor = { kind: DocumentKind; from?: ProjectDocument };

/** Angebote und Rechnungen eines Projekts erstellen (PDF) */
export function DocumentsTab({ project }: { project: ProjectWithDetails }) {
  const { data: company } = useCompany();
  const { list, remove } = useDocuments(project.id);
  const [editor, setEditor] = useState<Editor | null>(null);
  const docs = list.data ?? [];
  const ready = !!company?.name && !!company.address;

  if (editor && company)
    return (
      <DocumentForm
        project={project}
        company={company}
        editor={editor}
        onDone={() => setEditor(null)}
      />
    );

  return (
    <div className="space-y-4" onKeyDown={noEnter}>
      {company && !ready && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          Trage zuerst unter{' '}
          <Link to="/einstellungen" className="font-medium underline">
            Einstellungen
          </Link>{' '}
          deine Firmendaten (Name und Adresse, optional Logo) ein.
        </p>
      )}
      {docs.length === 0 ? (
        <p className="text-sm text-muted">Noch keine Angebote oder Rechnungen.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)] rounded-lg border border-line">
          {docs.map((d) => {
            const label = `${DOCUMENT_KIND_LABELS[d.kind]} ${d.number}`;
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                <Receipt
                  size={18}
                  className={cx('shrink-0', d.kind === 'invoice' ? 'text-accent' : 'text-muted')}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{label}</div>
                  <div className="text-xs text-muted">
                    {dateDe(d.date)} · {euro(d.gross)}
                  </div>
                </div>
                <div className="flex gap-1">
                  <a
                    href={appUrl(d.filePath)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-accent hover:bg-surface-2"
                  >
                    <FileDown size={16} /> PDF
                  </a>
                  {d.kind === 'offer' && ready && (
                    <Button
                      variant="ghost"
                      onClick={() => setEditor({ kind: 'invoice', from: d })}
                      title="Aus diesem Angebot eine Rechnung erstellen"
                    >
                      Als Rechnung
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="!p-1.5"
                    aria-label={`${label} löschen`}
                    onClick={() =>
                      confirm(
                        `${label} löschen?` +
                          (d.kind === 'invoice'
                            ? ' Der Eintrag unter „Rechnungen“ wird mitgelöscht.'
                            : ''),
                      ) && remove.mutate(d.id)
                    }
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ErrorText error={list.error ?? remove.error} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setEditor({ kind: 'offer' })} disabled={!ready}>
          <FilePlus2 size={16} /> Angebot erstellen
        </Button>
        <Button variant="primary" onClick={() => setEditor({ kind: 'invoice' })} disabled={!ready}>
          <FilePlus2 size={16} /> Rechnung erstellen
        </Button>
      </div>
    </div>
  );
}

interface ItemDraft {
  description: string;
  quantity: string;
  unitPrice: string;
}

function DocumentForm({
  project,
  company,
  editor: { kind, from },
  onDone,
}: {
  project: ProjectWithDetails;
  company: CompanyProfile;
  editor: Editor;
  onDone: () => void;
}) {
  const { create } = useDocuments(project.id);
  const { data: customers = [] } = useList('customers');
  const next = useNextDocumentNumber(kind).data?.number;
  const customer = customers.find((c) => c.id === project.customerId);
  const label = DOCUMENT_KIND_LABELS[kind];

  const [number, setNumber] = useState('');
  const [date, setDate] = useState(today);
  const [serviceDate, setServiceDate] = useState(today);
  const [dueDate, setDueDate] = useState(() =>
    addDays(today(), kind === 'invoice' ? company.paymentDays : company.offerValidDays),
  );
  const [recipient, setRecipient] = useState<string | null>(from?.recipient ?? null);
  const [intro, setIntro] = useState(INTRO[kind]);
  const [notes, setNotes] = useState(from?.notes ?? '');
  const [items, setItems] = useState<ItemDraft[]>(() =>
    from
      ? from.items.map((i) => ({
          description: i.description,
          quantity: str(i.quantity),
          unitPrice: str(i.unitPrice),
        }))
      : [{ description: project.title, quantity: '1', unitPrice: str(project.price ?? 0) }],
  );

  // Empfänger aus dem Kunden, sobald die Kundenliste geladen ist (bis von Hand geändert)
  const recipientText =
    recipient ??
    (customer
      ? [customer.company, customer.name, customer.address].filter(Boolean).join('\n')
      : '');

  const parsed = items.map((i) => ({
    description: i.description.trim(),
    quantity: num(i.quantity),
    unitPrice: num(i.unitPrice),
  }));
  const totals = calcDocumentTotals(
    parsed.filter((i) => i.description && Number.isFinite(i.quantity * i.unitPrice)),
    company.smallBusiness,
    company.vatRate,
  );
  const setItem = (index: number, patch: Partial<ItemDraft>) =>
    setItems((list) => list.map((i, n) => (n === index ? { ...i, ...patch } : i)));

  const submit = () =>
    create.mutate(
      {
        kind,
        number: number.trim() || undefined,
        date,
        serviceDate: kind === 'invoice' ? serviceDate : null,
        dueDate: dueDate || null,
        recipient: recipientText,
        intro,
        notes,
        items: parsed,
      },
      { onSuccess: onDone },
    );

  return (
    <div className="space-y-4" onKeyDown={noEnter} aria-label={`${label} erstellen`} role="group">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">
          {label} erstellen{from && ` aus Angebot ${from.number}`}
        </h3>
        <Button variant="ghost" className="!p-1.5" aria-label="Abbrechen" onClick={onDone}>
          <X size={18} />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`${label}snummer`}>
          <TextInput
            value={number}
            placeholder={next ? `${next} (automatisch)` : 'automatisch'}
            onChange={(e) => setNumber(e.target.value)}
          />
        </Field>
        <Field label="Datum">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {kind === 'invoice' && (
          <Field label="Leistungsdatum">
            <TextInput
              type="date"
              value={serviceDate}
              onChange={(e) => setServiceDate(e.target.value)}
            />
          </Field>
        )}
        <Field label={kind === 'invoice' ? 'Zahlbar bis' : 'Gültig bis'}>
          <TextInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
        <Field label="Empfänger" className="sm:col-span-2">
          <TextArea
            rows={4}
            value={recipientText}
            placeholder={'Name\nStraße 1\n1234 Ort'}
            onChange={(e) => setRecipient(e.target.value)}
          />
        </Field>
        <Field label="Einleitung" className="sm:col-span-2">
          <TextInput value={intro} onChange={(e) => setIntro(e.target.value)} />
        </Field>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium text-muted">
          Positionen {company.smallBusiness ? '' : '(Preise netto)'}
        </div>
        <div className="mb-1 hidden grid-cols-[1fr_5rem_7rem_6rem_2rem] gap-2 px-2 text-xs text-muted sm:grid">
          <span>Beschreibung</span>
          <span>Menge</span>
          <span>Einzelpreis</span>
          <span className="text-right">Gesamt</span>
        </div>
        <ul className="space-y-2">
          {items.map((item, i) => {
            const total = num(item.quantity) * num(item.unitPrice);
            return (
              <li
                key={i}
                className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-line p-2 sm:grid-cols-[1fr_5rem_7rem_6rem_2rem] sm:items-center"
              >
                <TextInput
                  aria-label={`Position ${i + 1} Beschreibung`}
                  value={item.description}
                  placeholder="Beschreibung"
                  onChange={(e) => setItem(i, { description: e.target.value })}
                />
                <div className="col-span-2 grid grid-cols-3 gap-2 sm:contents">
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted sm:hidden">Menge</span>
                    <TextInput
                      aria-label={`Position ${i + 1} Menge`}
                      inputMode="decimal"
                      value={item.quantity}
                      onChange={(e) => setItem(i, { quantity: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted sm:hidden">Einzelpreis</span>
                    <TextInput
                      aria-label={`Position ${i + 1} Einzelpreis`}
                      inputMode="decimal"
                      value={item.unitPrice}
                      onChange={(e) => setItem(i, { unitPrice: e.target.value })}
                    />
                  </label>
                  <span className="self-end pb-2 text-right text-sm tabular-nums sm:self-center sm:pb-0">
                    {Number.isFinite(total) ? euro(total) : '–'}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  className="!p-1.5 max-sm:col-start-2 max-sm:row-start-1"
                  aria-label={`Position ${i + 1} entfernen`}
                  disabled={items.length === 1}
                  onClick={() => setItems((list) => list.filter((_, n) => n !== i))}
                >
                  <Trash2 size={15} />
                </Button>
              </li>
            );
          })}
        </ul>
        <Button
          variant="ghost"
          className="mt-2"
          onClick={() =>
            setItems((list) => [...list, { description: '', quantity: '1', unitPrice: '0' }])
          }
        >
          <Plus size={16} /> Position
        </Button>
      </div>

      <div className="ml-auto max-w-xs space-y-1 text-sm">
        {!company.smallBusiness && (
          <>
            <Row label="Summe netto" value={euro(totals.net)} />
            <Row label={`zzgl. ${str(company.vatRate)} % USt.`} value={euro(totals.vat)} />
          </>
        )}
        <Row label="Gesamtbetrag" value={euro(totals.gross)} strong />
      </div>
      {company.smallBusiness && <p className="text-sm text-muted">{SMALL_BUSINESS_NOTE}</p>}

      <Field label="Schlusstext (optional)">
        <TextArea
          rows={2}
          value={notes}
          placeholder="z.B. Danke für den Auftrag!"
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      <ErrorText error={create.error} />
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={submit} disabled={create.isPending}>
          {create.isPending ? 'Erstelle PDF…' : `${label} erstellen`}
        </Button>
        <Button onClick={onDone}>Abbrechen</Button>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cx('flex justify-between gap-4', strong && 'text-base font-semibold')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
