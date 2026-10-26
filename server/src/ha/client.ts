import type { HaEntity } from '@3dapp/shared';
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';

/**
 * Holt alle Entities der Bambu-Lab-Integration in einer Anfrage, samt Gerät und übergeordnetem
 * Gerät (AMS/externe Spule hängen am Drucker). Nur ausgewählte Attribute: Manche Entities haben
 * Attribute, die sich nicht als JSON ausgeben lassen.
 */
export const BAMBU_TEMPLATE = `{%- set keys = ['slot','active','empty','color','name','type','remain','tray_uuid','tray_weight','entity_picture'] -%}
{%- set ns = namespace(out=[]) -%}
{%- for e in integration_entities('bambu_lab') -%}
{%- set d = device_id(e) -%}
{%- set s = states[e] -%}
{%- set a = namespace(v={}) -%}
{%- if s -%}{%- for k in keys if s.attributes[k] is defined -%}{%- set a.v = dict(a.v, **{k: s.attributes[k]}) -%}{%- endfor -%}{%- endif -%}
{%- set ns.out = ns.out + [{'e': e, 's': s.state if s else none, 'a': a.v, 'd': d, 'v': device_attr(d, 'via_device_id') if d else none, 'n': (device_attr(d, 'name_by_user') or device_attr(d, 'name')) if d else none, 'm': device_attr(d, 'model') if d else none}] -%}
{%- endfor -%}
{{ ns.out | tojson }}`;

interface RawEntity {
  e: string;
  s: string | null;
  a: Record<string, unknown>;
  d: string | null;
  v: string | null;
  n: string | null;
  m: string | null;
}

/** Fehler mit verständlicher deutscher Meldung für die Oberfläche */
export class HaError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502,
  ) {
    super(message);
  }
}

const URL_KEY = 'ha.url';
const TOKEN_KEY = 'ha.token';
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

export function createHaClient(db: Db, fetchImpl: typeof fetch = fetch) {
  let cache: { at: number; promise: Promise<HaEntity[]> } | null = null;

  const readSettings = () => {
    const rows = db
      .select()
      .from(schema.settings)
      .where(inArray(schema.settings.key, [URL_KEY, TOKEN_KEY]))
      .all();
    const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
    return { url: get(URL_KEY), token: get(TOKEN_KEY) };
  };

  async function request(
    path: string,
    init: RequestInit = {},
    target = readSettings(),
  ): Promise<Response> {
    if (!target.url || !target.token)
      throw new HaError('Home Assistant ist noch nicht eingerichtet.', 409);
    let res: Response;
    try {
      res = await fetchImpl(`${target.url}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${target.token}`,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...init.headers,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const reason =
        e instanceof Error && e.name === 'TimeoutError' ? 'keine Antwort' : 'nicht erreichbar';
      throw new HaError(`Home Assistant ist ${reason} (${target.url}).`);
    }
    if (res.status === 401 || res.status === 403)
      throw new HaError('Home Assistant lehnt den Token ab – bitte einen neuen erstellen.');
    if (!res.ok) throw new HaError(`Home Assistant meldet Fehler ${res.status}.`);
    return res;
  }

  return {
    settings() {
      const { url, token } = readSettings();
      return { url, hasToken: !!token };
    },

    configured() {
      const { url, token } = readSettings();
      return !!url && !!token;
    },

    /** Prüft Adresse und Token und gibt die HA-Version zurück */
    async check(target = readSettings()): Promise<string> {
      const res = await request('/api/config', {}, target);
      const body = (await res.json().catch(() => ({}))) as { version?: string };
      return body.version ?? '?';
    },

    /** Speichert erst nach erfolgreicher Prüfung; ohne neuen Token bleibt der alte */
    async save(rawUrl: string, token?: string) {
      const url = normalizeUrl(rawUrl);
      const target = { url, token: token?.trim() || readSettings().token };
      if (!target.token) throw new HaError('Bitte einen Zugriffstoken eintragen.', 400);
      const version = await this.check(target);
      db.transaction((tx) => {
        for (const [key, value] of [
          [URL_KEY, url],
          [TOKEN_KEY, target.token!],
        ]) {
          tx.insert(schema.settings)
            .values({ key, value })
            .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
            .run();
        }
      });
      cache = null;
      return version;
    },

    clear() {
      db.delete(schema.settings)
        .where(inArray(schema.settings.key, [URL_KEY, TOKEN_KEY]))
        .run();
      cache = null;
    },

    /** Alle Bambu-Lab-Entities (kurz zwischengespeichert, außer mit fresh) */
    entities({ fresh = false } = {}): Promise<HaEntity[]> {
      if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.promise;
      const promise = (async () => {
        const res = await request('/api/template', {
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
        }));
      })();
      cache = { at: Date.now(), promise };
      // Fehler nicht zwischenspeichern
      promise.catch(() => {
        if (cache?.promise === promise) cache = null;
      });
      return promise;
    },

    async callService(domain: string, service: string, entityId: string) {
      await request(`/api/services/${domain}/${service}`, {
        method: 'POST',
        body: JSON.stringify({ entity_id: entityId }),
      });
      cache = null;
    },

    /** Bild aus Home Assistant (z.B. Vorschaubild des Auftrags) über den Server durchreichen */
    async image(path: string) {
      if (!path.startsWith('/api/')) throw new HaError('Ungültiger Bildpfad', 400);
      const res = await request(path);
      return {
        type: res.headers.get('content-type') ?? 'image/png',
        body: Buffer.from(await res.arrayBuffer()),
      };
    },
  };
}

export type HaClient = ReturnType<typeof createHaClient>;

/** Spule, die gerade in diesem AMS-Slot steckt */
export function spoolInSlot(db: Db, entityId: string) {
  return db
    .select()
    .from(schema.filamentSpools)
    .where(eq(schema.filamentSpools.haTrayEntity, entityId))
    .get();
}
