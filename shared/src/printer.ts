// Live-Status von Druckern aus Home Assistant: Bambu Lab (Integration „bambu_lab“) und
// Klipper (Integration „moonraker“).

/** Ein Entity-Zustand, wie ihn der Server per Template aus Home Assistant holt */
export interface HaEntity {
  entityId: string;
  state: string | null;
  attributes: Record<string, unknown>;
  deviceId: string | null;
  /** Übergeordnetes Gerät – AMS und externe Spule hängen am Drucker */
  viaDeviceId: string | null;
  deviceName: string | null;
  model: string | null;
  /** Von welcher Home-Assistant-Verbindung (Standort) die Entity stammt */
  connectionId?: number;
  /** Integration: „bambu_lab“ (Standard, auch wenn es fehlt) oder „moonraker“ (Klipper) */
  platform?: string;
}

/** Welche Art Drucker hinter einem Gerät steckt */
export type PrinterKind = 'bambu' | 'klipper';

/** Ein in Home Assistant gefundener Drucker (zur Auswahl beim Verknüpfen) */
export interface HaPrinterDevice {
  id: string;
  name: string;
  model: string;
  /** Standort-Name der Verbindung, z.B. „Zuhause“ */
  location?: string;
}

export const PRINT_STATES = [
  'idle',
  'prepare',
  'slicing',
  'init',
  'running',
  'pause',
  'finish',
  'failed',
  'offline',
  'unknown',
] as const;
export type PrintState = (typeof PRINT_STATES)[number];

export const PRINT_STATE_LABELS: Record<PrintState, string> = {
  idle: 'Bereit',
  prepare: 'Bereitet vor',
  slicing: 'Slicen',
  init: 'Startet',
  running: 'Druckt',
  pause: 'Pausiert',
  finish: 'Fertig',
  failed: 'Abgebrochen',
  offline: 'Offline',
  unknown: 'Unbekannt',
};

/** Solange ein Auftrag in einem dieser Zustände ist, läuft er noch */
export const ACTIVE_PRINT_STATES: readonly PrintState[] = ['prepare', 'init', 'running', 'pause'];

/** Ein Filament-Platz: AMS-Slot oder externe Spule */
export interface AmsSlot {
  entityId: string;
  /** „A1“ … „A4“ (AMS 1–4, Slot 1–4) oder „Extern“ */
  label: string;
  name: string | null;
  type: string | null;
  /** Farbe als #rrggbb */
  color: string | null;
  /** Restmenge laut Drucker in % (nur Bambu-Spulen mit RFID), sonst null */
  remain: number | null;
  /** Spulengewicht laut RFID in g (meist 1000), sonst null */
  weightG: number | null;
  empty: boolean;
  active: boolean;
}

export interface PrinterLive {
  kind: PrinterKind;
  online: boolean;
  state: PrintState;
  stateLabel: string;
  /** 0–100 */
  progress: number | null;
  remainingMin: number | null;
  /** Voraussichtliches Ende (ISO) */
  endTime: string | null;
  startTime: string | null;
  layer: number | null;
  totalLayers: number | null;
  nozzleTemp: number | null;
  nozzleTarget: number | null;
  bedTemp: number | null;
  bedTarget: number | null;
  taskName: string | null;
  /** Gewicht des aktuellen bzw. letzten Auftrags in g */
  weightG: number | null;
  /** Druckraumbeleuchtung, null = nicht vorhanden */
  light: boolean | null;
  /** Stand des Vorschaubilds (ändert sich mit dem Auftrag), null = keins */
  coverVersion: string | null;
  /** Welche Steuer-Knöpfe gerade gehen (HA meldet sie sonst als „unavailable“) */
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
  /** Aktuelle Geschwindigkeitsstufe; null = Drucker meldet keine (z.B. im Leerlauf) */
  speed: PrintSpeed | null;
  /** Klipper: Geschwindigkeitsfaktor in % (statt Stufen); null bei Bambu */
  speedPercent: number | null;
  canSetSpeed: boolean;
  /** Klipper: im laufenden Auftrag verbrauchtes Filament in Metern; null bei Bambu */
  filamentUsedM: number | null;
  /** Teile auf der Druckplatte des aktuellen Auftrags */
  objects: PrintObject[];
  /** Überspringen geht nur während eines Drucks und solange danach noch ein Teil übrig bleibt */
  canSkip: boolean;
  /** Stand des Plattenbilds mit markierten Teilen, null = keins */
  plateVersion: string | null;
  ams: AmsSlot[];
}

