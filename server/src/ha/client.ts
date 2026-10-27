import {
  findPrinterDevices,
  maskUrl,
  type HaCameraList,
  type HaEntity,
  type HaStatus,
} from '@3dapp/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';

/**
 * Holt alle Entities der Bambu-Lab-Integration in einer Anfrage, samt Gerät und übergeordnetem
 * Gerät (AMS/externe Spule hängen am Drucker). Nur ausgewählte Attribute: Manche Entities haben
 * Attribute, die sich nicht als JSON ausgeben lassen. „options“ ist bei einigen Sensoren ein Set –
 * daher nur von Selects (Geschwindigkeit) und als Liste.
 */
export const BAMBU_TEMPLATE = `{%- set keys = ['slot','active','empty','color','name','type','remain','tray_uuid','tray_weight','entity_picture','options','objects'] -%}
{%- set ns = namespace(out=[]) -%}
{%- for e in integration_entities('bambu_lab') -%}
{%- set d = device_id(e) -%}
{%- set s = states[e] -%}
{%- set a = namespace(v={}) -%}
{%- if s -%}{%- for k in keys if s.attributes[k] is defined and (k != 'options' or e.startswith('select.')) -%}{%- set a.v = dict(a.v, **{k: (s.attributes[k] | list) if k == 'options' else s.attributes[k]}) -%}{%- endfor -%}{%- endif -%}
{%- set ns.out = ns.out + [{'e': e, 's': s.state if s else none, 'a': a.v, 'd': d, 'v': device_attr(d, 'via_device_id') if d else none, 'n': (device_attr(d, 'name_by_user') or device_attr(d, 'name')) if d else none, 'm': device_attr(d, 'model') if d else none}] -%}
{%- endfor -%}
{{ ns.out | tojson }}`;

/** Alle Kameras mit Gerät – auch von anderen Integrationen (Moonraker, generische Kamera …) */
export const CAMERA_TEMPLATE = `{%- set ns = namespace(out=[]) -%}
{%- for s in states.camera -%}
{%- set d = device_id(s.entity_id) -%}
{%- set ns.out = ns.out + [{'e': s.entity_id, 's': s.state, 'n': s.name, 'd': d, 'dn': (device_attr(d, 'name_by_user') or device_attr(d, 'name')) if d else none}] -%}
{%- endfor -%}
{{ ns.out | tojson }}`;

/** camera.* – mehr lässt der Server nicht an Home Assistant durch */
export const CAMERA_ENTITY = /^camera\.[a-z0-9_]+$/;

interface RawEntity {
  e: string;
  s: string | null;
  a: Record<string, unknown>;
  d: string | null;
  v: string | null;
  n: string | null;
  m: string | null;
}

/** Home Assistant aus Sicht einer HA-App (REST-API unter /core/api, Token = SUPERVISOR_TOKEN) */
export const SUPERVISOR_URL = 'http://supervisor/core';

/** Fehler mit verständlicher deutscher Meldung für die Oberfläche */
export class HaError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 8000;
/** Mehrere Browser und der Hintergrund-Abgleich teilen sich eine Abfrage */
const CACHE_MS = 2000;

/** „homeassistant.local:8123/“ → „http://homeassistant.local:8123“ */
export function normalizeUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  try {
    return new URL(url).origin;
  } catch {
    throw new HaError('Das ist keine gültige Adresse.', 400);
  }
}

type Connection = typeof schema.haConnections.$inferSelect;
type Target = Pick<Connection, 'name' | 'url' | 'token'>;

/** Bambu-Entities aller Verbindungen; nicht erreichbare Standorte stehen in errors */
export interface FetchedEntities {
  entities: HaEntity[];
  errors: { connectionId: number; name: string; message: string }[];
}

/**
 * Verwaltet alle Home-Assistant-Verbindungen (Standorte). Drucker werden über ihre Device-ID
 * gefunden – die ist in jedem HA eindeutig, daher muss ein Drucker seinen Standort nicht kennen.
 */
