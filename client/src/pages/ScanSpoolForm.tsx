import { KNOWN_MANUFACTURERS, type FilamentSpool } from '@3dapp/shared';
import { CheckCircle2, Minus, Plus, ScanLine, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useBarcodeLookup, useList, useSettings, useSpoolBatch } from '../api';
import { StorageSelect } from './Storage';
import {
  Button,
  ColorDot,
  ErrorText,
  Field,
  Modal,
  Select,
  TextInput,
  cx,
  grams,
} from '../components/ui';
import { clientLog, errorInfo } from '../clientLog';
import type { ScanResult } from './ScanDialog';

interface Form {
  typeId: string;
  manufacturer: string;
  colorName: string;
  colorHex: string;
  finishId: string;
  diameter: string;
  weightTotalG: string;
  price: string;
  location: string;
  storageLocationId: number | null;
  barcode: string;
  count: number;
  remember: boolean;
}

type Source = 'product' | 'label';

const str = (v: number | string | null | undefined) =>
  v === null || v === undefined ? '' : String(v);
const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));

function Recognized({ source }: { source?: Source }) {
  if (!source) return null;
  return (
    <span
      className={cx(
        'rounded px-1.5 py-px text-[10px] font-semibold',
        source === 'label'
          ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
          : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
      )}
    >
      {source === 'label' ? 'erkannt' : 'gemerkt'}
    </span>
  );
}