export const PRINT_SPEEDS = ['silent', 'standard', 'sport', 'ludicrous'] as const;
export type PrintSpeed = (typeof PRINT_SPEEDS)[number];

/** Bambu-Stufen mit ihrem Tempo relativ zu Standard */
export const PRINT_SPEED_LABELS: Record<PrintSpeed, { label: string; percent: number }> = {
  silent: { label: 'Leise', percent: 50 },
  standard: { label: 'Standard', percent: 100 },
  sport: { label: 'Sport', percent: 124 },
  ludicrous: { label: 'Ludicrous', percent: 166 },
};

/** Klipper: Stufen für den Geschwindigkeitsfaktor (der Drucker kann 0–200 %) */
export const KLIPPER_SPEED_PERCENTS = [50, 75, 100, 125, 150] as const;

export interface PrintObject {
  /** ID im Druckauftrag, für den Überspringen-Befehl */
  id: string;
  name: string;
  skipped: boolean;
}

/** Rollen der Entities eines Druckers; Endungen der Entity-IDs auf Deutsch und Englisch */
const ROLES = {
  state: ['sensor', ['druckstatus', 'print_status']],
  progress: ['sensor', ['druckfortschritt', 'print_progress']],
  remaining: ['sensor', ['verbleibende_zeit', 'remaining_time']],
  endTime: ['sensor', ['vrs_fertigstellung', 'endzeit', 'end_time']],
  startTime: ['sensor', ['startzeit', 'start_time']],
  layer: ['sensor', ['aktuelle_schicht', 'current_layer']],
  totalLayers: ['sensor', ['gesamtzahl_der_schichten', 'total_layer_count']],
  nozzleTemp: ['sensor', ['temperatur_der_duse', 'nozzle_temperature']],
  nozzleTarget: ['sensor', ['zieltemperatur_der_duse', 'nozzle_target_temperature']],
  bedTemp: ['sensor', ['druckbetttemperatur', 'bed_temperature']],
  bedTarget: ['sensor', ['zieltemperatur_des_druckbett', 'target_bed_temperature']],
  taskName: ['sensor', ['name_der_aufgabe', 'task_name']],
  weight: ['sensor', ['gewicht_des_drucks', 'print_weight']],
  online: ['binary_sensor', ['online']],
  cover: ['image', ['titelbild', 'cover_image']],
  light: ['light', ['druckraumbeleuchtung', 'chamber_light']],
  pause: ['button', ['druckvorgang_anhalten', 'pause_printing', 'pause']],
  resume: ['button', ['druckvorgang_fortsetzen', 'resume_printing', 'resume']],
  stop: ['button', ['druckvorgang_beenden', 'stop_printing', 'stop']],
  speed: ['select', ['druckgeschwindigkeit', 'printing_speed', 'print_speed']],
  objects: ['sensor', ['druckbare_objekte', 'printable_objects']],
  skipped: ['sensor', ['ubersprungene_objekte', 'skipped_objects']],
  plate: ['image', ['bild_wahlen', 'pick_image']],
} as const satisfies Record<string, readonly [string, readonly string[]]>;

export type PrinterRole = keyof typeof ROLES;

/**
 * Klipper über die Moonraker-Integration: deren Entity-Namen sind immer englisch (keine
 * Übersetzungen), z.B. sensor.a20_current_print_state. Gleiche Rollennamen wie bei Bambu, damit
 * Steuerung und Bilder auf dem Server gleich funktionieren.
 */
