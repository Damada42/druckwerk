import type { CostCategory, ProjectDocument, ProjectWithDetails } from '@3dapp/shared';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

let app: Awaited<ReturnType<typeof buildApp>>['app'];
let uploadDir: string;

beforeEach(async () => {
  uploadDir = mkdtempSync(path.join(tmpdir(), '3dapp-costs-'));
  ({ app } = await buildApp({ dbFile: ':memory:', uploadDir }));
});

afterEach(async () => {
  await app.close();
  rmSync(uploadDir, { recursive: true, force: true });
});

async function send<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
  const res = await app.inject({ method, url, payload });
  return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
}

describe('Kategorien für Zusatzkosten', () => {
  it('bringt die bisherigen Kategorien mit, unter ihren alten Schlüsseln', async () => {
    const list = (await send<CostCategory[]>('GET', '/api/cost-categories')).body;
    expect(list.map((c) => [c.key, c.name])).toEqual([
      ['electronics', 'Elektronik'],
      ['wood', 'Holz'],
      ['metal', 'Metall'],
      ['led', 'LEDs'],
      ['hardware', 'Schrauben & Kleinteile'],
      ['other', 'Sonstiges'],
    ]);
  });

  it('neue Kategorie mit Einheit und Standardpreis; verwendete lässt sich nicht löschen', async () => {
    const created = await send<CostCategory>('POST', '/api/cost-categories', { name: 'Versand' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Versand', unit: 'Stück', defaultPrice: null });
    expect(created.body.key).toMatch(/^c-/);

    const updated = await send<CostCategory>('PUT', `/api/cost-categories/${created.body.id}`, {
      unit: 'Paket',
      defaultPrice: '5,90',
    });
    expect(updated.body).toMatchObject({ unit: 'Paket', defaultPrice: 5.9 });
    expect(
      (await send('PUT', `/api/cost-categories/${created.body.id}`, { defaultPrice: -1 })).status,
    ).toBe(400);
    expect((await send('POST', '/api/cost-categories', { name: '  ' })).status).toBe(400);

    const project = await send<ProjectWithDetails>('POST', '/api/projects', {
      title: 'Lampe',
      costs: [{ category: created.body.key, quantity: 1, unit: 'Paket', unitPrice: 5.9 }],
    });
    // Ohne Beschreibung bleibt die Position erhalten (Kategorie reicht)
    expect(project.body.costs).toEqual([
      expect.objectContaining({ category: created.body.key, description: '', unit: 'Paket' }),
    ]);
    const del = await send<{ error: string }>('DELETE', `/api/cost-categories/${created.body.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error).toMatch(/verwendet/);

    // Umbenennen ändert den Schlüssel nicht – das Projekt zeigt den neuen Namen
    await send('PUT', `/api/cost-categories/${created.body.id}`, { name: 'Versand Österreich' });
    const again = (await send<CostCategory[]>('GET', '/api/cost-categories')).body;
    expect(again.find((c) => c.key === created.body.key)?.name).toBe('Versand Österreich');
  });
});

describe('Einheiten auf Angebot und Rechnung', () => {
  it('druckt Menge mit Einheit', async () => {
    await send('PUT', '/api/company', { name: 'Muster', address: 'Hauptstraße 1\n4020 Linz' });
    const project = await send<{ id: number }>('POST', '/api/projects', { title: 'Lampe' });
    const res = await send<ProjectDocument>('POST', `/api/projects/${project.body.id}/documents`, {
      kind: 'offer',
      recipient: 'Erika Muster',
      items: [
        { description: 'Druckzeit', quantity: 1.5, unit: 'Stunde', unitPrice: 1.43 },
        { description: 'Pauschale', quantity: 1, unitPrice: 10 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.items.map((i) => i.unit)).toEqual(['Stunde', '']);
    const data = new Uint8Array(
      readFileSync(path.join(uploadDir, path.basename(res.body.filePath))),
    );
    const pdf = await getDocument({ data, verbosity: 0 }).promise;
    const text = (await (await pdf.getPage(1)).getTextContent()).items
      .map((it) => ('str' in it ? it.str : ''))
      .join(' ');
    expect(text).toContain('1,5 Stunde');
  });
});

describe('Automatischer Verkaufspreis', () => {
  it('neues Projekt rechnet automatisch, mitgeschickter Preis bleibt fest', async () => {
    const auto = await send<ProjectWithDetails>('POST', '/api/projects', { title: 'Automatisch' });
    expect(auto.body.priceAuto).toBe(true);
    const fixed = await send<ProjectWithDetails>('POST', '/api/projects', {
      title: 'Fester Preis',
      price: 49.9,
    });
    expect(fixed.body).toMatchObject({ price: 49.9, priceAuto: false });
    const both = await send<ProjectWithDetails>('POST', '/api/projects', {
      title: 'Ausdrücklich automatisch',
      price: 12,
      priceAuto: true,
    });
    expect(both.body.priceAuto).toBe(true);
  });
});
