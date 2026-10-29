import { LOW_STOCK_GROUP_LABELS, type FilamentType, type LowStockGroup } from '@3dapp/shared';
import { Check, Download, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  downloadBackup,
  useBackupImport,
  useList,
  useSave,
  useSaveSettings,
  useSettings,
} from '../api';
import { Button, Card, ErrorText, NumberInput, TextInput, parseNumber } from './ui';

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

/** Alles sichern und wieder einspielen (Datenbank plus Rechnungen, Fotos, Logo) */
export function BackupCard() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const restore = useBackupImport();
  const input = useRef<HTMLInputElement>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      setMessage(`${await downloadBackup()} heruntergeladen.`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const upload = (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    if (
      !confirm(
        `„${file.name}“ einspielen? Alle jetzigen Daten werden dabei durch das Backup ersetzt.`,
      )
    )
      return;
    setMessage(null);
    restore.mutate(file, {
      onSuccess: (r) =>
        setMessage(`Backup eingespielt: ${r.spools} Spulen, ${r.projects} Projekte.`),
    });
  };

  return (
    <Card className="mt-4 p-5">
      <h2 className="font-semibold">Backup</h2>
      <p className="mb-3 text-sm text-muted">
        Eine ZIP-Datei mit allen Daten, Rechnungen, Fotos und dem Logo – zum Sichern oder für den
        Umzug auf ein anderes Gerät. Beim Einspielen wird alles ersetzt; der vorherige Stand bleibt
        als Sicherheitskopie im Datenordner (backup/).
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={download} disabled={busy}>
          <Download size={16} /> {busy ? 'Wird erstellt …' : 'Backup herunterladen'}
        </Button>
        <Button onClick={() => input.current?.click()} disabled={restore.isPending}>
          <Upload size={16} /> {restore.isPending ? 'Wird eingespielt …' : 'Backup einspielen'}
        </Button>
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          hidden
          data-testid="backup-file"
          onChange={(e) => upload(e.target.files?.[0])}
        />
      </div>
      {message && (
        <p role="status" className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">
          {message}
        </p>
      )}
      <ErrorText error={error ?? restore.error} />
    </Card>
  );
}
