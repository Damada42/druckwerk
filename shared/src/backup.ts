// Backup in Gruppen: beim Sichern und beim Einspielen einzeln wählbar.

export const BACKUP_GROUPS = [
  'projects',
  'customers',
  'team',
  'filament',
  'storage',
  'printers',
  'company',
  'settings',
] as const;
export type BackupGroup = (typeof BACKUP_GROUPS)[number];

export const BACKUP_GROUP_LABELS: Record<BackupGroup, string> = {
  projects: 'Projekte',
  customers: 'Kunden',
  team: 'Team',
  filament: 'Filament',
  storage: 'Lager',
  printers: 'Drucker',
  company: 'Firmendaten',
  settings: 'Einstellungen',
};

/** Was zu einer Gruppe gehört */
export const BACKUP_GROUP_HINTS: Record<BackupGroup, string> = {
  projects: 'mit Filament, Kosten, Belegen, Angeboten und Rechnungen',
  customers: 'Kundenliste',
  team: 'Personen im Team',
  filament: 'Spulen, Typen, Hersteller, Finishes, gemerkte Barcodes, Abbuchungen',
  storage: 'Lagerplätze',
  printers: 'mit Kameras und Home-Assistant-Verbindungen',
  company: 'Firmenprofil für Angebote und Rechnungen, Logo',
  settings: 'Schalter, Mindestmengen-Gruppierung, Kostenkategorien',
};

/** Einheit für die Anzahl im Backup (Einzahl, Mehrzahl); ohne Angabe: vorhanden/leer */
export const BACKUP_GROUP_UNITS: Partial<Record<BackupGroup, [string, string]>> = {
  projects: ['Projekt', 'Projekte'],
  customers: ['Kunde', 'Kunden'],
  team: ['Person', 'Personen'],
  filament: ['Spule', 'Spulen'],
  storage: ['Lagerplatz', 'Lagerplätze'],
  printers: ['Drucker', 'Drucker'],
};

/** Inhalt eines hochgeladenen Backups, bevor es eingespielt wird */
export interface BackupInfo {
  /** Kennung des zwischengespeicherten Backups für das Einspielen */
  token: string;
  createdAt: string | null;
  /** Gruppen, die im Backup enthalten sind, mit Anzahl der Einträge */
  groups: { group: BackupGroup; count: number }[];
}

export interface BackupRestoreResult {
  ok: true;
  groups: BackupGroup[];
  /** Verweise auf Einträge, die es nach dem Einspielen nicht mehr gibt (geleert oder entfernt) */
  fixed: number;
}
