import {
  BACKUP_GROUP_HINTS,
  BACKUP_GROUP_LABELS,
  BACKUP_GROUP_UNITS,
  BACKUP_GROUPS,
  LOW_STOCK_GROUP_LABELS,
  type BackupGroup,
  type BackupInfo,
  type FilamentType,
  type LowStockGroup,
} from '@3dapp/shared';
import { Check, Download, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  downloadBackup,
  useBackupInspect,
  useBackupRestore,
  useList,
  useSave,
  useSaveSettings,
  useSettings,
} from '../api';
import { Button, Card, ErrorText, NumberInput, TextInput, cx, parseNumber } from './ui';

/** Filamenttypen mit Mindestmenge: Vorgabe für alle Sorten des Typs */
export function FilamentTypesCard() {
  const { data: types = [] } = useList('filament-types');
  const { save, remove } = useSave('filament-types');
  const [name, setName] = useState('');

  const add = () => {
    if (!name.trim()) return;
    save.mutate({ name: name.trim() }, { onSuccess: () => setName('') });
  };

  return (
    <Card className="p-5">
      <h2 className="font-semibold">Filamenttypen</h2>
      <p className="mb-3 text-xs text-muted">
        „Knapp unter“ gilt für alle Sorten des Typs. Auf der Filament-Seite lässt sich der Wert je
        Sorte anpassen.
      </p>
      <ul className="mb-3 divide-y divide-[var(--border)]">
        {types.map((t) => (
          <li key={t.id} className="flex items-center gap-2 py-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate">{t.name}</span>
            <TypeMinStock type={t} />
            <Button
              variant="ghost"
              aria-label={`${t.name} löschen`}
              onClick={() => confirm(`„${t.name}“ löschen?`) && remove.mutate(t.id)}
            >
              <Trash2 size={15} />
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z.B. PLA-CF"
        />
        <Button type="submit" disabled={!name.trim()}>
          <Plus size={16} /> Hinzufügen
        </Button>
      </form>
      <ErrorText error={save.error ?? remove.error} />
    </Card>
  );
}

function TypeMinStock({ type }: { type: FilamentType }) {
  const { save } = useSave('filament-types');
  const [value, setValue] = useState<number | null>(type.minStockG);
  return (
    <label className="flex shrink-0 items-center gap-1 text-xs text-muted">
      <span className="max-sm:sr-only">knapp unter</span>
      <NumberInput
        aria-label={`Mindestmenge ${type.name}`}
        value={value}
        min={0}
        emptyValue={200}
        onChange={setValue}
        onBlur={(e) => {
          const n = Math.max(0, parseNumber(e.currentTarget.value) ?? 200);
          if (n !== type.minStockG) save.mutate({ id: type.id, minStockG: n });
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="!w-20 !px-2 !py-1 text-right"
      />
      g
    </label>
  );
}

/** Wie „Filament wird knapp“ in der Übersicht zusammenzählt */
export function LowStockCard() {
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();
  return (
    <Card className="p-5">
      <h2 className="font-semibold">Filament wird knapp</h2>
      <p className="mb-3 text-xs text-muted">
        Beispiel: 800 g Schwarz von Sunlu und 150 g Schwarz von Bambu Lab. Nach Hersteller ist Bambu
        Lab Schwarz knapp, nur nach Farbe reichen die 950 g Schwarz.
      </p>
      <div className="space-y-2" role="radiogroup" aria-label="Zusammenzählen">
        {(Object.keys(LOW_STOCK_GROUP_LABELS) as LowStockGroup[]).map((mode) => (
          <label key={mode} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="lowStockGroup"
              className="h-4 w-4 accent-[var(--color-accent)]"
              checked={(settings?.lowStockGroup ?? 'manufacturer') === mode}
              disabled={!settings}
              onChange={() => saveSettings.mutate({ lowStockGroup: mode })}
            />
            {LOW_STOCK_GROUP_LABELS[mode]}
          </label>
        ))}
      </div>
      <ErrorText error={saveSettings.error} />
    </Card>
  );
}

/** Herstellerliste: Auswahl im Spulen-Formular, damit sich niemand vertippt */
export function ManufacturersCard() {
  const { data: manufacturers = [] } = useList('manufacturers');
  const { save, remove } = useSave('manufacturers');
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);

  const add = () => {
    if (!name.trim()) return;
    save.mutate({ name: name.trim() }, { onSuccess: () => setName('') });
  };
  const rename = () => {
    if (!editing?.name.trim()) return;
    save.mutate(
      { id: editing.id, name: editing.name.trim() },
      { onSuccess: () => setEditing(null) },
    );
  };

  return (
    <Card className="p-5">
      <h2 className="font-semibold">Hersteller</h2>
      <p className="mb-3 text-xs text-muted">
        Umbenennen ändert auch alle Spulen dieses Herstellers.
      </p>
      <ul className="mb-3 max-h-80 divide-y divide-[var(--border)] overflow-y-auto">
        {manufacturers.map((m) =>
          editing?.id === m.id ? (
            <li key={m.id}>
              <form
                className="flex items-center gap-2 py-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  rename();
                }}
              >
                <TextInput
                  autoFocus
                  aria-label={`${m.name} umbenennen`}
                  value={editing.name}
                  onChange={(e) => setEditing({ id: m.id, name: e.target.value })}
                />
                <Button type="submit" variant="ghost" aria-label="Übernehmen">
                  <Check size={15} />
                </Button>
                <Button variant="ghost" aria-label="Abbrechen" onClick={() => setEditing(null)}>
                  <X size={15} />
                </Button>
              </form>
            </li>
          ) : (
            <li key={m.id} className="flex items-center gap-1 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
              <Button
                variant="ghost"
                aria-label={`${m.name} umbenennen`}
                onClick={() => setEditing({ id: m.id, name: m.name })}
              >
                <Pencil size={15} />
              </Button>
              <Button
                variant="ghost"
                aria-label={`${m.name} löschen`}
                onClick={() => confirm(`„${m.name}“ löschen?`) && remove.mutate(m.id)}
              >
                <Trash2 size={15} />
              </Button>
            </li>
          ),
        )}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z.B. Polymaker"
          aria-label="Neuer Hersteller"
        />
        <Button type="submit" disabled={!name.trim()}>
          <Plus size={16} /> Hinzufügen
        </Button>
      </form>
      <ErrorText error={save.error ?? remove.error} />
    </Card>
  );
}

/** Häkchen für „Alles“ und jeden Bereich; nicht verfügbare Bereiche sind ausgegraut */
function BackupGroupChecks({
  name,
  selected,
  onChange,
  available = BACKUP_GROUPS,
  detail,
}: {
  name: string;
  selected: BackupGroup[];
  onChange: (groups: BackupGroup[]) => void;
  available?: readonly BackupGroup[];
  detail?: (group: BackupGroup) => string;
}) {
  const allRef = useRef<HTMLInputElement>(null);
  const all = selected.length === available.length;
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = selected.length > 0 && !all;
  }, [selected.length, all]);
  const toggle = (group: BackupGroup, on: boolean) =>
    onChange(BACKUP_GROUPS.filter((g) => (g === group ? on : selected.includes(g))));
  const box = 'mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)]';

  return (
    <fieldset className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
      <legend className="sr-only">{name}</legend>
      <label className="flex items-start gap-3 text-sm font-medium sm:col-span-2">
        <input
          ref={allRef}
          type="checkbox"
          className={box}
          checked={all}
          onChange={(e) => onChange(e.target.checked ? [...available] : [])}
        />
        Alles
      </label>
      {BACKUP_GROUPS.map((group) => {
        const enabled = available.includes(group);
        return (
          <label
            key={group}
            className={cx('flex items-start gap-3 text-sm', !enabled && 'opacity-50')}
          >
            <input
              type="checkbox"
              className={box}
              disabled={!enabled}
              checked={selected.includes(group)}
              onChange={(e) => toggle(group, e.target.checked)}
            />
            <span className="min-w-0">
              <span className="font-medium">{BACKUP_GROUP_LABELS[group]}</span>
              {detail && <span className="text-muted"> · {detail(group)}</span>}
              <span className="block text-xs text-muted">{BACKUP_GROUP_HINTS[group]}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** „3 Spulen“, „1 Kunde“, „vorhanden“ … */
function groupCount(group: BackupGroup, count: number) {
  const unit = BACKUP_GROUP_UNITS[group];
  if (!unit) return count ? 'vorhanden' : 'leer';
  return `${count} ${count === 1 ? unit[0] : unit[1]}`;
}

const groupNames = (groups: BackupGroup[]) => groups.map((g) => BACKUP_GROUP_LABELS[g]).join(', ');

/** Sichern und Einspielen, jeweils alles oder nur einzelne Bereiche */
export function BackupCard() {
  const [exportGroups, setExportGroups] = useState<BackupGroup[]>([...BACKUP_GROUPS]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const inspect = useBackupInspect();
  const restore = useBackupRestore();
  const [picked, setPicked] = useState<{ file: string; info: BackupInfo } | null>(null);
  const [importGroups, setImportGroups] = useState<BackupGroup[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      setMessage(`${await downloadBackup(exportGroups)} heruntergeladen.`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const choose = (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    setMessage(null);
    setError(null);
    restore.reset();
    inspect.mutate(file, {
      onSuccess: (info) => {
        setPicked({ file: file.name, info });
        setImportGroups(info.groups.map((g) => g.group));
      },
    });
  };

  const run = () => {
    if (!picked || !importGroups.length) return;
    if (
      !confirm(
        `Diese Bereiche werden durch das Backup ersetzt: ${groupNames(importGroups)}. Weiter?`,
      )
    )
      return;
    restore.mutate(
      { token: picked.info.token, groups: importGroups },
      {
        onSuccess: (r) => {
          setPicked(null);
          const fixed = r.fixed
            ? ` ${r.fixed} ${r.fixed === 1 ? 'Verweis' : 'Verweise'} auf nicht eingespielte Einträge entfernt.`
            : '';
          setMessage(`Backup eingespielt: ${groupNames(r.groups)}.${fixed}`);
        },
      },
    );
  };

  const available = picked?.info.groups.map((g) => g.group) ?? [];
  const counts = new Map(picked?.info.groups.map((g) => [g.group, g.count]));
  const partial = importGroups.length > 0 && importGroups.length < BACKUP_GROUPS.length;

  return (
    <Card className="mt-4 p-5">
      <h2 className="font-semibold">Backup</h2>
      <p className="mb-4 text-sm text-muted">
        Eine ZIP-Datei mit den Daten und den zugehörigen Belegen, PDFs und dem Logo – zum Sichern
        oder für den Umzug auf ein anderes Gerät. Beim Einspielen werden nur die gewählten Bereiche
        ersetzt; der vorherige Stand bleibt als Sicherheitskopie im Datenordner (backup/).
      </p>

      <h3 className="mb-2 text-sm font-semibold">Sichern</h3>
      <BackupGroupChecks
        name="Bereiche sichern"
        selected={exportGroups}
        onChange={setExportGroups}
      />
      <div className="mt-3">
        <Button onClick={download} disabled={busy || !exportGroups.length}>
          <Download size={16} /> {busy ? 'Wird erstellt …' : 'Backup herunterladen'}
        </Button>
      </div>

      <h3 className="mt-5 mb-2 text-sm font-semibold">Einspielen</h3>
      {!picked ? (
        <Button onClick={() => input.current?.click()} disabled={inspect.isPending}>
          <Upload size={16} /> {inspect.isPending ? 'Wird geprüft …' : 'Backup-Datei wählen'}
        </Button>
      ) : (
        <div className="rounded-lg border border-[var(--border)] p-3">
          <p className="mb-3 text-sm break-words">
            <span className="font-medium">{picked.file}</span>
            {picked.info.createdAt && (
              <span className="text-muted">
                {' · erstellt '}
                {new Date(picked.info.createdAt).toLocaleString('de-AT', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </span>
            )}
          </p>
          <BackupGroupChecks
            name="Bereiche einspielen"
            selected={importGroups}
            onChange={setImportGroups}
            available={available}
            detail={(g) => (counts.has(g) ? groupCount(g, counts.get(g)!) : 'nicht im Backup')}
          />
          {partial && (
            <p className="mt-3 text-xs text-muted">
              Projekte verweisen auf Kunden, Team, Filament und Drucker, Spulen auf Lagerplätze.
              Gibt es einen solchen Eintrag nach dem Einspielen nicht mehr, wird der Verweis
              entfernt.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={run}
              disabled={restore.isPending || !importGroups.length}
            >
              <Upload size={16} /> {restore.isPending ? 'Wird eingespielt …' : 'Einspielen'}
            </Button>
            <Button variant="ghost" onClick={() => setPicked(null)} disabled={restore.isPending}>
              Abbrechen
            </Button>
          </div>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept=".zip,application/zip"
        hidden
        data-testid="backup-file"
        onChange={(e) => choose(e.target.files?.[0])}
      />
      {message && (
        <p role="status" className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">
          {message}
        </p>
      )}
      <ErrorText error={error ?? inspect.error ?? restore.error} />
    </Card>
  );
}
