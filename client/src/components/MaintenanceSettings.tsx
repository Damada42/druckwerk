import {
  MAX_NOTIFY_TARGETS,
  MESSAGE_PLACEHOLDERS,
  MESSAGE_PRESETS,
  SAMPLE_MESSAGE_VARS,
  renderMessage,
  type NotifyService,
} from '@3dapp/shared';
import { BellRing, Send, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useHaStatus,
  useNotifyServices,
  useSaveSettings,
  useSettings,
  useTestNotify,
} from '../api';
import { Button, Card, ErrorText, Field, NumberInput, Select, TextArea, TextInput } from './ui';

/** Zahl, die erst beim Verlassen des Felds gespeichert wird */
function SettingNumber({
  label,
  value,
  onSave,
}: {
  label: string;
  value: number;
  onSave: (value: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Field label={label}>
      <NumberInput
        value={draft}
        min={0}
        emptyValue={value}
        onChange={setDraft}
        onBlur={() => draft !== null && draft !== value && onSave(draft)}
      />
    </Field>
  );
}

/** Ziele einer Art als Häkchen-Liste */
function TargetList({
  title,
  services,
  selected,
  onToggle,
}: {
  title: string;
  services: NotifyService[];
  selected: string[];
  onToggle: (value: string, on: boolean) => void;
}) {
  if (!services.length) return null;
  return (
    <fieldset>
      <legend className="mb-1 text-xs font-medium text-muted">{title}</legend>
      <div className="grid gap-1 sm:grid-cols-2">
        {services.map((s) => (
          <label key={s.value} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--color-accent)]"
              checked={selected.includes(s.value)}
              disabled={!selected.includes(s.value) && selected.length >= MAX_NOTIFY_TARGETS}
              onChange={(e) => onToggle(s.value, e.target.checked)}
            />
            {s.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Ziele, Mustertext, Erinnerung und Testnachricht */
function NotifySettings({ hasHa }: { hasHa: boolean }) {
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();
  const services = useNotifyServices(hasHa);
  const test = useTestNotify();
  const [title, setTitle] = useState(settings?.maintenanceTitle ?? '');
  const [message, setMessage] = useState(settings?.maintenanceMessage ?? '');
  useEffect(() => {
    if (!settings) return;
    setTitle(settings.maintenanceTitle);
    setMessage(settings.maintenanceMessage);
  }, [settings?.maintenanceTitle, settings?.maintenanceMessage]);
  // Auswahl lokal, damit ein Häkchen sofort umspringt – auch bei mehreren schnell hintereinander
  const saved = settings?.maintenanceNotify;
  const [selected, setSelected] = useState<string[]>(saved ?? []);
  useEffect(() => {
    if (saved && !saveSettings.isPending) setSelected(saved);
  }, [saved, saveSettings.isPending]);
  if (!settings) return null;

  const list = services.data?.services ?? [];
  const missing = selected.filter((v) => !list.some((s) => s.value === v));
  const toggle = (value: string, on: boolean) => {
    const next = on ? [...selected, value] : selected.filter((v) => v !== value);
    setSelected(next);
    saveSettings.mutate({ maintenanceNotify: next });
  };
  const preset = MESSAGE_PRESETS.findIndex((p) => p.title === title && p.message === message);
  const dirty = title !== settings.maintenanceTitle || message !== settings.maintenanceMessage;
  const saveText = () =>
    dirty && saveSettings.mutate({ maintenanceTitle: title, maintenanceMessage: message });

  return (
    <div className="mt-4 space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <BellRing size={15} /> Benachrichtigungen
      </h3>
      {!hasHa ? (
        <p className="text-sm text-muted">
          Braucht eine Verbindung zu Home Assistant – für die Companion App oder Telegram.
        </p>
      ) : (
        <>
          <TargetList
            title="Handy (Companion App)"
            services={list.filter((s) => s.kind === 'app')}
            selected={selected}
            onToggle={toggle}
          />
          {/* Telegram nur, wenn die Integration in Home Assistant eingerichtet ist */}
          <TargetList
            title="Telegram"
            services={list.filter((s) => s.kind === 'telegram')}
            selected={selected}
            onToggle={toggle}
          />
          {services.isSuccess && !list.length && (
            <p className="text-sm text-muted">
              Keine Ziele gefunden: Companion App oder Telegram in Home Assistant einrichten.
            </p>
          )}
          {missing.map((v) => (
            <label key={v} className="flex items-center gap-2 text-sm text-amber-600">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--color-accent)]"
                checked
                onChange={() => toggle(v, false)}
              />
              Bisheriges Ziel (gerade nicht gefunden)
            </label>
          ))}
          {selected.length >= MAX_NOTIFY_TARGETS && (
            <p className="text-xs text-muted">Höchstens {MAX_NOTIFY_TARGETS} Ziele.</p>
          )}
          {services.data?.errors.map((e) => (
            <p key={e} className="text-sm text-amber-600">
              {e}
            </p>
          ))}
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Textvorlage">
          <Select
            value={preset}
            onChange={(e) => {
              const p = MESSAGE_PRESETS[Number(e.target.value)];
              if (!p) return;
              setTitle(p.title);
              setMessage(p.message);
              saveSettings.mutate({ maintenanceTitle: p.title, maintenanceMessage: p.message });
            }}
          >
            {MESSAGE_PRESETS.map((p, i) => (
              <option key={p.name} value={i}>
                {p.name}
              </option>
            ))}
            {preset < 0 && <option value={-1}>Eigener Text</option>}
          </Select>
        </Field>
        <SettingNumber
          label="Erinnerung, solange fällig: alle … Tage (0 = aus)"
          value={settings.maintenanceRemindDays}
          onSave={(v) => saveSettings.mutate({ maintenanceRemindDays: Math.round(v) })}
        />
        <Field label="Titel" className="sm:col-span-2">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveText} />
        </Field>
        <Field label="Text" className="sm:col-span-2">
          <TextArea
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onBlur={saveText}
          />
        </Field>
      </div>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer">Platzhalter</summary>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          {Object.entries(MESSAGE_PLACEHOLDERS).map(([key, text]) => (
            <div key={key} className="contents">
              <dt className="font-mono">{`{${key}}`}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      </details>
      <div className="rounded-lg border border-line bg-surface-2 p-3 text-sm" aria-label="Vorschau">
        <div className="font-semibold">{renderMessage(title, SAMPLE_MESSAGE_VARS)}</div>
        <div className="whitespace-pre-line">{renderMessage(message, SAMPLE_MESSAGE_VARS)}</div>
      </div>

      {hasHa && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={!selected.length || test.isPending}
            onClick={() => test.mutate({ targets: selected, title, message })}
          >
            <Send size={15} /> Test senden
          </Button>
          {test.data && (
            <span className="text-sm text-muted">
              {test.data.results.every((r) => !r.error)
                ? 'Testnachricht gesendet.'
                : `Gesendet, aber nicht an alle: ${test.data.results
                    .filter((r) => r.error)
                    .map((r) => list.find((s) => s.value === r.target)?.label ?? r.target)
                    .join(', ')}`}
            </span>
          )}
        </div>
      )}
      <ErrorText error={test.error ?? services.error ?? saveSettings.error} />
      <p className="text-xs text-muted">
        Druckwerk prüft jede Minute. Je Drucker kommt eine Nachricht, sobald ein Wartungspunkt „bald
        fällig“ wird ({settings.maintenanceWarnHours} h bzw. {settings.maintenanceWarnDays} Tage
        vorher) und noch einmal, wenn er fällig ist
        {settings.maintenanceRemindDays > 0
          ? ` – danach alle ${settings.maintenanceRemindDays} Tage eine Erinnerung, bis die Wartung erledigt ist`
          : ''}
        . Nach „Wartung erledigt“ beginnt das von vorn.
      </p>
    </div>
  );
}

/** Einstellungen: Ersatzteile und Wartung, Vorwarnung und Nachrichten */
export function MaintenanceCard() {
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();
  const on = !!settings?.maintenance;
  const { data: ha } = useHaStatus();
  const hasHa = (ha?.connections.length ?? 0) > 0;

  return (
    <Card className="mt-4 p-5">
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        <Wrench size={18} /> Ersatzteile &amp; Wartung
      </h2>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
          checked={on}
          disabled={!settings}
          onChange={(e) => saveSettings.mutate({ maintenance: e.target.checked })}
        />
        <span>
          <span className="font-medium">Ersatzteile und Wartungsplan</span>
          <span className="block text-muted">
            Ersatzteile mit Lagerbestand und je Drucker Wartungspunkte mit Intervall in
            Betriebsstunden oder Monaten. Die Betriebsstunden kommen bei verknüpften Druckern aus
            Home Assistant.
          </span>
        </span>
      </label>

      {on && settings && (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <SettingNumber
              label="Vorwarnung (Betriebsstunden vorher)"
              value={settings.maintenanceWarnHours}
              onSave={(v) => saveSettings.mutate({ maintenanceWarnHours: v })}
            />
            <SettingNumber
              label="Vorwarnung bei Monatsintervallen (Tage vorher)"
              value={settings.maintenanceWarnDays}
              onSave={(v) => saveSettings.mutate({ maintenanceWarnDays: v })}
            />
          </div>

          <NotifySettings hasHa={hasHa} />

          <Link
            to="/ersatzteile"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            Ersatzteile verwalten →
          </Link>
        </>
      )}
      <ErrorText error={saveSettings.error} />
    </Card>
  );
}