const KLIPPER_ROLES = {
  state: ['sensor', ['current_print_state']],
  printerState: ['sensor', ['printer_state']],
  progress: ['sensor', ['progress']],
  remaining: ['sensor', ['print_time_left']],
  endTime: ['sensor', ['print_eta']],
  layer: ['sensor', ['current_layer']],
  totalLayers: ['sensor', ['total_layer']],
  nozzleTemp: ['sensor', ['extruder_temperature']],
  nozzleTarget: ['number', ['extruder_target']],
  bedTemp: ['sensor', ['bed_temperature']],
  bedTarget: ['number', ['bed_target']],
  taskName: ['sensor', ['filename']],
  filamentUsed: ['sensor', ['filament_used']],
  cover: ['camera', ['thumbnail']],
  pause: ['button', ['pause_print']],
  resume: ['button', ['resume_print']],
  stop: ['button', ['cancel_print']],
  speed: ['number', ['speed_factor']],
} as const satisfies Record<string, readonly [string, readonly string[]]>;

export type KlipperRole = keyof typeof KLIPPER_ROLES;

/** Klipper-Druckstatus (print_stats.state) → gemeinsamer Druckstatus */
const KLIPPER_STATES: Record<string, PrintState> = {
  standby: 'idle',
  printing: 'running',
  paused: 'pause',
  complete: 'finish',
  cancelled: 'failed',
  error: 'failed',
};

const UNSET = new Set(['unknown', 'unavailable', 'none', '']);

/** Alle Entities, die zu einem Drucker gehören – auch die seines AMS und der externen Spule */
export function entitiesOfPrinter(entities: HaEntity[], deviceId: string): HaEntity[] {
  return entities.filter((e) => e.deviceId === deviceId || e.viaDeviceId === deviceId);
}

/** Drucker unter den Geräten (Bambu und Klipper): alles, was nicht an einem anderen Gerät hängt */
export function findPrinterDevices(entities: HaEntity[]): HaPrinterDevice[] {
  const devices = new Map<string, HaPrinterDevice>();
  for (const e of entities) {
    if (!e.deviceId || e.viaDeviceId || devices.has(e.deviceId)) continue;
    devices.set(e.deviceId, {
      id: e.deviceId,
      name: e.deviceName ?? e.deviceId,
      model: e.model ?? '',
    });
  }
  return [...devices.values()];
}

/** Bambu oder Klipper – an der Integration der Entities des Geräts erkannt */
export function printerKind(entities: HaEntity[], deviceId: string): PrinterKind {
  return entities.some((e) => e.deviceId === deviceId && e.platform === 'moonraker')
    ? 'klipper'
    : 'bambu';
}

/** Entity-ID je Rolle (z.B. der „Pause“-Knopf), damit der Server Befehle schicken kann */
export function printerRoles(
  entities: HaEntity[],
  deviceId: string,
): Partial<Record<PrinterRole | KlipperRole, string>> {
  const own = entities.filter((e) => e.deviceId === deviceId);
  const table: Record<string, readonly [string, readonly string[]]> =
    printerKind(entities, deviceId) === 'klipper' ? KLIPPER_ROLES : ROLES;
  const roles: Partial<Record<PrinterRole | KlipperRole, string>> = {};
  for (const [role, [domain, suffixes]] of Object.entries(table)) {
    // Mit Unterstrich davor, sonst passt „temperatur_der_duse“ auch auf „zieltemperatur_der_duse“
    const match = own.find(
      (e) =>
        e.entityId.startsWith(`${domain}.`) &&
        suffixes.some((s) => e.entityId.endsWith(`_${s}`) || e.entityId === `${domain}.${s}`),
    );
    if (match) roles[role as PrinterRole | KlipperRole] = match.entityId;
  }
  return roles;
}

