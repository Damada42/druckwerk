import type { HaConnectionStatus } from '@3dapp/shared';
import {
  CheckCircle2,
  CircleOff,
  Home,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Warehouse,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CompanyCard } from '../components/CompanyCard';
import { CostCategoriesCard } from '../components/CostCategoriesCard';
import {
  BackupCard,
  FilamentTypesCard,
  LowStockCard,
  ManufacturersCard,
} from '../components/FilamentSettings';
import {
  useHaConnections,
  useHaStatus,
  useList,
  useSave,
  useSaveSettings,
  useSettings,
} from '../api';
import { Button, Card, ErrorText, Field, PageHeader, TextInput, cx } from '../components/ui';

export function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Einstellungen"
        subtitle="Stammdaten, Firmendaten für Angebote und Rechnungen, Lagerplätze, Home Assistant und Backup."
      />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <FilamentTypesCard />
        <div className="grid gap-4">
          <LowStockCard />
          <NameList resource="finishes" title="Art / Finish" placeholder="z.B. Seidenmatt" />
        </div>
        <ManufacturersCard />
      </div>
      <CostCategoriesCard />
      <CompanyCard />
      <StorageCard />
      <HomeAssistantCard />
      <BackupCard />
    </>
  );
}

function StorageCard() {
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();
  const on = !!settings?.storageLocations;
  return (
    <Card className="mt-4 p-5">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <Warehouse size={18} /> Lagerplätze
      </h2>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
          checked={on}
          disabled={!settings}
          onChange={(e) => saveSettings.mutate({ storageLocations: e.target.checked })}
        />
        <span>
          <span className="font-medium">Lagerplätze verwalten</span>
          <span className="block text-muted">
            Regale und Schränke mit Unterteilungen (z.B. Links › Reihe 2) anlegen und jeder Spule
            ihren Platz zuordnen. Ausgeschaltet gibt es nur das freie Feld „Lagerort“.
          </span>
        </span>
      </label>
      {on && (
        <Link
          to="/lager"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
        >
          Lagerplätze einrichten →
        </Link>
      )}
      <ErrorText error={saveSettings.error} />
    </Card>
  );
}

function HomeAssistantCard() {
  const { data: status, isLoading, isFetching, refetch } = useHaStatus();
  const [editing, setEditing] = useState<HaConnectionStatus | 'new' | null>(null);
  const connections = status?.connections ?? [];

  return (
    <Card className="mt-4 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Home size={18} /> Home Assistant
        </h2>
        {connections.length > 0 && (
          <Button variant="ghost" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={15} className={cx(isFetching && 'animate-spin')} /> Erneut prüfen
          </Button>
        )}
      </div>
      <p className="mb-4 text-sm text-muted">
        Für Live-Status, AMS-Slots, Steuerung und automatisches Abbuchen der Drucker – auch für
        mehrere Standorte. Adresse und Token bleiben auf dem Server, hier wird die Adresse nur
        gekürzt angezeigt.
      </p>

      {connections.length > 0 && (
        <ul className="mb-4 space-y-2">
          {connections.map((c) =>
            editing !== 'new' && editing?.id === c.id ? (
              <li key={c.id}>
                <ConnectionForm connection={c} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <ConnectionRow key={c.id} connection={c} onEdit={() => setEditing(c)} />
            ),
          )}
        </ul>
      )}

      {editing === 'new' ? (
        <ConnectionForm onDone={() => setEditing(null)} />
      ) : (
        !isLoading && (
          <Button
            variant={connections.length ? 'secondary' : 'primary'}
            onClick={() => setEditing('new')}
          >
            <Plus size={16} /> {connections.length ? 'Weiteren Standort verbinden' : 'Verbinden'}
          </Button>
        )
      )}

      {!isLoading && connections.length === 0 && editing !== 'new' && <TokenHelp />}
    </Card>
  );
}

