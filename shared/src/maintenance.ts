// Ersatzteile und Wartung: Wartungspunkte je Drucker mit Intervall in Betriebsstunden und/oder
// Monaten. Der Zähler eines Punkts ist der Betriebsstundenstand des Druckers seit dem letzten
// Zurücksetzen (baseHours).

export interface SparePart {
  id: number;
  name: string;
  manufacturer: string | null;
  /** Artikelnummer des Herstellers bzw. Shops */
  partNumber: string | null;
  shopUrl: string | null;
  price: number | null;
  /** Stück auf Lager */
  stockQty: number;
  /** Ab weniger Stück gilt das Teil als knapp; 0 = keine Warnung */
  minStock: number;
  storageLocationId: number | null;
  /** Druckermodelle, für die das Teil passt */
  modelIds: number[];
  notes: string | null;
  createdAt: string;
}

export const MAINTENANCE_KINDS = ['replace', 'clean', 'lube', 'check'] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];

export const MAINTENANCE_KIND_LABELS: Record<MaintenanceKind, string> = {
  replace: 'Tauschen',
  clean: 'Reinigen',
  lube: 'Schmieren',
  check: 'Prüfen',
};

export const MAINTENANCE_LEVELS = ['ok', 'soon', 'due'] as const;
export type MaintenanceLevel = (typeof MAINTENANCE_LEVELS)[number];

export const MAINTENANCE_LEVEL_LABELS: Record<MaintenanceLevel, string> = {
  ok: 'In Ordnung',
  soon: 'Bald fällig',
  due: 'Fällig',
};

export interface MaintenanceTask {
  id: number;
  printerId: number;
  name: string;
  kind: MaintenanceKind;
  /** Benötigtes Ersatzteil (beim Tauschen wird es vom Lager abgebucht) */
  partId: number | null;
  partQty: number;
  intervalHours: number | null;
  intervalMonths: number | null;
  /** Vorwarnung in Stunden; null = Vorgabe aus den Einstellungen */
  warnHours: number | null;
  /** Betriebsstunden des Druckers beim letzten Zurücksetzen */
  baseHours: number;
  /** Zuletzt erledigt (YYYY-MM-DD); Startpunkt für das Intervall in Monaten */
  lastDoneAt: string | null;
  /** Bis zu welcher Stufe schon eine Push-Nachricht verschickt wurde */
  notifiedLevel: MaintenanceLevel | null;
  /** Zeitpunkt der letzten Nachricht (für Erinnerungen) */
  notifiedAt: string | null;
  notes: string | null;
  position: number;
  createdAt: string;
}

/** Neuer Wartungspunkt: statt baseHours der aktuelle Stand des Zählers (Standard 0) */
export type MaintenanceTaskInput = Omit<
  MaintenanceTask,
  'id' | 'createdAt' | 'baseHours' | 'notifiedLevel' | 'notifiedAt' | 'position'
> & { currentHours?: number };

/** Ein Punkt einer erledigten Wartung, mit dem Stand davor (für Rückgängig) */
export interface MaintenanceLogItem {
  taskId: number;
  name: string;
  kind: MaintenanceKind;
  partId: number | null;
  partName: string | null;
  /** Vom Lager abgebuchte Stück */
  booked: number;
  /** Stunden des Punkts beim Zurücksetzen */
  usedHours: number;
  prevBaseHours: number;
  prevLastDoneAt: string | null;
}

export interface MaintenanceLogEntry {
  id: number;
  printerId: number;
  /** YYYY-MM-DD */
  doneAt: string;
  printerHours: number;
  note: string | null;
  items: MaintenanceLogItem[];
  createdAt: string;
}

/** Antwort von POST /printers/:id/maintenance */
export interface MaintenanceDoneResult {
  entry: MaintenanceLogEntry;
  /** Teile, von denen weniger auf Lager waren als gebraucht */
  missing: { partId: number; name: string; needed: number; booked: number }[];
}

export interface MaintenanceDefaults {
  warnHours: number;
  warnDays: number;
}

