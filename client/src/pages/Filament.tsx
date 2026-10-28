import { LOW_FILAMENT_GRAMS, storagePaths, storageTree, type FilamentSpool } from '@3dapp/shared';
import { ChevronDown, Copy, Minus, Pencil, Plus, ScanLine, Warehouse } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useConsume, useList, useSave, useSettings } from '../api';
import { EntityForm, type FieldDef } from '../components/EntityForm';
import { ScanDialog, type ScanResult } from './ScanDialog';
import { ScanSpoolForm } from './ScanSpoolForm';
import {
  Badge,
  Button,
  Card,
  ColorDot,
  Empty,
  ErrorText,
  Field,
  Modal,
  PageHeader,
  TextInput,
  cx,
  euro,
  grams,
} from '../components/ui';

interface Group {
  key: string;
  colorName: string;
  colorHex: string;
  finish: string;
  manufacturer: string;
  spools: FilamentSpool[];
  remaining: number;
}

export function FilamentPage() {
  const { data: spools = [], isLoading } = useList('spools');
  const { data: types = [] } = useList('filament-types');
  const { data: finishes = [] } = useList('finishes');
  const [typeFilter, setTypeFilter] = useState<number | null>(null);
  const [editing, setEditing] = useState<FilamentSpool | 'new' | null>(null);
  const [consuming, setConsuming] = useState<FilamentSpool | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [scan, setScan] = useState<'dialog' | ScanResult | null>(null);
  const { save } = useSave('spools');
  const { data: settings } = useSettings();
  const storageOn = !!settings?.storageLocations;
  const { data: locations = [] } = useList('storage-locations');
  const paths = useMemo(() => storagePaths(locations), [locations]);
  /** Anzeige an der Spule: Lagerplatz, sonst der alte Freitext */
  const placeOf = (s: FilamentSpool) =>
    storageOn && s.storageLocationId ? (paths.get(s.storageLocationId) ?? null) : s.location;

  const finishName = (id: number | null) => finishes.find((f) => f.id === id)?.name ?? 'Normal';

  // Typ → Gruppen aus Farbe + Finish + Hersteller
  const byType = useMemo(() => {
    return types
      .map((type) => {
        const ofType = spools.filter((s) => s.typeId === type.id);
        const groups = new Map<string, Group>();
        for (const s of ofType) {
          const finish = finishName(s.finishId);
          const key = `${type.id}|${s.colorName.toLowerCase()}|${finish}|${s.manufacturer.toLowerCase()}`;
          const g = groups.get(key) ?? {
            key,
            colorName: s.colorName,
            colorHex: s.colorHex,
            finish,
            manufacturer: s.manufacturer,
            spools: [],
            remaining: 0,
          };
          g.spools.push(s);
          g.remaining += s.weightRemainingG;
          groups.set(key, g);
        }
        return {
          type,
          total: ofType.reduce((sum, s) => sum + s.weightRemainingG, 0),
          count: ofType.length,
          groups: [...groups.values()].sort((a, b) => a.colorName.localeCompare(b.colorName, 'de')),
        };
      })
      .filter((t) => t.count > 0);
  }, [spools, types, finishes]);

  const fields: FieldDef[] = [
    {
      key: 'typeId',
      label: 'Filamenttyp',
      type: 'select',
      required: true,
      options: types.map((t) => ({ value: t.id, label: t.name })),
    },
    { key: 'manufacturer', label: 'Hersteller', required: true, placeholder: 'z.B. Bambu Lab' },
    { key: 'colorName', label: 'Farbe', required: true, placeholder: 'z.B. Schwarz' },
    { key: 'colorHex', label: 'Farbton', type: 'color' },
    {
      key: 'finishId',
      label: 'Art / Finish',
      type: 'select',
      options: finishes.map((f) => ({ value: f.id, label: f.name })),
    },
    { key: 'diameter', label: 'Durchmesser (mm)', type: 'number', step: '0.01' },
    { key: 'weightTotalG', label: 'Spulengewicht netto (g)', type: 'number' },
    { key: 'weightRemainingG', label: 'Restmenge (g)', type: 'number' },
    { key: 'price', label: 'Preis pro Spule (€)', type: 'number', step: '0.01' },
    { key: 'purchaseDate', label: 'Kaufdatum', type: 'date' },
    storageOn
      ? {
          key: 'storageLocationId',
          label: 'Lagerplatz',
          type: 'select',
          options: storageTree(locations).map((t) => ({ value: t.location.id, label: t.path })),
        }
      : { key: 'location', label: 'Lagerort', placeholder: 'z.B. AMS Slot 1, Regal oben' },
    { key: 'notes', label: 'Notizen', type: 'textarea' },
  ];

  const duplicate = (s: FilamentSpool) => {
    const { id: _id, createdAt: _c, ...rest } = s;
    save.mutate({ ...rest, weightRemainingG: s.weightTotalG });
  };

  const types0 = byType.map((t) => t.type);
  const shown = typeFilter ? byType.filter((t) => t.type.id === typeFilter) : byType;
  const totalAll = spools.reduce((sum, s) => sum + s.weightRemainingG, 0);

  return (
    <>
      <PageHeader
        title="Filament"
        subtitle={`${spools.length} Spulen · ${grams(totalAll)} auf Lager`}
        actions={
          <>
            {storageOn && (
              <Link
                to="/lager"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium transition hover:bg-surface-2"
              >
                <Warehouse size={16} /> Lager
              </Link>
            )}
            <Button onClick={() => setScan('dialog')}>
              <ScanLine size={16} /> Scannen
            </Button>
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus size={16} /> Spule
            </Button>
          </>
        }
      />

      {types0.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {[{ id: null, name: 'Alle' }, ...types0].map((t) => (
            <button
              key={t.id ?? 'all'}
              type="button"
              onClick={() => setTypeFilter(t.id)}
              className={cx(
                'rounded-full border px-3 py-1 text-sm font-medium',
                typeFilter === t.id
                  ? 'border-accent bg-accent text-white'
                  : 'border-line bg-surface text-muted hover:text-main',
              )}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {!isLoading && spools.length === 0 && (
        <Empty>Noch kein Filament erfasst. Lege deine erste Spule an.</Empty>
      )}

      <div className="space-y-5">
        {shown.map(({ type, total, count, groups }) => (
          <Card key={type.id} className="overflow-hidden">
            <header className="flex items-baseline justify-between gap-3 border-b border-line bg-surface-2 px-4 py-3">
              <div>
                <h2 className="text-lg font-semibold">{type.name}</h2>
                {type.description && <p className="text-xs text-muted">{type.description}</p>}
              </div>
              <div className="text-right">
                <div className="font-semibold tabular-nums">{grams(total)}</div>
                <div className="text-xs text-muted">
                  {count} {count === 1 ? 'Spule' : 'Spulen'}
                </div>
              </div>
            </header>
            <ul className="divide-y divide-[var(--border)]">
              {groups.map((g) => {
                const isOpen = open === g.key;
                const low = g.remaining < LOW_FILAMENT_GRAMS;
                return (
                  <li key={g.key}>
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : g.key)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2"
                    >
                      <ColorDot color={g.colorHex} size={22} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {g.colorName}
                          {g.finish !== 'Normal' && <Badge className="ml-2">{g.finish}</Badge>}
                        </div>
                        <div className="truncate text-xs text-muted">{g.manufacturer}</div>
                      </div>
                      <div className="text-right">
                        <div className={cx('font-semibold tabular-nums', low && 'text-red-600')}>
                          {grams(g.remaining)}
                        </div>
                        <div className="text-xs text-muted">
                          {g.spools.length} {g.spools.length === 1 ? 'Spule' : 'Spulen'}
                        </div>
                      </div>
                      <ChevronDown
                        size={18}
                        className={cx('shrink-0 text-muted transition', isOpen && 'rotate-180')}
                      />
                    </button>
                    {isOpen && (
                      <ul className="space-y-2 bg-surface-2 px-4 py-3">
                        {g.spools.map((s) => (
                          <SpoolRow
                            key={s.id}
                            spool={s}
                            place={placeOf(s)}
                            onEdit={() => setEditing(s)}
                            onConsume={() => setConsuming(s)}
                            onDuplicate={() => duplicate(s)}
                          />
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>

      {editing && (
        <EntityForm
          resource="spools"
          title={editing === 'new' ? 'Neue Spule' : `${editing.manufacturer} ${editing.colorName}`}
          fields={fields}
          initial={editing === 'new' ? undefined : editing}
          defaults={{
            typeId: types[0]?.id,
            colorHex: '#cccccc',
            diameter: 1.75,
            weightTotalG: 1000,
            finishId: finishes[0]?.id,
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {consuming && <ConsumeDialog spool={consuming} onClose={() => setConsuming(null)} />}
      {scan === 'dialog' && <ScanDialog onResult={setScan} onClose={() => setScan(null)} />}
      {scan && scan !== 'dialog' && (
        <ScanSpoolForm
          // Neuer Scan → neues Formular
          key={`${scan.barcode}|${scan.text}`}
          result={scan}
          onClose={() => setScan(null)}
          onRescan={() => setScan('dialog')}
        />
      )}
      <ErrorText error={save.error} />
    </>
  );
}

function SpoolRow({
  spool,
  place,
  onEdit,
  onConsume,
  onDuplicate,
}: {
  spool: FilamentSpool;
  place: string | null;
  onEdit: () => void;
  onConsume: () => void;
  onDuplicate: () => void;
}) {
  const pct = spool.weightTotalG
    ? Math.round((spool.weightRemainingG / spool.weightTotalG) * 100)
    : 0;
  return (
    <li className="rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium tabular-nums">
              {grams(spool.weightRemainingG)}{' '}
              <span className="text-muted">von {grams(spool.weightTotalG)}</span>
            </span>
            <span className="text-xs text-muted tabular-nums">{pct} %</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className={cx(
                'h-full rounded-full',
                spool.weightRemainingG < LOW_FILAMENT_GRAMS ? 'bg-red-500' : 'bg-accent',
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-muted">
            <span>Ø {spool.diameter.toLocaleString('de-DE')} mm</span>
            {spool.price !== null && <span>{euro(spool.price)}</span>}
            {place && <span>{place}</span>}
            {spool.haTrayEntity && (
              <span className="font-medium text-accent-strong dark:text-orange-300">
                {/_slot_(\d+)$/.exec(spool.haTrayEntity)
                  ? `Im AMS, Slot ${/_slot_(\d+)$/.exec(spool.haTrayEntity)![1]}`
                  : 'Am Drucker (externe Spule)'}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" title="Verbrauch abbuchen" onClick={onConsume}>
            <Minus size={16} />
          </Button>
          <Button variant="ghost" title="Gleiche Spule nochmal anlegen" onClick={onDuplicate}>
            <Copy size={16} />
          </Button>
          <Button variant="ghost" title="Bearbeiten" onClick={onEdit}>
            <Pencil size={16} />
          </Button>
        </div>
      </div>
    </li>
  );
}

function ConsumeDialog({ spool, onClose }: { spool: FilamentSpool; onClose: () => void }) {
  const consume = useConsume();
  const [value, setValue] = useState('');
  const g = Number(value.replace(',', '.'));
  const submit = () => g && consume.mutate({ id: spool.id, grams: g }, { onSuccess: onClose });
  return (
    <Modal
      title="Verbrauch abbuchen"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={submit} disabled={!g || consume.isPending}>
            Abbuchen
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-3"
      >
        <p className="flex items-center gap-2 text-sm">
          <ColorDot color={spool.colorHex} /> {spool.manufacturer} {spool.colorName} – noch{' '}
          {grams(spool.weightRemainingG)}
        </p>
        <Field label="Verbrauchte Menge (g) – negativ zum Zurückbuchen">
          <TextInput
            autoFocus
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="z.B. 120"
          />
        </Field>
        <ErrorText error={consume.error} />
      </form>
    </Modal>
  );
}