function ConnectionRow({
  connection: c,
  onEdit,
}: {
  connection: HaConnectionStatus;
  onEdit: () => void;
}) {
  const { remove } = useHaConnections();
  return (
    <li className="rounded-lg border border-line p-3 text-sm" aria-label={`Standort ${c.name}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">{c.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{c.url}</span>
        <span
          className={cx(
            'inline-flex items-center gap-1.5',
            c.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600',
          )}
        >
          {c.ok ? <CheckCircle2 size={16} /> : <CircleOff size={16} />}
          {c.ok ? `Verbunden (HA ${c.version})` : 'Keine Verbindung'}
        </span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            className="!p-1.5"
            aria-label={`${c.name} bearbeiten`}
            onClick={onEdit}
          >
            <Pencil size={15} />
          </Button>
          {/* Das eigene HA der App bleibt immer verbunden; ohne App lässt es sich entfernen */}
          {!(c.local && c.ok) && (
            <Button
              variant="ghost"
              className="!p-1.5"
              aria-label={`${c.name} trennen`}
              onClick={() =>
                confirm(`Verbindung „${c.name}“ trennen? Adresse und Token werden gelöscht.`) &&
                remove.mutate(c.id)
              }
            >
              <Trash2 size={15} />
            </Button>
          )}
        </div>
      </div>
      {c.error && <p className="mt-1.5 text-red-600">{c.error}</p>}
      {c.ok && (
        <p className="mt-1.5 text-muted">
          {c.printers.length
            ? `Gefundene Drucker: ${c.printers.map((p) => `${p.name} (${p.model})`).join(', ')} – unter „Drucker“ verknüpfen.`
            : 'Keine Bambu-Lab-Drucker gefunden. Ist die Integration „Bambu Lab“ eingerichtet?'}
        </p>
      )}
      <ErrorText error={remove.error} />
    </li>
  );
}

/** Neue Verbindung oder bestehende ändern (leere Felder = bisherigen Wert behalten) */
function ConnectionForm({
  connection,
  onDone,
}: {
  connection?: HaConnectionStatus;
  onDone: () => void;
}) {
  const { save } = useHaConnections();
  const [name, setName] = useState(connection?.name ?? '');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const isNew = !connection;
  const ready = name.trim() && (!isNew || (url.trim() && token.trim()));

  return (
    <form
      className="grid gap-3 rounded-lg border border-accent/40 p-3 sm:grid-cols-2"
      aria-label={isNew ? 'Neuer Standort' : `${connection.name} bearbeiten`}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready)
          save.mutate(
            { id: connection?.id, name, url: url || undefined, token: token || undefined },
            { onSuccess: onDone },
          );
      }}
    >
      <Field label="Standort" className="sm:col-span-2">
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z.B. Zuhause, Werkstatt"
          autoFocus
        />
      </Field>
      {/* Beim eigenen HA der App kommen Adresse und Token vom Supervisor */}
      {!connection?.local && (
        <>
          <Field label={isNew ? 'Adresse' : 'Neue Adresse (leer = behalten)'}>
            <TextInput
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={connection?.url ?? 'z.B. http://homeassistant.local:8123'}
              autoComplete="off"
            />
          </Field>
          <Field label={isNew ? 'Token' : 'Neuer Token (leer = behalten)'}>
            <TextInput
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={isNew ? 'Langlebiger Zugriffstoken' : '••••••••'}
              autoComplete="off"
            />
          </Field>
        </>
      )}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="submit" variant="primary" disabled={!ready || save.isPending}>
          {save.isPending ? 'Prüfe Verbindung…' : isNew ? 'Verbinden' : 'Speichern'}
        </Button>
        <Button onClick={onDone}>Abbrechen</Button>
      </div>
      <div className="sm:col-span-2">
        <ErrorText error={save.error} />
      </div>
      {isNew && (
        <div className="sm:col-span-2">
          <TokenHelp />
        </div>
      )}
    </form>
  );
}

function TokenHelp() {
  return (
    <details className="mt-4 text-sm text-muted">
      <summary className="cursor-pointer">So bekommst du einen Token</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>Home Assistant öffnen, unten links auf deinen Namen (Profil) tippen.</li>
        <li>Reiter „Sicherheit“ → ganz unten „Langlebige Zugriffstoken“ → „Token erstellen“.</li>
        <li>Name z.B. „Druckwerk“, den angezeigten Token kopieren und oben einfügen.</li>
      </ol>
      <p className="mt-2">
        Als Adresse die, unter der du Home Assistant öffnest – im Heimnetz meist mit :8123, von
        unterwegs z.B. die Nabu-Casa-Adresse.
      </p>
    </details>
  );
}

function NameList({
  resource,
  title,
  placeholder,
}: {
  resource: 'finishes';
  title: string;
  placeholder: string;
}) {
  const { data = [] } = useList(resource);
  const { save, remove } = useSave(resource);
  const [name, setName] = useState('');

  const add = () => {
    if (!name.trim()) return;
    save.mutate({ name: name.trim() } as never, { onSuccess: () => setName('') });
  };

  return (
    <Card className="p-5">
      <h2 className="mb-3 font-semibold">{title}</h2>
      <ul className="mb-3 divide-y divide-[var(--border)]">
        {data.map((item) => (
          <li key={item.id} className="flex items-center justify-between py-1.5 text-sm">
            {item.name}
            <Button
              variant="ghost"
              aria-label={`${item.name} löschen`}
              onClick={() => confirm(`„${item.name}“ löschen?`) && remove.mutate(item.id)}
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
          placeholder={placeholder}
        />
        <Button type="submit" disabled={!name.trim()}>
          <Plus size={16} /> Hinzufügen
        </Button>
      </form>
      <ErrorText error={save.error ?? remove.error} />
    </Card>
  );
}
