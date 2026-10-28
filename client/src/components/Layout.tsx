import {
  Contact,
  Cylinder,
  KanbanSquare,
  LayoutDashboard,
  Printer,
  Settings,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import type { AppSettings } from '@3dapp/shared';
import { NavLink, Outlet } from 'react-router-dom';
import { useSettings } from '../api';
import { cx } from './ui';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  description: string;
  /** Nur zeigen, wenn diese Einstellung an ist */
  feature?: keyof AppSettings;
}

/** Menüpunkte ohne ausgeschaltete Funktionen */
export function useNavItems() {
  const { data: settings } = useSettings();
  return NAV_ITEMS.filter((n) => !n.feature || settings?.[n.feature]);
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Übersicht', icon: LayoutDashboard, description: 'Alles auf einen Blick' },
  {
    to: '/projekte',
    label: 'Projekte',
    icon: KanbanSquare,
    description: 'Aufträge im Kanban-Board',
  },
  { to: '/kunden', label: 'Kunden', icon: Contact, description: 'Kundendatenbank' },
  { to: '/personen', label: 'Team', icon: Users, description: 'Helfer & Unterstützung' },
  { to: '/filament', label: 'Filament', icon: Cylinder, description: 'Bestand nach Material' },
  {
    to: '/lager',
    label: 'Lager',
    icon: Warehouse,
    description: 'Lagerplätze der Spulen',
    feature: 'storageLocations',
  },
  { to: '/drucker', label: 'Drucker', icon: Printer, description: 'Deine Drucker' },
  {
    to: '/einstellungen',
    label: 'Einstellungen',
    icon: Settings,
    description: 'Materialtypen & Finishes',
  },
];

/** Auf dem Handy passen nicht alle Punkte in die untere Leiste (Lager über die Filament-Seite) */
const NOT_ON_MOBILE = new Set(['/einstellungen', '/personen', '/lager']);

export function Layout() {
  const navItems = useNavItems();
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface px-3 py-5 md:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <img src="icon.svg" alt="" className="h-8 w-8" />
          <span className="text-lg font-semibold tracking-tight">Druckwerk</span>
        </div>
        <nav className="flex flex-col gap-0.5">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                  isActive
                    ? 'bg-accent-soft text-accent-strong dark:text-orange-300'
                    : 'text-muted hover:bg-surface-2 hover:text-main',
                )
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 px-4 pt-5 pb-24 sm:px-6 md:px-8 md:py-8">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {navItems
          .filter((n) => !NOT_ON_MOBILE.has(n.to))
          .map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cx(
                  'flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium',
                  isActive ? 'text-accent' : 'text-muted',
                )
              }
            >
              <Icon size={20} />
              {label}
            </NavLink>
          ))}
      </nav>
    </div>
  );
}
