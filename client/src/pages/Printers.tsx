import { calcPrinterHourly, type Printer, type PrinterHourlyCosts } from '@3dapp/shared';
import { Box, Home, Plus } from 'lucide-react';
import { useState } from 'react';
import { useList } from '../api';
import { EntityForm, type FieldDef } from '../components/EntityForm';
import { Badge, Button, Card, Empty, PageHeader, cx, euro } from '../components/ui';

const hasCostData = (p: Printer) =>
  [p.powerW, p.purchasePrice, p.maintenancePerYear].some((v) => v !== null);

const FIELDS: FieldDef[] = [
  { key: 'name', label: 'Name', required: true, placeholder: 'z.B. P1S Werkstatt' },
  { key: 'model', label: 'Modell', required: true, placeholder: 'z.B. Bambu Lab P1S' },
  { key: 'nozzle', label: 'Düse (mm)', type: 'number', step: '0.1' },
  { key: 'hasAms', label: 'Mit AMS (automatisches Materialsystem)', type: 'checkbox' },
  {
    key: 'haEntityPrefix',
    label: 'Home-Assistant-Gerät (Entity-Präfix)',
    wide: true,
    placeholder: 'z.B. p1s_01p00a123456789',
  },
  { key: 'powerW', label: 'Stromverbrauch (Watt)', type: 'number' },
  { key: 'electricityPrice', label: 'Strompreis (€/kWh)', type: 'number', step: '0.01' },
  { key: 'purchasePrice', label: 'Druckerpreis (€)', type: 'number', step: '0.01' },
  { key: 'lifetimeHours', label: 'Lebensdauer (Stunden)', type: 'number' },
  { key: 'maintenancePerYear', label: 'Wartungskosten pro Jahr (€)', type: 'number', step: '0.01' },
  { key: 'hoursPerYear', label: 'Druckstunden pro Jahr', type: 'number' },
  { key: 'notes', label: 'Notizen', type: 'textarea' },
];

/** Kleine Beträge (Cent-Bruchteile) mit 3 Nachkommastellen anzeigen. */
const perHour = (n: number) =>
  `${n.toLocaleString('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} €`;

const COST_ROWS: { label: string; value: (p: Printer) => string }[] = [
  { label: 'Stromverbrauch', value: (p) => (p.powerW === null ? '–' : `${p.powerW} W`) },
  {
    label: 'Strompreis',
    value: (p) =>
      p.electricityPrice === null ? '–' : `${p.electricityPrice.toLocaleString('de-DE')} €/kWh`,
  },
  { label: 'Druckerpreis', value: (p) => euro(p.purchasePrice) },
  {
    label: 'Lebensdauer',
    value: (p) => (p.lifetimeHours === null ? '–' : `${p.lifetimeHours.toLocaleString('de-DE')} h`),
  },
  { label: 'Wartung pro Jahr', value: (p) => euro(p.maintenancePerYear) },
  {
    label: 'Druckstunden pro Jahr',
    value: (p) => (p.hoursPerYear === null ? '–' : `${p.hoursPerYear.toLocaleString('de-DE')} h`),
  },
];

const HOURLY_ROWS: { label: string; key: keyof PrinterHourlyCosts }[] = [
  { label: 'Stromkosten/h', key: 'power' },
  { label: 'Abnutzung/h', key: 'wear' },
  { label: 'Wartungskosten/h', key: 'maintenance' },
  { label: 'Summe pro Druckstunde', key: 'total' },
];

