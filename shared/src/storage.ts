// Lagerplätze für Filament: ein Baum wie „Wandregal › Links › Reihe 2“.

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
}

export const DEFAULT_SETTINGS: AppSettings = { storageLocations: false };

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
