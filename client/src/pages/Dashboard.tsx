import { LOW_FILAMENT_GRAMS, PROJECT_STATUS_LABELS, type ProjectStatus } from '@3dapp/shared';
import { ArrowRight, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useList, useStats } from '../api';
import { NAV_ITEMS } from '../components/Layout';
import { Card, ColorDot, PageHeader, dateDe, grams } from '../components/ui';

const STATUS_DOT: Record<ProjectStatus, string> = {
  open: 'bg-stone-400',
  in_progress: 'bg-accent',
  done: 'bg-emerald-500',
};

export function DashboardPage() {
  const { data: stats } = useStats();
  const { data: projects = [] } = useList('projects');
  const { data: spools = [] } = useList('spools');
  const { data: printers = [] } = useList('printers');

  const active = projects.filter((p) => p.status === 'in_progress').slice(0, 5);
  const low = spools.filter((s) => s.weightRemainingG < LOW_FILAMENT_GRAMS).slice(0, 5);

  const tileInfo: Record<string, string> = {
    '/projekte': stats ? `${stats.projects.open + stats.projects.in_progress} aktiv` : '',
    '/kunden': stats ? `${stats.customers} ${stats.customers === 1 ? 'Kunde' : 'Kunden'}` : '',
    '/personen': stats ? `${stats.persons} ${stats.persons === 1 ? 'Person' : 'Personen'}` : '',
    '/filament': stats
      ? `${stats.spools} ${stats.spools === 1 ? 'Spule' : 'Spulen'} · ${grams(stats.filamentTotalG)}`
      : '',
    '/drucker': stats ? `${stats.printers} Drucker` : '',
    '/einstellungen': 'Stammdaten',
  };

  return (
    <>
      <PageHeader
        title="Übersicht"
        subtitle="Wohin möchtest du?"
        actions={
          <Link
            to="/projekte?neu=1"
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-white hover:bg-accent-strong"
          >
            <Plus size={16} /> Neues Projekt
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {NAV_ITEMS.filter((n) => n.to !== '/').map(({ to, label, icon: Icon, description }) => (
          <Link key={to} to={to} className="group">
            <Card className="flex h-full flex-col gap-3 p-4 transition group-hover:border-accent/60 sm:p-5">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft text-accent-strong dark:text-orange-300">
                  <Icon size={20} />
                </span>
                <ArrowRight
                  size={16}
                  className="text-muted opacity-0 transition group-hover:opacity-100"
                />
              </div>
              <div>
                <div className="font-semibold">{label}</div>
                <div className="text-xs text-muted">{description}</div>
              </div>
              <div className="mt-auto text-sm font-medium tabular-nums">{tileInfo[to]}</div>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Projektstatus</h2>
          <ul className="space-y-2">
            {(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((s) => (
              <li key={s} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[s]}`} />
                  {PROJECT_STATUS_LABELS[s]}
                </span>
                <span className="font-semibold tabular-nums">{stats?.projects[s] ?? 0}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 font-semibold">In Arbeit</h2>
          {active.length === 0 ? (
            <p className="text-sm text-muted">Gerade nichts in Arbeit.</p>
          ) : (
            <ul className="space-y-2">
              {active.map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/projekte/${p.id}`}
                    className="flex justify-between gap-2 text-sm hover:text-accent"
                  >
                    <span className="truncate">{p.title}</span>
                    <span className="shrink-0 text-muted">
                      {p.dueDate ? dateDe(p.dueDate) : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Filament wird knapp</h2>
          {low.length === 0 ? (
            <p className="text-sm text-muted">Alle Spulen haben mehr als {LOW_FILAMENT_GRAMS} g.</p>
          ) : (
            <ul className="space-y-2">
              {low.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <ColorDot color={s.colorHex} />
                    <span className="truncate">
                      {s.manufacturer} {s.colorName}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium text-red-600 tabular-nums">
                    {grams(s.weightRemainingG)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {printers.length > 0 && (
            <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
              Live-Status von {printers.map((p) => p.name).join(', ')} folgt mit der
              Home-Assistant-Anbindung.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}