export interface TaskStatus {
  /** Stunden seit dem letzten Zurücksetzen */
  usedHours: number;
  /** Stunden bis fällig (negativ = überfällig); null = kein Stundenintervall */
  remainingHours: number | null;
  /** Fällig am (YYYY-MM-DD); null = kein Monatsintervall */
  dueDate: string | null;
  /** Tage bis zum Datum (negativ = überfällig); null = kein Monatsintervall */
  remainingDays: number | null;
  /** Anteil des Intervalls, der verbraucht ist (das knappere der beiden), 0 … >1 */
  progress: number;
  level: MaintenanceLevel;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Datum als YYYY-MM-DD (lokale Zeit wäre auf dem Server UTC – daher überall UTC) */
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** YYYY-MM-DD plus Monate; der 31. wird im kürzeren Monat zum Monatsletzten */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const whole = Math.floor(months);
  const target = new Date(Date.UTC(y, m - 1 + whole, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  // Bruchteile eines Monats als Tage (z.B. 1,5 Monate)
  const extra = Math.round((months - whole) * 30);
  return isoDate(new Date(target.getTime() + extra * DAY_MS));
}

/** Stand eines Wartungspunkts beim Betriebsstundenstand printerHours */
export function taskStatus(
  task: Pick<
    MaintenanceTask,
    'intervalHours' | 'intervalMonths' | 'warnHours' | 'baseHours' | 'lastDoneAt'
  >,
  printerHours: number,
  now: Date,
  defaults: MaintenanceDefaults,
): TaskStatus {
  const usedHours = Math.max(0, Math.round((printerHours - task.baseHours) * 100) / 100);
  const warnHours = task.warnHours ?? defaults.warnHours;
  const remainingHours = task.intervalHours
    ? Math.round((task.intervalHours - usedHours) * 100) / 100
    : null;
  const dueDate =
    task.intervalMonths && task.lastDoneAt ? addMonths(task.lastDoneAt, task.intervalMonths) : null;
  const today = Date.parse(`${isoDate(now)}T00:00:00Z`);
  const remainingDays = dueDate
    ? Math.round((Date.parse(`${dueDate}T00:00:00Z`) - today) / DAY_MS)
    : null;

  const shares: number[] = [];
  if (task.intervalHours) shares.push(usedHours / task.intervalHours);
  if (dueDate && task.lastDoneAt) {
    const span = Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${task.lastDoneAt}T00:00:00Z`);
    shares.push(span > 0 ? (today - Date.parse(`${task.lastDoneAt}T00:00:00Z`)) / span : 1);
  }
  const progress = Math.max(0, ...shares);

  const due =
    (remainingHours !== null && remainingHours <= 0) ||
    (remainingDays !== null && remainingDays <= 0);
  const soon =
    (remainingHours !== null && remainingHours <= warnHours) ||
    (remainingDays !== null && remainingDays <= defaults.warnDays);
  return {
    usedHours,
    remainingHours,
    dueDate,
    remainingDays,
    progress,
    level: due ? 'due' : soon ? 'soon' : 'ok',
  };
}

/** Ein fälliger oder bald fälliger Punkt mit dem benötigten Teil und dessen Lagerstand */
export interface DueTask {
  printerId: number;
  printerName: string;
  task: MaintenanceTask;
  status: TaskStatus;
  part: SparePart | null;
  /** Stück, die fehlen (benötigt − auf Lager), 0 = genug da */
  missing: number;
}

/** Alle Punkte, die bald oder jetzt fällig sind – Fällige zuerst, dann nach Dringlichkeit */
export function dueMaintenance(
  printers: { id: number; name: string; operatingHours: number }[],
  tasks: MaintenanceTask[],
  parts: SparePart[],
  now: Date,
  defaults: MaintenanceDefaults,
): DueTask[] {
  const out: DueTask[] = [];
  for (const task of tasks) {
    const printer = printers.find((p) => p.id === task.printerId);
    if (!printer) continue;
    const status = taskStatus(task, printer.operatingHours, now, defaults);
    if (status.level === 'ok') continue;
    const part = parts.find((p) => p.id === task.partId) ?? null;
    out.push({
      printerId: printer.id,
      printerName: printer.name,
      task,
      status,
      part,
      missing: part ? Math.max(0, task.partQty - part.stockQty) : 0,
    });
  }
  const rank = (d: DueTask) => (d.status.level === 'due' ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || b.status.progress - a.status.progress);
}

/** Ersatzteile unter ihrem Mindestbestand */
export function lowParts(parts: SparePart[]): SparePart[] {
  return parts.filter((p) => p.minStock > 0 && p.stockQty < p.minStock);
}

/** „in 120 h“ / „seit 3 h überfällig“ bzw. „in 5 Tagen“ für Anzeige und Push */
export function describeRemaining(status: TaskStatus): string {
  const parts: string[] = [];
  const h = status.remainingHours;
  if (h !== null) {
    const v = Math.abs(Math.round(h)).toLocaleString('de-AT');
    parts.push(h > 0 ? `noch ${v} h` : h === 0 ? 'jetzt' : `${v} h überfällig`);
  }
  const d = status.remainingDays;
  if (d !== null)
    parts.push(
      d > 0
        ? `noch ${d} ${d === 1 ? 'Tag' : 'Tage'}`
        : d === 0
          ? 'heute'
          : `${-d} ${d === -1 ? 'Tag' : 'Tage'} überfällig`,
    );
  return parts.join(' · ');
}

/** Platzhalter im Mustertext der Wartungsnachricht */
export const MESSAGE_PLACEHOLDERS = {
  drucker: 'Name des Druckers',
  modell: 'Modell des Druckers',
  stufe: '„bald fällig“ oder „fällig“',
  anzahl: 'Anzahl der Wartungspunkte',
  punkte: 'Wartungspunkte mit Restzeit und Teil, je Zeile einer',
  stunden: 'Betriebsstunden des Druckers',
  fehlende_teile: 'Ersatzteile, die fehlen (leer, wenn alles da ist)',
} as const;
export type MessageVars = Record<keyof typeof MESSAGE_PLACEHOLDERS, string>;

/** Vorlagen für den Text der Wartungsnachricht */
export const MESSAGE_PRESETS = [
  { name: 'Standard', title: 'Wartung {stufe}: {drucker}', message: '{punkte}' },
  { name: 'Kurz', title: '🔧 {drucker}', message: '{anzahl} Wartungspunkt(e) {stufe}' },
  {
    name: 'Ausführlich',
    title: '🔧 Wartung {stufe}: {drucker} ({modell})',
    message: 'Betriebsstunden: {stunden} h\n{punkte}\n{fehlende_teile}',
  },
] as const;

/** Platzhalter wie {drucker} ersetzen; unbekannte bleiben stehen, leere Zeilen fallen weg */
export function renderMessage(template: string, vars: Partial<MessageVars>): string {
  return template
    .replace(/\{([a-z_]+)\}/g, (all, key: string) =>
      Object.hasOwn(vars, key) ? (vars[key as keyof MessageVars] ?? '') : all,
    )
    .split('\n')
    .filter((line) => line.trim() !== '')
    .join('\n');
}

/** Beispielwerte für Vorschau und Testnachricht */
export const SAMPLE_MESSAGE_VARS: MessageVars = {
  drucker: 'P1S',
  modell: 'Bambu Lab P1S',
  stufe: 'bald fällig',
  anzahl: '2',
  punkte:
    '• Düse tauschen (noch 120 h) – Hotend 0,4 mm: 1 auf Lager\n• Kohlenstoffstangen reinigen (noch 5 Tage)',
  stunden: (1880).toLocaleString('de-AT'),
  fehlende_teile: 'Fehlt: PTFE-Schlauch (1 Stück)',
};

/** Ein Punkt der Vorlage; fehlende Intervalle trägt der Benutzer beim Übernehmen ein */
export interface MaintenanceTemplateItem {
  name: string;
  kind: MaintenanceKind;
  intervalHours: number | null;
  intervalMonths: number | null;
  /** Bambus Empfehlung laut Wiki, als Hilfe beim Eintragen eines Intervalls */
  hint?: string;
  /** Benötigtes Teil (beim Übernehmen angelegt bzw. per Name und Hersteller wiederverwendet) */
  part?: { name: string; manufacturer: string; shopUrl: string | null };
}

/** Ersatzteile der P1-Serie im Bambu-Shop (so im Wiki verlinkt) */
const P1_SHOP = 'https://store.bambulab.com/collections/spare-parts-for-p1-series';

const bambuPart = (name: string, shopUrl = P1_SHOP) => ({
  name,
  manufacturer: 'Bambu Lab',
  shopUrl,
});

/**
 * Wartung der Bambu Lab P1-Serie (P1S, P1P) nach dem Bambu-Wiki „Wartungsempfehlung für Drucker
 * der Bambu Lab P1-Serie“ (wiki.bambulab.com/de/p1/maintenance/p1p-maintenance, Stand 11/2026).
 * Bambu gibt feste Intervalle nur in Monaten an; sonst nach Rollen Filament oder nach Zustand –
 * das steht im Hinweis, das Intervall trägt der Benutzer selbst ein. Teile-Links wie im Wiki.
 */
export const P1_TEMPLATE: MaintenanceTemplateItem[] = [
  {
    name: 'Kohlenstoffstangen X-Achse reinigen',
    kind: 'clean',
    intervalHours: null,
    intervalMonths: 1,
    hint: 'Bambu: einmal im Monat prüfen, mit IPA reinigen – kein Fett',
  },
  {
    name: 'Z-Gewindespindeln reinigen und fetten',
    kind: 'lube',
    intervalHours: null,
    intervalMonths: 3,
    hint: 'Bambu: alle drei Monate',
  },
  {
    name: 'Linearwellen Y/Z reinigen',
    kind: 'clean',
    intervalHours: null,
    intervalMonths: 1,
    hint: 'Bambu: einmal im Monat; bei ABS/ASA alle 5 Rollen',
  },
  {
    name: 'Linearwellen Y/Z Rostschutz (dünn ölen)',
    kind: 'lube',
    intervalHours: null,
    intervalMonths: 3,
    hint: 'Bambu: alle drei Monate',
  },
  {
    name: 'Lüfter (Bauteil- und Hotend-Lüfter) prüfen',
    kind: 'clean',
    intervalHours: null,
    intervalMonths: null,
    hint: 'Bambu: jede Woche, mit Druckluft',
  },
  {
    name: 'Filamentschneider-Klinge prüfen',
    kind: 'replace',
    intervalHours: null,
    intervalMonths: null,
    hint: 'Bambu: alle 3–5 Rollen, bei abrasivem Filament nach 1–2 Rollen',
    part: bambuPart(
      'Filamentschneider-Klinge',
      'https://us.store.bambulab.com/products/replacement-filament-cutter',
    ),
  },
  {
    name: 'PTFE-Schlauch prüfen',
    kind: 'replace',
    intervalHours: null,
    intervalMonths: null,
    hint: 'Bambu: nach etwa 10 Rollen, bei abrasivem Filament nach 5',
    part: bambuPart('PTFE-Schlauch'),
  },
  {
    name: 'Extruder reinigen',
    kind: 'clean',
    intervalHours: null,
    intervalMonths: null,
    hint: 'Bambu: wenn Staub am gelben Zahnrad sichtbar ist',
  },
  {
    name: 'Düse reinigen',
    kind: 'clean',
    intervalHours: null,
    intervalMonths: null,
    hint: 'Bambu: bei Verschmutzung oder Unterextrusion, mit Kohlefaser regelmäßig',
  },
  {
    name: 'Düsenwischer tauschen',
    kind: 'replace',
    intervalHours: null,
    intervalMonths: null,
    hint: 'Bambu: vor jedem Druck prüfen, bei Schaden tauschen',
    part: bambuPart('Düsenwischer', 'https://us.store.bambulab.com/products/nozzle-wiper'),
  },
  {
    name: 'Hotend-Silikonsocke tauschen',
    kind: 'replace',
    intervalHours: null,
    intervalMonths: null,
    hint: 'Bambu: bei Verschleiß oder wenn sie nicht mehr fest sitzt',
    part: bambuPart(
      'Hotend-Silikonsocke',
      'https://us.store.bambulab.com/products/silicone-sock-for-hotend',
    ),
  },
  {
    name: 'Hotend tauschen',
    kind: 'replace',
    intervalHours: null,
    intervalMonths: null,
    hint: 'Kein Intervall im Wiki – nach eigener Erfahrung',
    part: bambuPart('Hotend 0,4 mm'),
  },
  {
    name: 'Aktivkohlefilter tauschen (P1S)',
    kind: 'replace',
    intervalHours: null,
    intervalMonths: null,
    hint: 'Kein Intervall im Wiki – nach eigener Erfahrung',
    part: bambuPart('Aktivkohlefilter P1S'),
  },
];
/** Vorlage passend zum Druckermodell, z.B. „Bambu Lab P1S“; null = keine */
export function templateForModel(model: string): MaintenanceTemplateItem[] | null {
  return /\bP1[SP]\b/i.test(model) ? P1_TEMPLATE : null;
}
