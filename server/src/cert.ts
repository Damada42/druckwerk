import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import path from 'node:path';
import { generate } from 'selfsigned';

export interface TlsFiles {
  key: string;
  cert: string;
  /** Adressen, für die das Zertifikat gilt */
  hosts: string[];
}

interface Stored {
  key: string;
  cert: string;
  hosts: string[];
  validUntil: string;
}

/** localhost, Rechnername und alle IPv4-Adressen im Netzwerk (z.B. 192.168.1.126). */
export function localHosts(): string[] {
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
    .map((a) => a!.address);
  return [...new Set(['localhost', '127.0.0.1', hostname().toLowerCase(), ...ips])].sort();
}

const isIp = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
const DAY = 24 * 60 * 60 * 1000;

/**
 * Liefert ein selbst erstelltes Zertifikat fürs Heimnetz. Wird beim ersten Start angelegt und
 * neu erzeugt, wenn sich die Netzwerk-Adresse ändert oder es bald abläuft.
 */
export async function ensureCert(dir: string): Promise<TlsFiles> {
  mkdirSync(dir, { recursive: true });
  // Schlüssel und Zertifikat in EINER Datei: Server und Vite starten gleichzeitig und
  // dürfen nie Schlüssel aus dem einen und Zertifikat aus dem anderen Lauf erwischen.
  const file = path.join(dir, 'tls.json');
  const hosts = localHosts();

  if (existsSync(file)) {
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8')) as Stored;
      const covered = hosts.every((h) => stored.hosts.includes(h));
      const fresh = new Date(stored.validUntil).getTime() - Date.now() > 30 * DAY;
      if (covered && fresh) return { key: stored.key, cert: stored.cert, hosts: stored.hosts };
    } catch {
      // beschädigt → neu erzeugen
    }
  }

  // 825 Tage: längste Laufzeit, die Apple-Geräte für Server-Zertifikate akzeptieren
  const validUntil = new Date(Date.now() + 825 * DAY);
  const pems = await generate([{ name: 'commonName', value: 'Druckwerk (Heimnetz)' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notAfterDate: validUntil,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: hosts.map((h) => (isIp(h) ? { type: 7, ip: h } : { type: 2, value: h })),
      },
    ],
  });
  const stored: Stored = {
    key: pems.private,
    cert: pems.cert,
    hosts,
    validUntil: validUntil.toISOString(),
  };
  // Erst in eine Temp-Datei, dann umbenennen: Leser sehen immer ein vollständiges Paar
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(stored), { mode: 0o600 });
  renameSync(tmp, file);
  // Falls parallel ein anderer Prozess schneller war, dessen Paar verwenden
  const winner = JSON.parse(readFileSync(file, 'utf8')) as Stored;
  return { key: winner.key, cert: winner.cert, hosts: winner.hosts };
}