export function createHaClient(db: Db, fetchImpl: typeof fetch = fetch, supervisorToken?: string) {
  const cache = new Map<number, { at: number; promise: Promise<HaEntity[]> }>();

  // Als HA-App: Verbindung zum eigenen Home Assistant anlegen, falls es sie noch nicht gibt
  if (
    supervisorToken &&
    !db.select().from(schema.haConnections).where(eq(schema.haConnections.local, true)).get()
  ) {
    db.insert(schema.haConnections)
      .values({ name: 'Home Assistant', url: SUPERVISOR_URL, token: '', local: true })
      .run();
  }

  /** Lokale Verbindung: Adresse und Token vom Supervisor (fehlt der Token, ist token leer) */
  const resolve = (row: Connection): Connection =>
    row.local ? { ...row, url: SUPERVISOR_URL, token: supervisorToken ?? '' } : row;

  const connections = () =>
    db.select().from(schema.haConnections).orderBy(schema.haConnections.id).all().map(resolve);

  const byId = (id: number) => {
    const row = db.select().from(schema.haConnections).where(eq(schema.haConnections.id, id)).get();
    if (!row) throw new HaError('Diese Verbindung gibt es nicht.', 404);
    return resolve(row);
  };

  /**
   * Fehlermeldungen nennen den Standort, nie die Adresse: sie landen im Browser.
   * Mit stream läuft die Antwort weiter, bis stream abbricht (siehe fetchWithTimeout).
   */
  async function request(
    target: Target,
    path: string,
    init: RequestInit = {},
    stream?: AbortSignal,
  ) {
    // Lokale Verbindung, aber Druckwerk läuft gerade nicht als HA-App (z.B. Daten umgezogen)
    if (!target.token)
      throw new HaError(`„${target.name}“ geht nur, wenn Druckwerk als Home-Assistant-App läuft.`);
    let res: Response;
    try {
      res = await fetchWithTimeout(
        fetchImpl,
        `${target.url}${path}`,
        {
          ...init,
          headers: {
            authorization: `Bearer ${target.token}`,
            ...(init.body ? { 'content-type': 'application/json' } : {}),
            ...init.headers,
          },
        },
        stream,
      );
    } catch (e) {
      throw new HaError(`Home Assistant „${target.name}“ ${unreachable(e)}.`);
    }
    if (res.status === 401 || res.status === 403)
      throw new HaError(
        `Home Assistant „${target.name}“ lehnt den Token ab – bitte einen neuen erstellen.`,
      );
    if (!res.ok) throw new HaError(`Home Assistant „${target.name}“ meldet Fehler ${res.status}.`);
    return res;
  }

  async function check(target: Target): Promise<string> {
    const res = await request(target, '/api/config');
    const body = (await res.json().catch(() => ({}))) as { version?: string };
    return body.version ?? '?';
  }

  function fetchConnection(conn: Connection, fresh: boolean): Promise<HaEntity[]> {
    const hit = cache.get(conn.id);
    if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
    const promise = (async () => {
      const res = await request(conn, '/api/template', {
        method: 'POST',
        body: JSON.stringify({ template: BAMBU_TEMPLATE }),
      });
      const raw = JSON.parse(await res.text()) as RawEntity[];
      return raw.map((r) => ({
        entityId: r.e,
        state: r.s,
        attributes: r.a ?? {},
        deviceId: r.d,
        viaDeviceId: r.v,
        deviceName: r.n,
        model: r.m,
        connectionId: conn.id,
      }));
    })();
    cache.set(conn.id, { at: Date.now(), promise });
    // Fehler nicht zwischenspeichern
    promise.catch(() => {
      if (cache.get(conn.id)?.promise === promise) cache.delete(conn.id);
    });
    return promise;
  }

  async function entities({ fresh = false } = {}): Promise<FetchedEntities> {
    const all = connections();
    const results = await Promise.allSettled(all.map((c) => fetchConnection(c, fresh)));
    const out: FetchedEntities = { entities: [], errors: [] };
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') out.entities.push(...r.value);
      else
        out.errors.push({
          connectionId: all[i].id,
          name: all[i].name,
          message: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
    });
    return out;
  }

  /** Verbindung, in der das Gerät steckt */
  async function connectionOf(deviceId: string) {
    const { entities: list, errors } = await entities();
    const connectionId = list.find((e) => e.deviceId === deviceId)?.connectionId;
    if (connectionId === undefined)
      throw new HaError(
        errors.length
          ? errors.map((e) => e.message).join(' ')
          : 'Den Drucker gibt es in keiner Home-Assistant-Verbindung mehr.',
        404,
      );
    return byId(connectionId);
  }

  return {
    configured: () => connections().length > 0,

    /** Alle Verbindungen mit Prüfung, Version und gefundenen Druckern (für die Einstellungen) */
    async status(): Promise<HaStatus> {
      const all = connections();
      return {
        connections: await Promise.all(
          all.map(async (conn) => {
            const base = {
              id: conn.id,
              name: conn.name,
              url: conn.local ? 'Dieses Home Assistant (App)' : maskUrl(conn.url),
              local: conn.local,
            };
            try {
              const [version, list] = await Promise.all([
                check(conn),
                fetchConnection(conn, false),
              ]);
              const printers = findPrinterDevices(list).map((p) => ({ ...p, location: conn.name }));
              return { ...base, ok: true, version, printers };
            } catch (e) {
              return {
                ...base,
                ok: false,
                error: e instanceof Error ? e.message : String(e),
                printers: [],
              };
            }
          }),
        ),
      };
    },

    /** Neue Verbindung – wird nur gespeichert, wenn Adresse und Token funktionieren */
    async add(input: { name?: string; url?: string; token?: string }) {
      const name = input.name?.trim();
      if (!name) throw new HaError('Bitte einen Namen für den Standort eintragen.', 400);
      if (!input.url?.trim()) throw new HaError('Bitte die Adresse eintragen.', 400);
      if (!input.token?.trim()) throw new HaError('Bitte einen Zugriffstoken eintragen.', 400);
      const target = { name, url: normalizeUrl(input.url), token: input.token.trim() };
      await check(target);
      return db.insert(schema.haConnections).values(target).returning().get();
    },

    /** Ändern; leere Adresse oder leerer Token = bisherigen Wert behalten */
    async update(id: number, input: { name?: string; url?: string; token?: string }) {
      const current = byId(id);
      // Beim eigenen Home Assistant kommen Adresse und Token vom Supervisor: nur umbenennen
      if (current.local) {
        cache.delete(id);
        return db
          .update(schema.haConnections)
          .set({ name: input.name?.trim() || current.name })
          .where(eq(schema.haConnections.id, id))
          .returning()
          .get();
      }
      const target = {
        name: input.name?.trim() || current.name,
        url: input.url?.trim() ? normalizeUrl(input.url) : current.url,
        token: input.token?.trim() || current.token,
      };
      // Nur Name geändert: keine Prüfung nötig, HA darf auch gerade offline sein
      if (target.url !== current.url || target.token !== current.token) await check(target);
      cache.delete(id);
      return db
        .update(schema.haConnections)
        .set(target)
        .where(eq(schema.haConnections.id, id))
        .returning()
        .get();
    },

    remove(id: number) {
      if (byId(id).local && supervisorToken)
        throw new HaError(
          'Die Verbindung zum eigenen Home Assistant lässt sich nicht trennen.',
          400,
        );
      db.delete(schema.haConnections).where(eq(schema.haConnections.id, id)).run();
      cache.delete(id);
    },

    entities,

    /** Dienst bei der Verbindung des Druckers aufrufen */
    async callService(
      deviceId: string,
      domain: string,
      service: string,
      data: Record<string, unknown>,
    ) {
      const conn = await connectionOf(deviceId);
      await request(conn, `/api/services/${domain}/${service}`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      cache.delete(conn.id);
    },

    /** Kamera-Entities aller Standorte; nicht erreichbare Standorte stehen in errors */
    async cameras(): Promise<HaCameraList> {
      const all = connections();
      const results = await Promise.allSettled(
        all.map(async (conn) => {
          const res = await request(conn, '/api/template', {
            method: 'POST',
            body: JSON.stringify({ template: CAMERA_TEMPLATE }),
          });
          const raw = JSON.parse(await res.text()) as {
            e: string;
            s: string | null;
            n: string | null;
            d: string | null;
            dn: string | null;
          }[];
          return raw.map((r) => ({
            connectionId: conn.id,
            location: conn.name,
            entityId: r.e,
            name: r.n ?? r.e,
            deviceId: r.d,
            deviceName: r.dn,
            available: r.s !== null && r.s !== 'unavailable',
          }));
        }),
      );
      return {
        cameras: results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])),
        errors: results.flatMap((r) =>
          r.status === 'rejected'
            ? [r.reason instanceof Error ? r.reason.message : String(r.reason)]
            : [],
        ),
      };
    },

    /** Standbild oder MJPEG-Stream einer Kamera-Entity; der Stream läuft, bis signal abbricht */
    camera(
      connectionId: number,
      entityId: string,
      kind: 'snapshot' | 'stream',
      signal?: AbortSignal,
    ) {
      if (!CAMERA_ENTITY.test(entityId)) throw new HaError('Ungültige Kamera', 400);
      const path = kind === 'stream' ? 'camera_proxy_stream' : 'camera_proxy';
      return request(byId(connectionId), `/api/${path}/${entityId}`, {}, signal);
    },

    /** Bild aus Home Assistant (z.B. Vorschaubild des Auftrags) über den Server durchreichen */
    async image(deviceId: string, path: string) {
      if (!path.startsWith('/api/')) throw new HaError('Ungültiger Bildpfad', 400);
      const res = await request(await connectionOf(deviceId), path);
      return {
        type: res.headers.get('content-type') ?? 'image/png',
        body: Buffer.from(await res.arrayBuffer()),
      };
    },
  };
}

export type HaClient = ReturnType<typeof createHaClient>;

/** Grund für die Fehlermeldung, wenn fetch scheitert */
export const unreachable = (e: unknown) =>
  e instanceof Error && e.name === 'TimeoutError' ? 'antwortet nicht' : 'ist nicht erreichbar';

/**
 * fetch mit Zeitgrenze. Ohne stream gilt sie für die ganze Anfrage. Mit stream (Kamerabild) gilt
 * sie nur, bis die Antwort-Header da sind – danach bricht nur noch stream die Übertragung ab.
 */
export async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  stream?: AbortSignal,
) {
  if (!stream) return fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new DOMException('Zeitüberschreitung', 'TimeoutError')),
    TIMEOUT_MS,
  );
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.any([stream, timeout.signal]) });
  } finally {
    clearTimeout(timer);
  }
}

/** Spule, die gerade in diesem AMS-Slot steckt */
export function spoolInSlot(db: Db, entityId: string) {
  return db
    .select()
    .from(schema.filamentSpools)
    .where(eq(schema.filamentSpools.haTrayEntity, entityId))
    .get();
}
