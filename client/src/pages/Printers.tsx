import {
  calcPrinterHourly,
  type HaPrinterDevice,
  type Printer,
  type PrinterHourlyCosts,
} from '@3dapp/shared';
import { Box, Pencil, Plus, Video } from 'lucide-react';
import { useState } from 'react';
import { useHaStatus, useList } from '../api';
import { EntityForm, type FieldDef } from '../components/EntityForm';
import { CameraDialog, PrinterCameras } from '../components/PrinterCameras';
import { PrinterLivePanel } from '../components/PrinterLive';
import { Badge, Button, Card, Empty, PageHeader, cx, euro } from '../components/ui';

const hasCostData = (p: Printer) =>
  [p.powerW, p.purchasePrice, p.maintenancePerYear].some((v) => v !== null);

const BASE_FIELDS: FieldDef[] = [
  { key: 'name', label: 'Name', required: true, placeholder: 'z.B. P1S Werkstatt' },
  { key: 'model', label: 'Modell', required: true, placeholder: 'z.B. Bambu Lab P1S' },
  { key: 'nozzle', label: 'Düse (mm)', type: 'number', step: '0.1' },
  { key: 'hasAms', label: 'Mit AMS (automatisches Materialsystem)', type: 'checkbox' },
];

const COST_FIELDS: FieldDef[] = [
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
      <div className="border-b border-line px-3 py-4 sm:px-5">
        <h2 className="font-semibold">Kostenvergleich pro Druckstunde</h2>
        <p className="text-xs text-muted">
          Strom = Watt ÷ 1000 × €/kWh · Abnutzung = Druckerpreis ÷ Lebensdauer · Wartung = Wartung
          pro Jahr ÷ Druckstunden pro Jahr
        </p>
      </div>
      {/* Ab drei Druckern wird es eng: dann scrollen statt quetschen */}
      <table
        className="w-full text-sm"
        style={{ minWidth: printers.length > 2 ? 150 + printers.length * 95 : undefined }}
      >
        <thead>
          <tr className="text-left">
            <th className="px-3 py-2.5 font-medium text-muted sm:px-5">Parameter</th>
            {printers.map((p) => (
              <th key={p.id} className="px-3 py-2.5 text-right font-semibold sm:px-4">
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)] border-t border-line">
          {COST_ROWS.map((row) => (
            <tr key={row.label}>
              <td className="px-3 py-2 text-muted sm:px-5">{row.label}</td>
              {printers.map((p) => (
                <td key={p.id} className="px-3 py-2 text-right tabular-nums sm:px-4">
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
                <td className={cx('px-3 py-2 sm:px-5', !isTotal && 'text-muted')}>{row.label}</td>
                {hourly.map((h, i) => (
                  <td
                    key={printers[i].id}
                    className={cx(
                      'px-3 py-2 text-right tabular-nums sm:px-4',
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

/** Auswahl des Home-Assistant-Geräts; ohne Verbindung nur ein Hinweis */
function haField(devices: HaPrinterDevice[], current: string | null | undefined): FieldDef[] {
  if (!devices.length && !current) return [];
  // Bei mehreren Standorten den Standort dazuschreiben
  const several = new Set(devices.map((d) => d.location)).size > 1;
  const options = devices.map((d) => ({
    value: d.id,
    label: `${d.name} (${d.model})${several && d.location ? ` – ${d.location}` : ''}`,
  }));
  if (current && !devices.some((d) => d.id === current))
    options.push({ value: current, label: 'Bisheriges Gerät (gerade nicht gefunden)' });
  return [
    {
      key: 'haDeviceId',
      label: 'Home-Assistant-Gerät (Live-Status)',
      type: 'select',
      wide: true,
      options,
    },
  ];
}

export function PrintersPage() {
  const { data: printers = [], isLoading } = useList('printers');
  const { data: projects = [] } = useList('projects');
  const { data: ha } = useHaStatus();
  const [editing, setEditing] = useState<Printer | 'new' | null>(null);
  const [cameraPrinter, setCameraPrinter] = useState<Printer | null>(null);
  const fields = [
    ...BASE_FIELDS,
    ...haField(
      (ha?.connections ?? []).flatMap((c) => c.printers),
      editing && editing !== 'new' ? editing.haDeviceId : null,
    ),
    ...COST_FIELDS,
  ];

  return (
    <>
      <PageHeader
        title="Drucker"
        subtitle="Deine Drucker mit Kosten pro Druckstunde und – über Home Assistant – Live-Status."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus size={16} /> Drucker
          </Button>
        }
      />
      {!isLoading && printers.length === 0 && <Empty>Noch keine Drucker angelegt.</Empty>}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {printers.map((p) => {
          const active = projects.filter(
            (pr) => pr.printerId === p.id && pr.status === 'in_progress',
          );
          return (
            <Card key={p.id} className="p-5" role="region" aria-label={p.name}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-strong dark:text-orange-300">
                    <Box size={22} />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{p.name}</div>
                    <div className="truncate text-xs text-muted">{p.model}</div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {p.hasAms && <Badge>AMS</Badge>}
                  <Button
                    variant="ghost"
                    className="!p-1.5"
                    aria-label={`${p.name} Kameras`}
                    title="Kameras"
                    onClick={() => setCameraPrinter(p)}
                  >
                    <Video size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    className="!p-1.5"
                    aria-label={`${p.name} bearbeiten`}
                    title="Bearbeiten"
                    onClick={() => setEditing(p)}
                  >
                    <Pencil size={16} />
                  </Button>
                </div>
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
              <PrinterCameras printer={p} />
              <PrinterLivePanel printer={p} />
            </Card>
          );
        })}
      </div>
      {printers.some(hasCostData) && <CostComparison printers={printers.filter(hasCostData)} />}
      {cameraPrinter && (
        <CameraDialog printer={cameraPrinter} onClose={() => setCameraPrinter(null)} />
      )}
      {editing && (
        <EntityForm
          resource="printers"
          title={editing === 'new' ? 'Neuer Drucker' : editing.name}
          fields={fields}
          initial={editing === 'new' ? undefined : editing}
          defaults={{ nozzle: 0.4, hasAms: false, electricityPrice: 0.3, hoursPerYear: 500 }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