/** Spule(n) aus einem Scan-Ergebnis anlegen: vorausgefüllt aus gemerkter Sorte oder Etikett. */
export function ScanSpoolForm({
  result,
  onClose,
  onRescan,
}: {
  result: ScanResult;
  onClose: () => void;
  onRescan: () => void;
}) {
  const barcode = result.barcode ?? null;
  const lookup = useBarcodeLookup(barcode);
  const { data: types = [] } = useList('filament-types');
  const { data: finishes = [] } = useList('finishes');
  const { data: spools = [] } = useList('spools');
  const { data: locations = [] } = useList('storage-locations');
  const storageOn = !!useSettings().data?.storageLocations;
  const batch = useSpoolBatch();
  const [form, setForm] = useState<Form | null>(null);
  const [sources, setSources] = useState<Partial<Record<keyof Form, Source>>>({});
  const [created, setCreated] = useState<FilamentSpool[] | null>(null);

  const ready = (!barcode || lookup.isFetched) && types.length > 0 && finishes.length > 0;
  const product = lookup.data?.product ?? null;

  // Formular einmalig vorbelegen: gemerkte Sorte hat Vorrang vor dem Etikett-Text
  useEffect(() => {
    if (!ready || form) return;
    const g = result.guess ?? {};
    const src: Partial<Record<keyof Form, Source>> = {};
    const from = <T,>(
      key: keyof Form,
      productValue: T | undefined | null,
      labelValue: T | undefined,
    ) => {
      if (productValue !== undefined && productValue !== null) {
        src[key] = 'product';
        return productValue;
      }
      if (labelValue !== undefined) src[key] = 'label';
      return labelValue;
    };
    const typeFromLabel = types.find((t) => t.name === g.typeName)?.id;
    const finishFromLabel = finishes.find((f) => f.name === g.finishName)?.id;
    setForm({
      typeId: str(from('typeId', product?.typeId, typeFromLabel)),
      manufacturer: str(from('manufacturer', product?.manufacturer, g.manufacturer)),
      colorName: str(from('colorName', product?.colorName, g.colorName)),
      colorHex: str(from('colorHex', product?.colorHex, g.colorHex)) || '#cccccc',
      finishId: str(from('finishId', product?.finishId, finishFromLabel)) || str(finishes[0]?.id),
      diameter: str(from('diameter', product?.diameter, g.diameter)) || '1.75',
      weightTotalG: str(from('weightTotalG', product?.weightTotalG, g.weightG)) || '1000',
      price: str(from('price', product?.price, undefined)),
      location: '',
      storageLocationId: null,
      barcode: barcode ?? '',
      count: 1,
      // Allgemeine Hersteller-QR-Codes würden sonst alle Sorten des Herstellers vermischen
      remember: !result.generic,
    });
    setSources(src);
  }, [ready, form, product, result.guess, result.generic, types, finishes, barcode]);

  const manufacturers = useMemo(
    () => [...new Set([...spools.map((s) => s.manufacturer), ...KNOWN_MANUFACTURERS])].sort(),
    [spools],
  );

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setSources((s) => ({ ...s, [key]: undefined }));
  };

  const missing = form
    ? [
        !form.typeId && 'Filamenttyp',
        !form.manufacturer.trim() && 'Hersteller',
        !form.colorName.trim() && 'Farbe',
      ].filter((m): m is string => !!m)
    : [];
  const [showMissing, setShowMissing] = useState(false);

  const submit = () => {
    if (!form) return;
    if (missing.length) {
      // Nicht still blockieren, sondern sagen, was fehlt
      setShowMissing(true);
      clientLog('scan-save-blocked', { missing });
      return;
    }
    clientLog('scan-save', { count: form.count, barcode: !!form.barcode.trim() });
    const today = new Date().toISOString().slice(0, 10);
    batch.mutate(
      {
        count: form.count,
        rememberBarcode: form.remember && !!form.barcode.trim(),
        spool: {
          typeId: Number(form.typeId),
          manufacturer: form.manufacturer.trim(),
          colorName: form.colorName.trim(),
          colorHex: form.colorHex,
          finishId: form.finishId ? Number(form.finishId) : null,
          diameter: num(form.diameter) ?? 1.75,
          weightTotalG: num(form.weightTotalG) ?? 1000,
          price: num(form.price),
          purchaseDate: today,
          location: form.location.trim() || null,
          storageLocationId: storageOn ? form.storageLocationId : null,
          haTrayEntity: null,
          barcode: form.barcode.trim() || null,
          notes: null,
        },
      },
      {
        onSuccess: setCreated,
        onError: (e) => clientLog('scan-error', { stage: 'save', ...errorInfo(e) }),
      },
    );
  };

  if (created) {
    const first = created[0];
    return (
      <Modal
        title="Gespeichert"
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>Fertig</Button>
            <Button variant="primary" onClick={onRescan}>
              <ScanLine size={16} /> Nächste scannen
            </Button>
          </>
        }
      >
        <div className="flex flex-col items-center gap-3 py-4 text-center" role="status">
          <CheckCircle2 size={40} className="text-emerald-500" />
          <p className="font-semibold">
            {created.length} {created.length === 1 ? 'Spule' : 'Spulen'} angelegt
          </p>
          <p className="flex items-center gap-2 text-sm text-muted">
            <ColorDot color={first.colorHex} /> {first.manufacturer} {first.colorName} ·{' '}
            {grams(first.weightTotalG)}
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Spule aus Scan anlegen"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onRescan}>Neu scannen</Button>
          <Button variant="primary" onClick={submit} disabled={!form || batch.isPending}>
            {form && form.count > 1 ? `${form.count} Spulen anlegen` : 'Spule anlegen'}
          </Button>
        </>
      }
    >
      {!form ? (
        <p className="py-6 text-center text-sm text-muted" role="status">
          Suche Barcode…
        </p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Banner
            barcode={barcode}
            product={!!product}
            lookup={lookup.data}
            fromLabel={!!result.guess}
            generic={!!result.generic}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Filamenttyp *" badge={<Recognized source={sources.typeId} />}>
              <Select value={form.typeId} onChange={(e) => set('typeId', e.target.value)}>
                <option value="">– bitte wählen –</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Hersteller *" badge={<Recognized source={sources.manufacturer} />}>
              <TextInput
                list="scan-manufacturers"
                value={form.manufacturer}
                onChange={(e) => set('manufacturer', e.target.value)}
              />
              <datalist id="scan-manufacturers">
                {manufacturers.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Field>
            {/* Farbwähler außerhalb des Labels, damit „Farbe“ zum Textfeld gehört */}
            <div className="flex items-end gap-2">
              <input
                type="color"
                aria-label="Farbton"
                value={form.colorHex}
                onChange={(e) => set('colorHex', e.target.value)}
                className="h-[38px] w-12 shrink-0 cursor-pointer rounded-lg border border-line bg-surface-2 p-1"
              />
              <Field
                label="Farbe *"
                className="flex-1"
                badge={<Recognized source={sources.colorName} />}
              >
                <TextInput
                  value={form.colorName}
                  onChange={(e) => set('colorName', e.target.value)}
                />
              </Field>
            </div>
            <Field label="Art / Finish" badge={<Recognized source={sources.finishId} />}>
              <Select value={form.finishId} onChange={(e) => set('finishId', e.target.value)}>
                {finishes.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Gewicht netto (g)" badge={<Recognized source={sources.weightTotalG} />}>
              <TextInput
                inputMode="decimal"
                value={form.weightTotalG}
                onChange={(e) => set('weightTotalG', e.target.value)}
              />
            </Field>
            <Field label="Durchmesser (mm)" badge={<Recognized source={sources.diameter} />}>
              <TextInput
                inputMode="decimal"
                value={form.diameter}
                onChange={(e) => set('diameter', e.target.value)}
              />
            </Field>
            <Field label="Preis pro Spule (€)" badge={<Recognized source={sources.price} />}>
              <TextInput
                inputMode="decimal"
                value={form.price}
                onChange={(e) => set('price', e.target.value)}
              />
            </Field>
            {storageOn ? (
              <Field label="Lagerplatz">
                <StorageSelect
                  locations={locations}
                  value={form.storageLocationId}
                  onChange={(id) => set('storageLocationId', id)}
                />
              </Field>
            ) : (
              <Field label="Lagerort">
                <TextInput
                  placeholder="z.B. Regal oben"
                  value={form.location}
                  onChange={(e) => set('location', e.target.value)}
                />
              </Field>
            )}
            <Field label="Barcode">
              <TextInput
                inputMode="numeric"
                value={form.barcode}
                onChange={(e) => set('barcode', e.target.value)}
              />
            </Field>
            <Field label="Anzahl Spulen">
              <div className="flex items-center gap-2">
                <Button
                  aria-label="Eine weniger"
                  onClick={() => set('count', Math.max(1, form.count - 1))}
                  disabled={form.count <= 1}
                >
                  <Minus size={16} />
                </Button>
                <span className="w-8 text-center font-semibold tabular-nums" aria-live="polite">
                  {form.count}
                </span>
                <Button
                  aria-label="Eine mehr"
                  onClick={() => set('count', Math.min(50, form.count + 1))}
                >
                  <Plus size={16} />
                </Button>
              </div>
            </Field>
          </div>

          {form.barcode.trim() && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--color-accent)]"
                checked={form.remember}
                onChange={(e) => set('remember', e.target.checked)}
              />
              Sorte zu diesem Barcode merken (nächster Scan ist vorausgefüllt)
            </label>
          )}

          {result.text && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer">Erkannter Text anzeigen</summary>
              <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-surface-2 p-3 whitespace-pre-wrap">
                {result.text.trim()}
              </pre>
            </details>
          )}
          {showMissing && missing.length > 0 && (
            <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">
              Bitte noch ausfüllen: <strong>{missing.join(', ')}</strong>
            </p>
          )}
          <ErrorText error={batch.error} />
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  );
}

