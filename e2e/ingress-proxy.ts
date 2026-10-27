import { createServer, type Server } from 'node:http';
import { request } from 'node:https';

/** Ingress-Pfad, unter dem der Test-Proxy die App ausliefert */
export const INGRESS_PATH = '/api/hassio_ingress/e2e-token';

/**
 * Macht nach, was Home-Assistant-Ingress tut: Anfragen unter /api/hassio_ingress/<token>/… ohne
 * dieses Präfix an die App weiterreichen und den Pfad im Header X-Ingress-Path mitschicken.
 */
export function startIngressProxy(port: number, target: number): Promise<Server> {
  const server = createServer((req, res) => {
    if (!req.url?.startsWith(`${INGRESS_PATH}/`)) {
      res.writeHead(404).end('Nicht unter Ingress');
      return;
    }
    const upstream = request(
      {
        host: '127.0.0.1',
        port: target,
        method: req.method,
        path: req.url.slice(INGRESS_PATH.length),
        headers: { ...req.headers, host: `127.0.0.1:${target}`, 'x-ingress-path': INGRESS_PATH },
        // Selbst erstelltes Zertifikat des Testservers
        rejectUnauthorized: false,
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      },
    );
    upstream.on('error', () => res.writeHead(502).end());
    req.pipe(upstream);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
