import { modelLabel, type PrinterModel } from '@3dapp/shared';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useList, useSave } from '../api';
import { Button, ErrorText, Select, TextInput, cx } from './ui';

const NEW = '__neu__';
const FREE = '__frei__';

/** Modell zu einem Text wie „Bambu Lab P1S“ (oder nur „P1S“) aus der Liste */
export function findModel(models: PrinterModel[], text: string | null | undefined) {
  const t = (text ?? '').trim().toLowerCase();
  if (!t) return undefined;
  return (
    models.find((m) => modelLabel(m).toLowerCase() === t) ??
    models.find((m) => m.name.toLowerCase() === t)
  );
}

/**
 * Hersteller auswählen: zuerst die mit Modellen, darunter die übrigen aus der Herstellerliste
 * (für ein neues Modell eines Herstellers, der bisher nur Filament hat)
 */
function MakerSelect({
  models,
  value,
  onChange,
  label,
}: {
  models: PrinterModel[];
  value: number | null;
  onChange: (id: number | null) => void;
  label: string;
}) {
  const { data: manufacturers = [] } = useList('manufacturers');
  const withModels = new Set(models.map((m) => m.manufacturerId));
  const others = manufacturers.filter((m) => !withModels.has(m.id));
  return (
    <Select
      aria-label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">– Hersteller –</option>
      {manufacturers
        .filter((m) => withModels.has(m.id))
        .map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      {others.length > 0 && (
        <optgroup label="Weitere Hersteller">
          {others.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </optgroup>
      )}
    </Select>
  );
}

/** Neues Modell direkt anlegen (landet in der Liste unter Einstellungen) */
function NewModel({
  manufacturerId,
  manufacturer,
  onCreated,
  onCancel,
}: {
  manufacturerId?: number;
  /** Hersteller, der noch nicht in der Liste steht: der Server legt ihn mit dem Modell an */
  manufacturer?: string;
  onCreated: (model: PrinterModel) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const { save } = useSave('printer-models');
  const create = () =>
    name.trim() &&
    save.mutate({ manufacturerId, manufacturer, name: name.trim() } as never, {
      onSuccess: (m) => onCreated(m as PrinterModel),
    });
  return (
    <div>
      <div className="flex gap-2">
        <TextInput
          autoFocus
          aria-label="Name des neuen Modells"
          placeholder="Name des Modells"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              create();
            }
          }}
        />
        <Button type="button" disabled={!name.trim() || save.isPending} onClick={create}>
          Anlegen
        </Button>
        <Button type="button" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
      <ErrorText error={save.error} />
    </div>
  );
}

/**
 * Druckermodell wählen: erst Hersteller, dann nur dessen Modelle. Für Drucker, die nicht in der
 * Liste stehen, bleibt ein freier Text möglich (modelId = null).
 */
export function PrinterModelSelect({
  modelId,
  text,
  onChange,
  autoFocus,
}: {
  modelId: number | null;
  text: string;
  onChange: (modelId: number | null, text: string) => void;
  autoFocus?: boolean;
}) {
  const { data: models = [], isLoading } = useList('printer-models');
  const current = models.find((m) => m.id === modelId);
  const [maker, setMaker] = useState<number | null>(null);
  const [mode, setMode] = useState<'list' | 'free' | 'new'>(() =>
    text && !modelId ? 'free' : 'list',
  );
  // Ein gewähltes Modell (auch von außen, z.B. aus dem HA-Gerät) bestimmt den Hersteller
  const makerId = current?.manufacturerId ?? maker;
  const ofMaker = models.filter((m) => m.manufacturerId === makerId);

  // Von außen gewähltes Modell (HA-Gerät) zeigt wieder die Liste
  if (mode === 'free' && !current)
    return (
      <div className="flex gap-2">
        <TextInput
          autoFocus={autoFocus}
          aria-label="Modell (freier Text)"
          value={text}
          placeholder="z.B. Voron 2.4"
          onChange={(e) => onChange(null, e.target.value)}
        />
        <Button type="button" onClick={() => setMode('list')}>
          Liste
        </Button>
      </div>
    );

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <MakerSelect
        models={models}
        label="Hersteller des Druckers"
        value={makerId}
        onChange={(id) => {
          setMaker(id);
          if (id !== current?.manufacturerId) onChange(null, '');
          if (id && !models.some((m) => m.manufacturerId === id)) setMode('new');
          else setMode('list');
        }}
      />
      {mode === 'new' && makerId ? (
        <div className="sm:col-span-2">
          <NewModel
            manufacturerId={makerId}
            onCreated={(m) => {
              setMode('list');
              onChange(m.id, modelLabel(m));
            }}
            onCancel={() => setMode('list')}
          />
        </div>
      ) : (
        <Select
          aria-label="Modell"
          autoFocus={autoFocus}
          disabled={isLoading}
          value={current?.id ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            if (v === NEW) setMode('new');
            else if (v === FREE) {
              setMode('free');
              onChange(null, text);
            } else {
              const m = models.find((x) => x.id === Number(v));
              onChange(m?.id ?? null, m ? modelLabel(m) : '');
            }
          }}
        >
          <option value="">{makerId ? '– Modell wählen –' : '– erst Hersteller –'}</option>
          {ofMaker.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
          {makerId && <option value={NEW}>＋ Neues Modell …</option>}
          <option value={FREE}>Nicht in der Liste (freier Text) …</option>
        </Select>
      )}
      {!current && text && mode === 'list' && (
        <p className="text-xs text-muted sm:col-span-2">Bisher: {text}</p>
      )}
    </div>
  );
}

