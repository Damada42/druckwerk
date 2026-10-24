import { calcPrinterHourly, calcProjectCosts, type ProjectWithDetails } from '@3dapp/shared';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

let app: Awaited<ReturnType<typeof buildApp>>['app'];
let uploadDir: string;

beforeEach(async () => {
  uploadDir = mkdtempSync(path.join(tmpdir(), '3dapp-test-'));
  ({ app } = await buildApp({ dbFile: ':memory:', uploadDir }));
});

afterEach(async () => {
  await app.close();
  rmSync(uploadDir, { recursive: true, force: true });
});

async function post<T>(url: string, payload: object) {
  const res = await app.inject({ method: 'POST', url, payload });
  return { status: res.statusCode, body: res.json() as T };
}

describe('Stammdaten', () => {
  it('legt Filamenttypen, Finishes und einen P1S an', async () => {
    const types = (await app.inject('/api/filament-types')).json();
    expect(types.map((t: { name: string }) => t.name)).toContain('PETG');
    const printers = (await app.inject('/api/printers')).json();
    expect(printers[0]).toMatchObject({ model: 'Bambu Lab P1S', hasAms: true });
  });

  it('schützt verwendete Einträge mit verständlicher Meldung', async () => {
    await post('/api/spools', { typeId: 1, manufacturer: 'Sunlu', colorName: 'Grau' });
    const res = await app.inject({ method: 'DELETE', url: '/api/filament-types/1' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/noch verwendet/);
    const dup = await post('/api/filament-types', { name: 'PLA' });
    expect(dup.status).toBe(409);
  });

  it('verlangt Pflichtfelder', async () => {
    const res = await post('/api/customers', { email: 'a@b.de' });
    expect(res.status).toBe(400);
  });
});

describe('Druckerkosten', () => {
  // Referenzwerte aus Markus' Kostenvergleich (Excel). Halot: Excel rundet die Abnutzung auf
  // 0,07 €/h (→ 0,274); exakt sind 200 € / 3000 h = 0,0667 €/h (→ 0,2707).
  const cases = [
    { name: 'Bambu P1S', w: 160, kwh: 0.2, price: 1600, life: 2000, maint: 300, total: 1.432 },
    { name: 'Elwms', w: 180, kwh: 0.3, price: 3500, life: 5000, maint: 300, total: 1.354 },
    {
      name: 'Halot SLA',
      w: 80,
      kwh: 0.3,
      price: 200,
      life: 3000,
      maint: 90,
      total: 0.024 + 200 / 3000 + 0.18,
    },
    { name: 'Flashforge SLA', w: 90, kwh: 0.3, price: 300, life: 3000, maint: 100, total: 0.327 },
  ];
  it.each(cases)('$name kostet $total €/h', (c) => {
    const h = calcPrinterHourly({
      powerW: c.w,
      electricityPrice: c.kwh,
      purchasePrice: c.price,
      lifetimeHours: c.life,
      maintenancePerYear: c.maint,
      hoursPerYear: 500,
    });
    expect(h.total).toBeCloseTo(c.total, 6);
  });

  it('rechnet Druckzeit × Stundensatz ins Projekt ein', async () => {
    const project = await post<ProjectWithDetails>('/api/projects', {
      title: 'Vase',
      printerId: 1,
      printHours: 5,
    });
    expect(project.body.printHours).toBe(5);
    const printers = (await app.inject('/api/printers')).json();
    const costs = calcProjectCosts(project.body, [], printers);
    expect(costs.machine).toBeCloseTo(5 * 1.432, 6);
  });
});

describe('Projekte', () => {
  it('legt Projekte mit Details an und verschiebt sie im Kanban', async () => {
    const customer = await post<{ id: number }>('/api/customers', { name: 'Anna' });
    const person = await post<{ id: number }>('/api/persons', { name: 'Tom' });
    const spool = await post<{ id: number; weightRemainingG: number }>('/api/spools', {
      typeId: 1,
      manufacturer: 'Bambu Lab',
      colorName: 'Schwarz',
      weightTotalG: 1000,
      price: 20,
    });
    expect(spool.body.weightRemainingG).toBe(1000);

    const a = await post<ProjectWithDetails>('/api/projects', {
      title: 'Lampe',
      customerId: customer.body.id,
      members: [{ personId: person.body.id, role: 'support' }],
      filaments: [{ spoolId: spool.body.id, plannedGrams: 250 }],
      costs: [{ category: 'led', description: 'LED-Streifen', quantity: 2, unitPrice: 4.5 }],
    });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ status: 'open', position: 1 });
    expect(a.body.members).toEqual([{ personId: person.body.id, role: 'support' }]);

    const costs = calcProjectCosts(a.body, [{ id: spool.body.id, price: 20, weightTotalG: 1000 }]);
    expect(costs).toEqual({ filament: 5, machine: 0, extras: 9, total: 14 });

    const b = await post<ProjectWithDetails>('/api/projects', { title: 'Halter' });
    expect(b.body.position).toBe(2);

    const moved = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${b.body.id}/move`,
      payload: { status: 'in_progress', position: 0.5 },
    });
    expect(moved.json()).toMatchObject({ status: 'in_progress', position: 0.5 });

    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${b.body.id}/move`,
      payload: { status: 'kaputt' },
    });
    expect(bad.statusCode).toBe(400);

    const stats = (await app.inject('/api/stats')).json();
    expect(stats.projects).toEqual({ open: 1, in_progress: 1, done: 0 });
    expect(stats.filamentTotalG).toBe(1000);
  });

  it('bucht Filamentverbrauch ab, ohne unter 0 zu gehen', async () => {
    const spool = await post<{ id: number }>('/api/spools', {
      typeId: 1,
      manufacturer: 'Sunlu',
      colorName: 'Weiß',
      weightTotalG: 1000,
      weightRemainingG: 150,
    });
    const res = await post<{ weightRemainingG: number }>(`/api/spools/${spool.body.id}/consume`, {
      grams: 400,
    });
    expect(res.body.weightRemainingG).toBe(0);
    expect((await app.inject('/api/stats')).json().lowSpools).toBe(1);
  });

  it('speichert Rechnungen mit Datei-Upload', async () => {
    const project = await post<{ id: number }>('/api/projects', { title: 'Box' });
    const boundary = '----test';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="amount"',
      '',
      '12,50',
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="beleg.pdf"',
      'Content-Type: application/pdf',
      '',
      '%PDF-1.4 test',
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const res = await app.inject({
      method: 'POST',
      url: `/api/projects/${project.body.id}/invoices`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    const invoice = res.json();
    expect(invoice).toMatchObject({ amount: 12.5, fileName: 'beleg.pdf' });

    const file = await app.inject(invoice.filePath);
    expect(file.statusCode).toBe(200);

    const del = await app.inject({ method: 'DELETE', url: `/api/projects/${project.body.id}` });
    expect(del.statusCode).toBe(204);
    expect((await app.inject(invoice.filePath)).statusCode).toBe(404);
  });
});
