import {
  describeRemaining,
  dueMaintenance,
  lowParts,
  MAINTENANCE_LEVEL_LABELS,
} from '@3dapp/shared';
import { Link } from 'react-router-dom';
import { useList, useSettings } from '../api';
import { LEVEL_TEXT, PartStock } from './PrinterMaintenance';
import { Card, cx } from './ui';

/** So viele Punkte zeigt die Übersicht, der Rest steht bei den Druckern */
const SHOWN = 6;

/** Übersicht: bald fällige Wartung mit benötigten Teilen und knappe Ersatzteile */
export function MaintenanceDueCard() {
  const { data: settings } = useSettings();
  const { data: printers = [] } = useList('printers');
  const on = !!settings?.maintenance;
  const { data: tasks = [] } = useList('maintenance-tasks', on);
  const { data: parts = [] } = useList('spare-parts', on);
  if (!settings?.maintenance) return null;

  const due = dueMaintenance(printers, tasks, parts, new Date(), {
    warnHours: settings.maintenanceWarnHours,
    warnDays: settings.maintenanceWarnDays,
  });
  // Teile, die schon bei einem fälligen Punkt stehen, nicht doppelt nennen
  const listed = new Set(due.map((d) => d.part?.id));
  const low = lowParts(parts).filter((p) => !listed.has(p.id));
  const several = new Set(due.map((d) => d.printerId)).size > 1 || printers.length > 1;

  return (
    <Card className="p-5">
      <h2 className="mb-3 font-semibold">Wartung fällig</h2>
      {due.length === 0 ? (
        <p className="text-sm text-muted">Gerade steht keine Wartung an.</p>
      ) : (
        <ul className="space-y-2" aria-label="Fällige Wartung">
          {due.slice(0, SHOWN).map((d) => (
            <li key={d.task.id} className="flex items-start justify-between gap-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate">
                  {d.task.name}
                  {several && <span className="text-muted"> · {d.printerName}</span>}
                </span>
                {d.part && <PartStock task={d.task} part={d.part} />}
              </span>
              <span className="shrink-0 text-right">
                <span className={cx('block text-xs font-medium', LEVEL_TEXT[d.status.level])}>
                  {MAINTENANCE_LEVEL_LABELS[d.status.level]}
                </span>
                <span className="block text-xs text-muted tabular-nums">
                  {describeRemaining(d.status)}
                </span>
              </span>
            </li>
          ))}
          {due.length > SHOWN && (
            <li>
              <Link to="/drucker" className="text-sm text-accent hover:underline">
                {due.length - SHOWN} weitere →
              </Link>
            </li>
          )}
        </ul>
      )}
      {low.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <h3 className="mb-2 text-sm font-semibold">Ersatzteile knapp</h3>
          <ul className="space-y-1" aria-label="Knappe Ersatzteile">
            {low.map((p) => (
              <li key={p.id} className="flex justify-between gap-2 text-sm">
                <Link to="/ersatzteile" className="truncate hover:text-accent">
                  {p.name}
                </Link>
                <span className="shrink-0 tabular-nums">
                  <span className="font-medium text-red-600">{p.stockQty}</span>
                  <span className="text-xs text-muted"> / min. {p.minStock}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