/**
 * Mehrere Druckermodelle wählen (z.B. für ein Ersatzteil): Gewählte stehen als Chips oben, darunter
 * die Modelle eines Herstellers zum An- und Abwählen. Der Hersteller folgt dem des Teils
 * (makerName); für Teile von Drittanbietern lässt sich darunter ein anderer wählen.
 */
export function PrinterModelsSelect({
  value,
  onChange,
  makerName,
}: {
  value: number[];
  onChange: (ids: number[]) => void;
  makerName?: string;
}) {
  const { data: models = [] } = useList('printer-models');
  const { data: manufacturers = [] } = useList('manufacturers');
  const chosen = models.filter((m) => value.includes(m.id));
  const name = (makerName ?? '').trim();
  const partMaker = manufacturers.find((m) => m.name.toLowerCase() === name.toLowerCase());
  const partMakerHasModels = !!partMaker && models.some((m) => m.manufacturerId === partMaker.id);
  // Eigene Wahl gilt, bis sich der Hersteller des Teils ändert
  const [picked, setPicked] = useState<{ id: number | null; for: string } | null>(null);
  const own = picked?.for === name ? picked : null;
  const maker =
    own?.id ??
    (own ? null : partMakerHasModels ? partMaker.id : (chosen[0]?.manufacturerId ?? null));
  const [adding, setAdding] = useState<number | string | null>(null);
  const ofMaker = models.filter((m) => m.manufacturerId === maker);
  const toggle = (id: number) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  // Hersteller des Teils hat (noch) keine Modelle, z.B. gerade neu eingetragen
  const offerPartMaker = !!name && !partMakerHasModels && maker === null;

  return (
    <div className="space-y-2">
      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chosen.map((m) => (
            <span
              key={m.id}
              className="inline-flex items-center gap-1 rounded-full bg-accent-soft py-0.5 pr-1 pl-2.5 text-sm"
            >
              {modelLabel(m)}
              <button
                type="button"
                aria-label={`${modelLabel(m)} entfernen`}
                className="rounded-full p-0.5 hover:bg-accent/20"
                onClick={() => toggle(m.id)}
              >
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      {maker && (
        <div className="flex flex-wrap gap-1.5" aria-label="Modelle">
          {maker !== partMaker?.id && (
            <span className="self-center text-xs text-muted">
              {manufacturers.find((m) => m.id === maker)?.name}:
            </span>
          )}
          {ofMaker.map((m) => {
            const on = value.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(m.id)}
                className={cx(
                  'rounded-full border px-2.5 py-1 text-sm',
                  on
                    ? 'border-accent bg-accent text-white'
                    : 'border-line bg-surface-2 hover:border-accent',
                )}
              >
                {m.name}
              </button>
            );
          })}
          {adding !== maker && (
            <button
              type="button"
              onClick={() => setAdding(maker)}
              className="rounded-full border border-dashed border-line px-2.5 py-1 text-sm text-muted hover:border-accent"
            >
              ＋ Neues Modell
            </button>
          )}
        </div>
      )}
      {offerPartMaker && adding !== name && (
        <button
          type="button"
          onClick={() => setAdding(name)}
          className="rounded-full border border-dashed border-line px-2.5 py-1 text-sm text-muted hover:border-accent"
        >
          ＋ Modell von {partMaker?.name ?? name} anlegen
        </button>
      )}
      {adding !== null && (adding === maker || (offerPartMaker && adding === name)) && (
        <NewModel
          {...(typeof adding === 'number'
            ? { manufacturerId: adding }
            : partMaker
              ? { manufacturerId: partMaker.id }
              : { manufacturer: adding })}
          onCreated={(m) => {
            setAdding(null);
            onChange([...value, m.id]);
          }}
          onCancel={() => setAdding(null)}
        />
      )}
      {!maker && !chosen.length && !offerPartMaker && (
        <p className="text-xs text-muted">
          Oben den Hersteller wählen, dann die passenden Modelle antippen.
        </p>
      )}
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="shrink-0">
          {maker ? 'Modelle eines anderen Herstellers:' : 'Oder Modelle von:'}
        </span>
        <span className="min-w-0 flex-1">
          <MakerSelect
            models={models}
            label="Hersteller für passende Modelle"
            value={maker}
            onChange={(id) => {
              setPicked({ id, for: name });
              setAdding(id && !models.some((m) => m.manufacturerId === id) ? id : null);
            }}
          />
        </span>
      </div>
    </div>
  );
}
