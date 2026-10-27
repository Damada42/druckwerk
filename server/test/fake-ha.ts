import { createServer, type Server } from 'node:http';

/** Rohdaten wie aus dem Bambu-Template (siehe BAMBU_TEMPLATE) */
export interface RawEntity {
  e: string;
  s: string | null;
  a: Record<string, unknown>;
  d: string | null;
  v: string | null;
  n: string | null;
  m: string | null;
}

export const FAKE_TOKEN = 'test-token';

/** Kamera wie aus CAMERA_TEMPLATE */
export interface RawCamera {
  e: string;
  s: string | null;
  n: string | null;
  d: string | null;
  dn: string | null;
}

/** 1×1-PNG als Kamerabild */
export const FAKE_FRAME = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Zugangsdaten der nachgebauten Crowsnest-Webcam unter /webcam/ */
export const FAKE_WEBCAM_AUTH = `Basic ${Buffer.from('cam:geheim').toString('base64')}`;

/** Ein MJPEG-Stream mit zwei Bildern – endlich, damit Tests nicht hängen */
function mjpeg(): { status: number; type: string; body: Buffer } {
  const part = Buffer.concat([
    Buffer.from(
      `--frame\r\nContent-Type: image/png\r\nContent-Length: ${FAKE_FRAME.length}\r\n\r\n`,
    ),
    FAKE_FRAME,
    Buffer.from('\r\n'),
  ]);
  return {
    status: 200,
    type: 'multipart/x-mixed-replace; boundary=frame',
    body: Buffer.concat([part, part, Buffer.from('--frame--\r\n')]),
  };
}

/**
 * Nachgebautes Home Assistant für Tests: beantwortet die Anfragen des Servers (Config, Template,
 * Dienste, Bilder) aus einer veränderbaren Liste von Entities und merkt sich Dienstaufrufe.
 */
export class FakeHa {
  entities: RawEntity[];
  calls: { domain: string; service: string; entityId?: string; data: Record<string, unknown> }[] =
    [];
  private server?: Server;

  /**
   * @param printer Präfix der Drucker-Entities (im Fixture „the_one“)
   * @param ams Präfix der AMS-Entities
   */
  /** Kameras: die des P1S aus dem Fixture und eine Klipper-Kamera wie beim SidewinderX1 */
  cameras: RawCamera[];

  constructor(
    fixture: RawEntity[],
    readonly printer = 'the_one',
    readonly ams = 'p1s_01p09a431900844_ams_1',
  ) {
    this.entities = structuredClone(fixture);
    this.cameras = [
      ...this.entities
        .filter((x) => x.e.startsWith('camera.'))
        .map((x) => ({ e: x.e, s: x.s, n: `${x.n} Kamera`, d: x.d, dn: x.n })),
      { e: 'camera.sidewinderx1', s: 'idle', n: 'Kamera', d: 'klipper-device', dn: 'SidewinderX1' },
      {
        e: 'camera.sidewinderx1_usb',
        s: 'unavailable',
        n: 'SidewinderX1 Usb',
        d: 'klipper-device',
        dn: 'SidewinderX1',
      },
    ];
  }

  /** Zustand und/oder Attribute einer Entity ändern */
  set(entityId: string, state: string | null, attributes?: Record<string, unknown>) {
    const entity = this.entities.find((x) => x.e === entityId);
    if (!entity) throw new Error(`Unbekannte Entity ${entityId}`);
    if (state !== null) entity.s = state;
    if (attributes) entity.a = { ...entity.a, ...attributes };
  }

  /** Einen Druck auf dem Fixture-Drucker einstellen */
  print(
    state: string,
    options: {
      slot?: number | null;
      progress?: number;
      weight?: number;
      task?: string;
      start?: string;
      /** Teile auf der Platte als {id: name}; übersprungene werden dabei zurückgesetzt */
      objects?: Record<string, string>;
    } = {},
  ) {
    if (options.objects) {
      this.set(
        `sensor.${this.printer}_druckbare_objekte`,
        String(Object.keys(options.objects).length),
        {
          objects: options.objects,
        },
      );
      this.set(`sensor.${this.printer}_ubersprungene_objekte`, '0', { objects: [] });
    }
    const printing = state === 'running' || state === 'pause';
    const speed = this.entities.find((x) => x.e === `select.${this.printer}_druckgeschwindigkeit`)!;
    this.set(
      speed.e,
      printing ? (speed.s === 'unavailable' ? 'standard' : (speed.s ?? 'standard')) : 'unavailable',
    );
    this.set(`sensor.${this.printer}_druckstatus`, state);
    for (let s = 1; s <= 4; s++)
      this.set(`sensor.${this.ams}_slot_${s}`, null, { active: s === options.slot });
    if (options.progress !== undefined)
      this.set(`sensor.${this.printer}_druckfortschritt`, String(options.progress));
    if (options.weight !== undefined)
      this.set(`sensor.${this.printer}_gewicht_des_drucks`, String(options.weight));
    if (options.task !== undefined)
      this.set(`sensor.${this.printer}_name_der_aufgabe`, options.task);
    if (options.start !== undefined) this.set(`sensor.${this.printer}_startzeit`, options.start);
    const running = state === 'running';
    this.set(`button.${this.printer}_druckvorgang_anhalten`, running ? 'unknown' : 'unavailable');
    this.set(
      `button.${this.printer}_druckvorgang_beenden`,
      running || state === 'pause' ? 'unknown' : 'unavailable',
    );
    this.set(
      `button.${this.printer}_druckvorgang_fortsetzen`,
      state === 'pause' ? 'unknown' : 'unavailable',
    );
  }

