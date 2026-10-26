import type { FastifyInstance } from 'fastify';
import { appendFile } from 'node:fs/promises';

interface ClientLog {
  event?: unknown;
  data?: unknown;
}

/**
 * Nimmt Meldungen vom Browser entgegen (z.B. Scan-Schritte oder Fehler auf dem Handy)
 * und schreibt sie ins Server-Log – und optional in eine Datei, damit sie einen
 * Server-Neustart überleben. So lässt sich nachvollziehen, was auf einem Gerät passiert ist.
 */
export function registerClientLogRoutes(app: FastifyInstance, file?: string) {
  app.post<{ Body: ClientLog }>('/client-log', { bodyLimit: 64 * 1024 }, async (req, reply) => {
    const event = String(req.body?.event ?? 'unbekannt').slice(0, 100);
    const client = { event, data: req.body?.data, ua: req.headers['user-agent'] };
    req.log.info({ client }, `client: ${event}`);
    if (file) {
      const line = JSON.stringify({ time: new Date().toISOString(), ...client });
      await appendFile(file, line + '\n').catch((e) =>
        req.log.warn(e, 'client-log nicht schreibbar'),
      );
    }
    return reply.code(204).send();
  });
}
