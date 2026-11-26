// Lagerplätze für Filament: ein Baum wie „Wandregal › Links › Reihe 2“.

import { MESSAGE_PRESETS } from './maintenance';
import type { LowStockGroup } from './stock';

export interface StorageLocation {
  id: number;
  name: string;
  /** Übergeordneter Platz; null = oberste Ebene (Regal, Schrank …) */
  parentId: number | null;
  /** Reihenfolge unter Geschwistern */
  position: number;
  createdAt: string;
}

/** Einstellungen der App (Schlüssel-Wert-Tabelle `settings`) */
export interface AppSettings {
  /** Lagerplätze verwalten und Spulen zuordnen */
  storageLocations: boolean;
  /** „Filament wird knapp“: je Hersteller und Farbe oder nur je Farbe zusammenzählen */
  lowStockGroup: LowStockGroup;
  /** Ersatzteile und Wartungsplan der Drucker */
  maintenance: boolean;
  /** Vorwarnung: so viele Betriebsstunden vor dem Intervall gilt ein Punkt als „bald fällig“ */
  maintenanceWarnHours: number;
  /** Vorwarnung bei Intervallen in Monaten, in Tagen */
  maintenanceWarnDays: number;
  /**
   * Nachrichten über Home Assistant, je Ziel „<Verbindungs-ID>:mobile_app_xyz“ (Companion App)
   * oder „<Verbindungs-ID>:notify.telegram_bot_…“ (Entity, z.B. Telegram); leer = keine Nachricht
   */
  maintenanceNotify: string[];
  /** Mustertext der Nachricht: Titel und Text mit Platzhaltern wie {drucker} */
  maintenanceTitle: string;
  maintenanceMessage: string;
  /** Erinnerung alle N Tage, solange ein Punkt fällig ist; 0 = aus */
  maintenanceRemindDays: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  storageLocations: false,
  lowStockGroup: 'manufacturer',
  maintenance: false,
  maintenanceWarnHours: 300,
  maintenanceWarnDays: 14,
  maintenanceNotify: [],
  maintenanceTitle: MESSAGE_PRESETS[0].title,
  maintenanceMessage: MESSAGE_PRESETS[0].message,
  maintenanceRemindDays: 0,
};

/** Höchstens so viele Nachrichtenziele */
export const MAX_NOTIFY_TARGETS = 10;

/**
 * Ziel einer Nachricht: ein notify-Dienst (Companion App, `notify.mobile_app_xyz`) oder eine
 * notify-Entity (Telegram, über `notify.send_message`)
 */
export type NotifyTarget =
  | { connectionId: number; service: string; entityId?: undefined }
  | { connectionId: number; entityId: string; service?: undefined };

/** Ein Ziel aus maintenanceNotify zerlegen */
export function parseNotifyTarget(value: unknown): NotifyTarget | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d+):(?:(notify\.[a-z0-9_]+)|([a-z0-9_]+))$/.exec(value);
  if (!m) return null;
  const connectionId = Number(m[1]);
  return m[2] ? { connectionId, entityId: m[2] } : { connectionId, service: m[3] };
}

/** Ältere Einstellung (ein Ziel als Text) in die Liste umwandeln */
export function notifyTargets(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Ein Nachrichtenziel in Home Assistant */
export interface NotifyService {
  /** Wert für maintenanceNotify */
  value: string;
  /** z.B. „Galaxy S25+ (Home Assistant)“ */
  label: string;
  /** app = Companion App, telegram = Chat der Integration „Telegram bot“ */
  kind: 'app' | 'telegram';
}

const byPosition = (a: StorageLocation, b: StorageLocation) =>
  a.position - b.position || a.id - b.id;

/** Kinder eines Platzes (null = oberste Ebene), sortiert */
export function storageChildren(
  locations: StorageLocation[],
  parentId: number | null,
): StorageLocation[] {
  return locations.filter((l) => l.parentId === parentId).sort(byPosition);
}

/** Alle Plätze in Baum-Reihenfolge mit Tiefe und vollem Pfad („Wandregal › Links“) */
export function storageTree(
  locations: StorageLocation[],
): { location: StorageLocation; depth: number; path: string }[] {
  const out: { location: StorageLocation; depth: number; path: string }[] = [];
  const seen = new Set<number>();
  const walk = (parentId: number | null, depth: number, prefix: string) => {
    for (const location of storageChildren(locations, parentId)) {
      if (seen.has(location.id)) continue;
      seen.add(location.id);
      const path = prefix ? `${prefix} › ${location.name}` : location.name;
      out.push({ location, depth, path });
      walk(location.id, depth + 1, path);
    }
  };
  walk(null, 0, '');
  return out;
}

/** Pfad je Platz-ID, z.B. für Anzeige an der Spule */
export function storagePaths(locations: StorageLocation[]): Map<number, string> {
  return new Map(storageTree(locations).map((t) => [t.location.id, t.path]));
}

/** IDs eines Platzes und aller darunterliegenden Plätze */
export function storageSubtree(locations: StorageLocation[], id: number): Set<number> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of locations) {
      if (l.parentId !== null && ids.has(l.parentId) && !ids.has(l.id)) {
        ids.add(l.id);
        grew = true;
      }
    }
  }
  return ids;
}
