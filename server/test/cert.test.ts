import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ensureCert, localHosts } from '../src/cert.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), '3dapp-cert-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('HTTPS-Zertifikat', () => {
  it('gilt für localhost und alle Netzwerk-Adressen', async () => {
    const tls = await ensureCert(dir);
    const x509 = new X509Certificate(tls.cert);
    for (const host of localHosts()) {
      expect(x509.checkHost(host) ?? x509.checkIP(host)).toBeTruthy();
    }
    expect(x509.checkPrivateKey((await import('node:crypto')).createPrivateKey(tls.key))).toBe(
      true,
    );
    // gültig für rund 825 Tage
    const days = (new Date(x509.validTo).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(820);
  });

  it('verwendet ein vorhandenes Zertifikat wieder', async () => {
    const first = await ensureCert(dir);
    const second = await ensureCert(dir);
    expect(second.cert).toBe(first.cert);
  });

  it('erzeugt neu, wenn sich die Netzwerk-Adresse geändert hat', async () => {
    const first = await ensureCert(dir);
    const file = path.join(dir, 'tls.json');
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...stored, hosts: ['localhost'] }));
    const second = await ensureCert(dir);
    expect(second.cert).not.toBe(first.cert);
  });

  it('liefert bei gleichzeitigem Start ein zusammenpassendes Paar', async () => {
    const [a, b] = await Promise.all([ensureCert(dir), ensureCert(dir)]);
    const { createPrivateKey } = await import('node:crypto');
    for (const tls of [a, b]) {
      expect(new X509Certificate(tls.cert).checkPrivateKey(createPrivateKey(tls.key))).toBe(true);
    }
  });

  it('Server antwortet über HTTPS', async () => {
    const tls = await ensureCert(dir);
    const { app } = await buildApp({
      dbFile: ':memory:',
      uploadDir: path.join(dir, 'up'),
      https: { key: tls.key, cert: tls.cert },
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };
    const { request } = await import('node:https');
    const status = await new Promise<number>((resolve, reject) =>
      request(
        { host: '127.0.0.1', port, path: '/api/stats', ca: tls.cert, servername: 'localhost' },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      )
        .on('error', reject)
        .end(),
    );
    expect(status).toBe(200);
    await app.close();
  });
});