  handle(
    method: string,
    path: string,
    auth: string | null,
    body: string,
    query = new URLSearchParams(),
  ): { status: number; type?: string; body: string | Buffer } {
    // Crowsnest/mjpg-streamer einer Klipper-Webcam, mit Basic-Auth
    if (method === 'GET' && path === '/webcam/') {
      if (auth !== FAKE_WEBCAM_AUTH) return { status: 401, body: 'Unauthorized' };
      return query.get('action') === 'snapshot'
        ? { status: 200, type: 'image/png', body: FAKE_FRAME }
        : mjpeg();
    }
    if (auth !== `Bearer ${FAKE_TOKEN}`) return { status: 401, body: '401: Unauthorized' };
    if (method === 'POST' && path === '/api/template' && body.includes('states.camera'))
      return { status: 200, type: 'text/plain', body: JSON.stringify(this.cameras) };
    const camera = /^\/api\/(camera_proxy|camera_proxy_stream)\/(camera\.\w+)$/.exec(path);
    if (method === 'GET' && camera) {
      const found = this.cameras.find((c) => c.e === camera[2]);
      if (!found || found.s === 'unavailable') return { status: 404, body: 'Not found' };
      return camera[1] === 'camera_proxy'
        ? { status: 200, type: 'image/png', body: FAKE_FRAME }
        : mjpeg();
    }
    if (method === 'GET' && path === '/api/config')
      return {
        status: 200,
        type: 'application/json',
        body: JSON.stringify({ version: '2026.10.4' }),
      };
    if (method === 'POST' && path === '/api/template')
      return { status: 200, type: 'text/plain', body: JSON.stringify(this.entities) };
    const service = /^\/api\/services\/(\w+)\/(\w+)$/.exec(path);
    if (method === 'POST' && service) {
      const data = JSON.parse(body) as Record<string, unknown>;
      const entityId = typeof data.entity_id === 'string' ? data.entity_id : undefined;
      this.calls.push({ domain: service[1], service: service[2], entityId, data });
      if (service[1] === 'light') this.set(entityId!, service[2] === 'turn_on' ? 'on' : 'off');
      if (service[1] === 'select') this.set(entityId!, String(data.option));
      if (service[1] === 'bambu_lab' && service[2] === 'skip_objects') {
        const skipped = this.entities.find(
          (x) => x.e === `sensor.${this.printer}_ubersprungene_objekte`,
        )!;
        const ids = [
          ...(skipped.a.objects as number[]),
          ...String(data.objects).split(',').map(Number),
        ];
        this.set(skipped.e, String(ids.length), { objects: ids });
      }
      return { status: 200, type: 'application/json', body: '[]' };
    }
    if (method === 'GET' && path.startsWith('/api/image_proxy/'))
      return { status: 200, type: 'image/png', body: FAKE_FRAME };
    return { status: 404, body: 'Not found' };
  }

  /** fetch-Ersatz für buildApp({ haFetch }) */
  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const res = this.handle(
      init?.method ?? 'GET',
      url.pathname,
      headers.get('authorization'),
      String(init?.body ?? ''),
      url.searchParams,
    );
    const body = typeof res.body === 'string' ? res.body : new Uint8Array(res.body);
    return new Response(body, {
      status: res.status,
      headers: res.type ? { 'content-type': res.type } : {},
    });
  };

  /** Als echter HTTP-Server (für die Klick-Tests) */
  listen(port: number) {
    this.server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        // Teststeuerung: Zustand von außen setzen
        if (req.method === 'POST' && url.pathname === '/test/print') {
          this.print(...(JSON.parse(body) as Parameters<FakeHa['print']>));
          res.writeHead(204).end();
          return;
        }
        if (req.method === 'GET' && url.pathname === '/test/calls') {
          res
            .writeHead(200, { 'content-type': 'application/json' })
            .end(JSON.stringify(this.calls));
          return;
        }
        const out = this.handle(
          req.method ?? 'GET',
          url.pathname,
          req.headers.authorization ?? null,
          body,
          url.searchParams,
        );
        res.writeHead(out.status, out.type ? { 'content-type': out.type } : {}).end(out.body);
      });
    });
    return new Promise<void>((resolve) => this.server!.listen(port, '127.0.0.1', resolve));
  }

  close() {
    return new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }
}