function CostComparison({ printers }: { printers: Printer[] }) {
  const hourly = printers.map(calcPrinterHourly);
  const cheapest = Math.min(...hourly.map((h) => h.total));
  return (
    <Card className="mt-6 overflow-x-auto">
      <div className="border-b border-line px-5 py-4">
        <h2 className="font-semibold">Kostenvergleich pro Druckstunde</h2>
        <p className="text-xs text-muted">
          Strom = Watt ÷ 1000 × €/kWh · Abnutzung = Druckerpreis ÷ Lebensdauer · Wartung = Wartung
          pro Jahr ÷ Druckstunden pro Jahr
        </p>
      </div>
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="text-left">
            <th className="px-5 py-2.5 font-medium text-muted">Parameter</th>
            {printers.map((p) => (
              <th key={p.id} className="px-4 py-2.5 text-right font-semibold">
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)] border-t border-line">
          {COST_ROWS.map((row) => (
            <tr key={row.label}>
              <td className="px-5 py-2 text-muted">{row.label}</td>
              {printers.map((p) => (
                <td key={p.id} className="px-4 py-2 text-right tabular-nums">
                  {row.value(p)}
                </td>
              ))}
            </tr>
          ))}
          {HOURLY_ROWS.map((row) => {
            const isTotal = row.key === 'total';
            return (
              <tr
                key={row.key}
                className={cx(
                  isTotal && 'bg-surface-2 font-semibold',
                  row.key === 'power' && 'border-t-2 border-line',
                )}
              >
                <td className={cx('px-5 py-2', !isTotal && 'text-muted')}>{row.label}</td>
                {hourly.map((h, i) => (
                  <td
                    key={printers[i].id}
                    className={cx(
                      'px-4 py-2 text-right tabular-nums',
                      isTotal &&
                        printers.length > 1 &&
                        h.total === cheapest &&
                        'text-emerald-600 dark:text-emerald-400',
                    )}
                  >
                    {perHour(h[row.key])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

export function PrintersPage() {
  const { data: printers = [], isLoading } = useList('printers');
  const { data: projects = [] } = useList('projects');
  const [editing, setEditing] = useState<Printer | 'new' | null>(null);

  return (
    <>
      <PageHeader
        title="Drucker"
        subtitle="Deine Drucker. Live-Daten kommen später über Home Assistant."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> Drucker
          </Button>
        }
      />
      {!isLoading && printers.length === 0 && <Empty>Noch keine Drucker angelegt.</Empty>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {printers.map((p) => {
          const active = projects.filter(
            (pr) => pr.printerId === p.id && pr.status === 'in_progress',
          );
          return (
            <Card
              key={p.id}
              className="cursor-pointer p-5 transition hover:border-accent/60"
              onClick={() => setEditing(p)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent-strong dark:text-orange-300">
                    <Box size={22} />
                  </span>
                  <div>
                    <div className="font-semibold">{p.name}</div>
                    <div className="text-xs text-muted">{p.model}</div>
                  </div>
                </div>
                {p.hasAms && <Badge>AMS</Badge>}
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted">Düse</dt>
                <dd className="text-right tabular-nums">{p.nozzle.toLocaleString('de-DE')} mm</dd>
                <dt className="text-muted">Projekte in Arbeit</dt>
                <dd className="text-right tabular-nums">{active.length}</dd>
                <dt className="text-muted">Kosten pro Druckstunde</dt>
                <dd className="text-right font-semibold tabular-nums">
                  {hasCostData(p) ? perHour(calcPrinterHourly(p).total) : '–'}
                </dd>
              </dl>
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-2 text-xs text-muted">
                <Home size={14} className="shrink-0" />
                {p.haEntityPrefix
                  ? `Verknüpft mit HA-Gerät „${p.haEntityPrefix}“ – Live-Status folgt.`
                  : 'Status, Fortschritt & AMS-Slots folgen über Home Assistant.'}
              </div>
            </Card>
          );
        })}
      </div>
      {printers.some(hasCostData) && <CostComparison printers={printers.filter(hasCostData)} />}
      {editing && (
        <EntityForm
          resource="printers"
          title={editing === 'new' ? 'Neuer Drucker' : editing.name}
          fields={FIELDS}
          initial={editing === 'new' ? undefined : editing}
          defaults={{ nozzle: 0.4, hasAms: false, electricityPrice: 0.3, hoursPerYear: 500 }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