function Banner({
  barcode,
  product,
  lookup,
  fromLabel,
  generic,
}: {
  barcode: string | null;
  product: boolean;
  lookup?: { spoolCount: number; remainingG: number };
  fromLabel: boolean;
  generic: boolean;
}) {
  if (generic) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
        Dieser QR-Code enthält nur die Hersteller-Webseite ({barcode}) und ist bei allen Sorten
        gleich. Für automatisches Vorausfüllen besser den <strong>Strichcode</strong> scannen.
      </div>
    );
  }
  if (product) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
        <strong>Bekannte Sorte.</strong> Alles ist vorausgefüllt
        {lookup && lookup.spoolCount > 0 && (
          <>
            {' '}
            – du hast bereits {lookup.spoolCount} {lookup.spoolCount === 1 ? 'Spule' : 'Spulen'} (
            {grams(lookup.remainingG)})
          </>
        )}
        .
      </div>
    );
  }
  return (
    <div className="flex gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm">
      <Sparkles size={16} className="mt-0.5 shrink-0 text-sky-600 dark:text-sky-300" />
      <span>
        {fromLabel ? 'Aus dem Etikett erkannt – bitte kurz prüfen. ' : ''}
        {barcode
          ? `Neuer Barcode ${barcode}: einmal ausfüllen, beim nächsten Scan ist alles vorausgefüllt.`
          : 'Kein Barcode gefunden – du kannst ihn unten noch eintragen.'}
      </span>
    </div>
  );
}
