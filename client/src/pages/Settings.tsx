import { CheckCircle2, CircleOff, Home, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useHaSettings, useHaStatus, useList, useSave } from '../api';
import { Button, Card, ErrorText, Field, PageHeader, TextInput, cx } from '../components/ui';

export function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Einstellungen"
        subtitle="Stammdaten für die Auswahllisten und die Verbindung zu Home Assistant."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <NameList resource="filament-types" title="Filamenttypen" placeholder="z.B. PLA-CF" />
        <NameList resource="finishes" title="Art / Finish" placeholder="z.B. Seidenmatt" />
      </div>
      <HomeAssistantCard />
    </>
  );
}

function HomeAssistantCard() {
  const { data: status, isLoading, isFetching, refetch } = useHaStatus();
  const { save, disconnect } = useHaSettings();
  const [url, setUrl] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const shownUrl = url ?? status?.url ?? '';

  const submit = () =>
    save.mutate(
      { url: shownUrl, token: token || undefined },
      {
        onSuccess: () => {
          setToken('');
          setUrl(null);
        },
      },
    );

  return (
    <Card className="mt-4 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Home size={18} /> Home Assistant
        </h2>
        {status && (
          <span
            className={cx(
              'inline-flex items-center gap-1.5 text-sm',
              status.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted',
            )}
          >
            {status.ok ? <CheckCircle2 size={16} /> : <CircleOff size={16} />}
            {status.ok
              ? `Verbunden (HA ${status.version})`
              : status.hasToken
                ? 'Keine Verbindung'
                : 'Nicht eingerichtet'}
          </span>
        )}
      </div>
      <p className="mb-4 text-sm text-muted">
        Für Live-Status, AMS-Slots, Steuerung und automatisches Abbuchen der Drucker. Der Token
        bleibt auf dem Server und wird nie an den Browser zurückgegeben.
      </p>

      {status?.error && <p className="mb-3 text-sm text-red-600">{status.error}</p>}
      {status?.ok && (
        <p className="mb-4 text-sm">
          {status.printers.length
            ? `Gefundene Drucker: ${status.printers.map((p) => `${p.name} (${p.model})`).join(', ')} – unter „Drucker“ verknüpfen.`
            : 'Keine Bambu-Lab-Drucker gefunden. Ist die Integration „Bambu Lab“ in Home Assistant eingerichtet?'}
        </p>
      )}

      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Adresse">
          <TextInput
            value={shownUrl}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="z.B. http://homeassistant.local:8123"
            autoComplete="off"
          />
        </Field>
        <Field label={status?.hasToken ? 'Neuer Token (leer = bisherigen behalten)' : 'Token'}>
          <TextInput
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={status?.hasToken ? '••••••••' : 'Langlebiger Zugriffstoken'}
            autoComplete="off"
          />
        </Field>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button
            type="submit"
            variant="primary"
            disabled={!shownUrl.trim() || (!token && !status?.hasToken) || save.isPending}
          >
            {save.isPending ? 'Prüfe Verbindung…' : 'Verbinden'}
          </Button>
          {status?.hasToken && (
            <>
              <Button onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw size={15} className={cx(isFetching && 'animate-spin')} /> Erneut prüfen
              </Button>
              <Button
                variant="danger"
                onClick={() =>
                  confirm('Verbindung zu Home Assistant trennen? Der Token wird gelöscht.') &&
                  disconnect.mutate()
                }
              >
                Trennen
              </Button>
            </>
          )}
        </div>
      </form>
      <ErrorText error={save.error ?? disconnect.error} />

      {!isLoading && !status?.hasToken && (
        <details className="mt-4 text-sm text-muted">
          <summary className="cursor-pointer">So bekommst du einen Token</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Home Assistant öffnen, unten links auf deinen Namen (Profil) tippen.</li>
            <li>
              Reiter „Sicherheit“ → ganz unten „Langlebige Zugriffstoken“ → „Token erstellen“.
            </li>
            <li>Name z.B. „Druckwerk“, den angezeigten Token kopieren und oben einfügen.</li>
          </ol>
          <p className="mt-2">
            Als Adresse die, unter der du Home Assistant im Heimnetz öffnest (meist mit :8123).
          </p>
        </details>
      )}
    </Card>
  );
}

function NameList({
  resource,
  title,
  placeholder,
}: {
  resource: 'filament-types' | 'finishes';
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
