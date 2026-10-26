// Live-Status von Bambu-Lab-Druckern aus Home Assistant (Integration „bambu_lab“).

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
}

/** Ein in Home Assistant gefundener Drucker (zur Auswahl beim Verknüpfen) */
export interface HaPrinterDevice {
  id: string;
  name: string;
  model: string;
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
  ams: AmsSlot[];
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
} as const satisfies Record<string, readonly [string, readonly string[]]>;

export type PrinterRole = keyof typeof ROLES;

const UNSET = new Set(['unknown', 'unavailable', 'none', '']);

/** Alle Entities, die zu einem Drucker gehören – auch die seines AMS und der externen Spule */
export function entitiesOfPrinter(entities: HaEntity[], deviceId: string): HaEntity[] {
  return entities.filter((e) => e.deviceId === deviceId || e.viaDeviceId === deviceId);
}

/** Drucker unter den Bambu-Geräten: alles, was nicht an einem anderen Gerät hängt */
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

/** Entity-ID je Rolle (z.B. der „Pause“-Knopf), damit der Server Befehle schicken kann */
export function printerRoles(
  entities: HaEntity[],
  deviceId: string,
): Partial<Record<PrinterRole, string>> {
  const own = entities.filter((e) => e.deviceId === deviceId);
  const roles: Partial<Record<PrinterRole, string>> = {};
  for (const [role, [domain, suffixes]] of Object.entries(ROLES)) {
    // Mit Unterstrich davor, sonst passt „temperatur_der_duse“ auch auf „zieltemperatur_der_duse“
    const match = own.find(
      (e) =>
        e.entityId.startsWith(`${domain}.`) &&
        suffixes.some((s) => e.entityId.endsWith(`_${s}`) || e.entityId === `${domain}.${s}`),
    );
    if (match) roles[role as PrinterRole] = match.entityId;
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

/** Macht aus den Home-Assistant-Entities eines Druckers einen übersichtlichen Live-Status */
export function parsePrinterLive(entities: HaEntity[], deviceId: string): PrinterLive {
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

  return {
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
    ams: amsSlots(mine),
  };
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
export interface HaSettings {
  url: string | null;
  hasToken: boolean;
}

export interface HaStatus extends HaSettings {
  ok: boolean;
  error?: string;
  version?: string;
  printers: HaPrinterDevice[];
}

export const PRINTER_ACTIONS = ['pause', 'resume', 'stop', 'light_on', 'light_off'] as const;
export type PrinterAction = (typeof PRINTER_ACTIONS)[number];