function num(value: string | null | undefined): number | null {
  if (value === null || value === undefined || UNSET.has(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: string | null | undefined): string | null {
  return value === null || value === undefined || UNSET.has(value) ? null : value;
}

/** Bambu liefert Farben als #RRGGBBAA */
function color(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-f]{6}/i.test(value)
    ? value.slice(0, 7).toLowerCase()
    : null;
}

/** AMS-Slots und externe Spule – erkannt an ihren Attributen, unabhängig von der Sprache */
function amsSlots(entities: HaEntity[]): AmsSlot[] {
  const amsIds = [
    ...new Set(
      entities.filter((e) => typeof e.attributes.slot === 'number').map((e) => e.deviceId),
    ),
  ].sort((a, b) => String(a).localeCompare(String(b)));
  return entities
    .filter((e) => e.entityId.startsWith('sensor.') && 'tray_uuid' in e.attributes)
    .map((e) => {
      const a = e.attributes;
      const slot = typeof a.slot === 'number' ? a.slot : null;
      // AMS-Nummer aus dem Gerätenamen („…_AMS_2“), sonst nach Reihenfolge
      const amsNo =
        Number(/ams[_\s]?(\d)/i.exec(e.deviceName ?? '')?.[1]) || amsIds.indexOf(e.deviceId) + 1;
      const empty = a.empty === true;
      const remain = typeof a.remain === 'number' && a.remain >= 0 ? a.remain : null;
      return {
        entityId: e.entityId,
        label: slot === null ? 'Extern' : `${String.fromCharCode(64 + amsNo)}${slot}`,
        name: empty ? null : text(typeof a.name === 'string' ? a.name : null),
        type: empty ? null : text(typeof a.type === 'string' ? a.type : null),
        color: empty ? null : color(a.color),
        remain: empty ? null : remain,
        weightG: empty
          ? null
          : num(a.tray_weight === undefined ? null : String(a.tray_weight)) || null,
        empty,
        active: a.active === true,
      };
    })
    .filter((s) => s.label !== 'Extern' || !s.empty || s.active)
    .sort((a, b) =>
      a.label === 'Extern' ? 1 : b.label === 'Extern' ? -1 : a.label.localeCompare(b.label),
    );
}

/** Dauer in Minuten aus einem Sensor mit Einheit h, min oder s (ohne Einheit: Minuten) */
function minutes(entity: HaEntity | undefined): number | null {
  const n = num(entity?.state);
  if (n === null) return null;
  const unit = entity?.attributes.unit_of_measurement;
  return Math.round(unit === 'h' ? n * 60 : unit === 's' ? n / 60 : n);
}

/** Macht aus den Home-Assistant-Entities eines Druckers einen übersichtlichen Live-Status */
export function parsePrinterLive(entities: HaEntity[], deviceId: string): PrinterLive {
  if (printerKind(entities, deviceId) === 'klipper') return parseKlipperLive(entities, deviceId);
  const mine = entitiesOfPrinter(entities, deviceId);
  const roles = printerRoles(mine, deviceId);
  const byId = new Map(mine.map((e) => [e.entityId, e]));
  const get = (role: PrinterRole) => (roles[role] ? byId.get(roles[role]!) : undefined);
  const value = (role: PrinterRole) => get(role)?.state ?? null;

  const online = value('online') !== 'off';
  const raw = (text(value('state')) ?? 'unknown').toLowerCase();
  const state: PrintState = !online
    ? 'offline'
    : (PRINT_STATES as readonly string[]).includes(raw)
      ? (raw as PrintState)
      : 'unknown';
  const usable = (role: PrinterRole) => {
    const s = value(role);
    return s !== null && s !== 'unavailable';
  };
  const light = value('light');
  const objects = printObjects(get('objects'), get('skipped'));

  return {
    kind: 'bambu',
    online,
    state,
    stateLabel: PRINT_STATE_LABELS[state],
    progress: num(value('progress')),
    remainingMin: num(value('remaining')),
    endTime: text(value('endTime')),
    startTime: text(value('startTime')),
    layer: num(value('layer')),
    totalLayers: num(value('totalLayers')),
    nozzleTemp: num(value('nozzleTemp')),
    nozzleTarget: num(value('nozzleTarget')),
    bedTemp: num(value('bedTemp')),
    bedTarget: num(value('bedTarget')),
    taskName: text(value('taskName')),
    weightG: num(value('weight')),
    light: light === 'on' ? true : light === 'off' ? false : null,
    coverVersion: get('cover')?.attributes.entity_picture ? (text(value('cover')) ?? 'x') : null,
    canPause: usable('pause') && state === 'running',
    canResume: usable('resume') && state === 'pause',
    canStop: usable('stop') && (ACTIVE_PRINT_STATES as readonly string[]).includes(state),
    speed: (PRINT_SPEEDS as readonly string[]).includes(value('speed') ?? '')
      ? (value('speed') as PrintSpeed)
      : null,
    speedPercent: null,
    canSetSpeed: usable('speed') && (state === 'running' || state === 'pause'),
    filamentUsedM: null,
    objects,
    canSkip:
      (state === 'running' || state === 'pause') && objects.filter((o) => !o.skipped).length > 1,
    plateVersion: get('plate')?.attributes.entity_picture ? (text(value('plate')) ?? 'x') : null,
    ams: amsSlots(mine),
  };
}

/**
 * Klipper (Moonraker): Ohne AMS gibt es einen einzigen Platz „Spule“. Er steht für die Spule im
 * Drucker und lässt sich wie ein AMS-Slot mit einer Spule aus dem Bestand verknüpfen; als ID dient
 * der Sensor für den Filamentverbrauch.
 */
function parseKlipperLive(entities: HaEntity[], deviceId: string): PrinterLive {
  const mine = entitiesOfPrinter(entities, deviceId);
  const roles = printerRoles(mine, deviceId) as Partial<Record<KlipperRole, string>>;
  const byId = new Map(mine.map((e) => [e.entityId, e]));
  const get = (role: KlipperRole) => (roles[role] ? byId.get(roles[role]!) : undefined);
  const value = (role: KlipperRole) => get(role)?.state ?? null;
  const usable = (role: KlipperRole) => {
    const s = value(role);
    return s !== null && s !== 'unavailable';
  };

  // Nicht erreichbar: Home Assistant meldet die Sensoren als „unavailable“
  const online =
    usable('state') && !['shutdown', 'unavailable'].includes(value('printerState') ?? '');
  const raw = (text(value('state')) ?? '').toLowerCase();
  const state: PrintState = !online ? 'offline' : (KLIPPER_STATES[raw] ?? 'unknown');
  const printing = state === 'running' || state === 'pause';
  const filament = get('filamentUsed');
  const taskName = text(value('taskName'));

  return {
    kind: 'klipper',
    online,
    state,
    stateLabel: PRINT_STATE_LABELS[state],
    progress: num(value('progress')),
    remainingMin: minutes(get('remaining')),
    endTime: text(value('endTime')),
    startTime: null,
    layer: num(value('layer')),
    totalLayers: num(value('totalLayers')) || null,
    nozzleTemp: num(value('nozzleTemp')),
    nozzleTarget: num(value('nozzleTarget')),
    bedTemp: num(value('bedTemp')),
    bedTarget: num(value('bedTarget')),
    taskName,
    weightG: null,
    light: null,
    // Vorschaubild ändert sich mit der Datei
    coverVersion: get('cover')?.attributes.entity_picture && taskName ? taskName : null,
    canPause: usable('pause') && state === 'running',
    canResume: usable('resume') && state === 'pause',
    canStop: usable('stop') && printing,
    speed: null,
    speedPercent: usable('speed') ? num(value('speed')) : null,
    canSetSpeed: usable('speed') && printing,
    filamentUsedM: printing ? num(value('filamentUsed')) : null,
    objects: [],
    canSkip: false,
    plateVersion: null,
    ams: filament
      ? [
          {
            entityId: filament.entityId,
            label: 'Spule',
            name: null,
            type: null,
            color: null,
            remain: null,
            weightG: null,
            empty: false,
            active: state === 'running',
          },
        ]
      : [],
  };
}

/** Dichte in g/cm³ je Filamenttyp (Anfang des Namens), für Meter → Gramm */
const DENSITIES: [string, number][] = [
  ['pctg', 1.23],
  ['petg', 1.27],
  ['pet', 1.27],
  ['pla', 1.24],
  ['abs', 1.04],
  ['asa', 1.07],
  ['tpu', 1.21],
  ['tpe', 1.2],
  ['pa', 1.14],
  ['nylon', 1.14],
  ['pc', 1.2],
  ['pva', 1.23],
  ['pvb', 1.08],
  ['pp', 0.9],
  ['hips', 1.04],
];

/** Gewicht eines Filamentstücks: Länge × Querschnitt × Dichte (unbekannter Typ: wie PLA) */
export function filamentGrams(meters: number, diameterMm: number, typeName?: string | null) {
  const name = (typeName ?? '').trim().toLowerCase();
  const density = DENSITIES.find(([prefix]) => name.startsWith(prefix))?.[1] ?? 1.24;
  // m × mm² = cm³ (1000 mm × mm² / 1000)
  const cm3 = meters * Math.PI * (diameterMm / 2) ** 2;
  return Math.round(cm3 * density * 10) / 10;
}

/** Teile des Auftrags: „objects“ ist {id: name}, übersprungene kommen als Liste von IDs */
function printObjects(printable?: HaEntity, skipped?: HaEntity): PrintObject[] {
  const raw = printable?.attributes.objects;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const skippedRaw = skipped?.attributes.objects;
  const done = new Set(
    (Array.isArray(skippedRaw) ? skippedRaw : Object.keys(skippedRaw ?? {})).map(String),
  );
  return Object.entries(raw as Record<string, unknown>).map(([id, name]) => ({
    id,
    name: typeof name === 'string' && name ? name : `Teil ${id}`,
    skipped: done.has(id),
  }));
}

/** Automatisch vom Server gebuchter Filamentverbrauch eines Druckauftrags */
export interface FilamentBooking {
  id: number;
  spoolId: number;
  printerId: number | null;
  grams: number;
  jobName: string | null;
  jobKey: string;
  /** Geschätzt: mehrere Slots (nach Zeitanteil aufgeteilt) oder abgebrochener Druck */
  estimated: boolean;
  createdAt: string;
}

/** Antwort von GET /api/printers/:id/live */
export type PrinterLiveResponse =
  | { status: 'unconfigured' }
  | { status: 'unlinked' }
  | { status: 'error'; error: string }
  | { status: 'ok'; live: PrinterLive };

/** Verbindungsstand zu Home Assistant (der Token selbst verlässt den Server nie) */
/** Eine Home-Assistant-Verbindung (Standort), wie sie der Browser sieht */
export interface HaConnectionStatus {
  id: number;
  name: string;
  /** Teilweise unkenntlich gemacht – die volle Adresse und der Token bleiben auf dem Server */
  url: string;
  /** Das eigene Home Assistant der HA-App (Adresse und Token vom Supervisor) */
  local: boolean;
  ok: boolean;
  error?: string;
  version?: string;
  printers: HaPrinterDevice[];
}

export interface HaStatus {
  connections: HaConnectionStatus[];
}

/**
 * Adresse für die Anzeige teilweise unkenntlich machen: vom ersten Namensteil bleiben drei
 * Zeichen, bei IP-Adressen die ersten beiden Blöcke. Domain und Port bleiben zur Orientierung.
 * „https://abcdefg….ui.nabu.casa“ → „https://abc•••.ui.nabu.casa“
 */
export function maskUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return '•••';
  }
  const host = url.hostname;
  const masked = /^\d+\.\d+\.\d+\.\d+$/.test(host)
    ? host.split('.').slice(0, 2).concat('•', '•').join('.')
    : [`${host.split('.')[0].slice(0, 3)}•••`, ...host.split('.').slice(1)].join('.');
  return `${url.protocol}//${masked}${url.port ? `:${url.port}` : ''}`;
}

export const PRINTER_ACTIONS = ['pause', 'resume', 'stop', 'light_on', 'light_off'] as const;
export type PrinterAction = (typeof PRINTER_ACTIONS)[number];
