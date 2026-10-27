// Kameras an Druckern: aus Home Assistant (camera.*) oder als direkter Stream (z.B. Crowsnest).

export const CAMERA_ROTATIONS = [0, 90, 180, 270] as const;
export type CameraRotation = (typeof CAMERA_ROTATIONS)[number];

/** Eine Kamera-Entity in Home Assistant (zur Auswahl beim Hinzufügen) */
export interface HaCamera {
  connectionId: number;
  /** Standort-Name der Verbindung */
  location: string;
  entityId: string;
  name: string;
  deviceId: string | null;
  deviceName: string | null;
  available: boolean;
}

export interface HaCameraList {
  cameras: HaCamera[];
  /** Nicht erreichbare Standorte */
  errors: string[];
}

/** Kamera eines Druckers, wie sie der Browser sieht */
export interface PrinterCamera {
  id: number;
  printerId: number;
  name: string;
  haConnectionId: number | null;
  entityId: string | null;
  /** Passwort in der Adresse ist durch „•••“ ersetzt */
  streamUrl: string | null;
  snapshotUrl: string | null;
  rotation: CameraRotation;
  position: number;
  /** Ein Standbild lässt sich abrufen (für Vorschaubilder) */
  hasSnapshot: boolean;
  createdAt: string;
}

/** Felder beim Anlegen/Ändern: entweder entityId + haConnectionId oder streamUrl */
export interface PrinterCameraInput {
  name?: string;
  haConnectionId?: number | null;
  entityId?: string | null;
  streamUrl?: string | null;
  snapshotUrl?: string | null;
  rotation?: number;
}

/** „http://user:geheim@host/…“ → „http://user:•••@host/…“, damit kein Passwort im Browser landet */
export function maskUrlPassword(raw: string): string {
  try {
    const url = new URL(raw);
    if (!url.password) return raw;
    url.password = '•••';
    return url.toString().replace('%E2%80%A2%E2%80%A2%E2%80%A2', '•••');
  } catch {
    return raw;
  }
}

/** Crowsnest/mjpg-streamer liefern das Standbild unter ?action=snapshot statt ?action=stream */
export function snapshotFromStream(streamUrl: string): string | null {
  return /[?&]action=stream\b/.test(streamUrl)
    ? streamUrl.replace(/([?&]action=)stream\b/, '$1snapshot')
    : null;
}
