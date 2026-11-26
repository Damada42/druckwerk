import { BellRing, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useHaStatus,
  useNotifyServices,
  useSaveSettings,
  useSettings,
  useTestNotify,
} from '../api';
import { Button, Card, ErrorText, Field, NumberInput, Select } from './ui';

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

/** Einstellungen: Ersatzteile und Wartung, Vorwarnung und Push-Nachricht */
export function MaintenanceCard() {
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();
  const on = !!settings?.maintenance;
  const { data: ha } = useHaStatus();
  const hasHa = (ha?.connections.length ?? 0) > 0;
  const services = useNotifyServices(on && hasHa);
  const test = useTestNotify();
  const target = settings?.maintenanceNotify ?? '';
  const options = services.data?.services ?? [];

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

          <div className="mt-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <BellRing size={15} /> Push aufs Handy
            </h3>
            {!hasHa ? (
              <p className="text-sm text-muted">
                Braucht eine Verbindung zu Home Assistant mit der Companion App.
              </p>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Gerät (Companion App)" className="min-w-56 flex-1">
                  <Select
                    value={target}
                    onChange={(e) => saveSettings.mutate({ maintenanceNotify: e.target.value })}
                  >
                    <option value="">– keine Nachricht –</option>
                    {options.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                    {target && !options.some((s) => s.value === target) && (
                      <option value={target}>Bisheriges Gerät (gerade nicht gefunden)</option>
                    )}
                  </Select>
                </Field>
                <Button disabled={!target || test.isPending} onClick={() => test.mutate(target)}>
                  Test senden
                </Button>
              </div>
            )}
            {test.isSuccess && <p className="mt-2 text-sm text-muted">Testnachricht gesendet.</p>}
            <ErrorText error={test.error ?? services.error} />
            {services.data?.errors.map((e) => (
              <p key={e} className="mt-1 text-sm text-amber-600">
                {e}
              </p>
            ))}
            <p className="mt-2 text-xs text-muted">
              Je Drucker eine Nachricht, sobald ein Punkt „bald fällig“ (
              {settings.maintenanceWarnHours} h bzw. {settings.maintenanceWarnDays} Tage vorher) und
              wenn er fällig wird.
            </p>
          </div>

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
