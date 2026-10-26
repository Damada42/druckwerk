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

  it('schÃ¼tzt verwendete EintrÃ¤ge mit verstÃ¤ndlicher Meldung', async () => {
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

describe('Barcode-Scan', () => {
  const spool = {
    typeId: 1,
    manufacturer: 'Bambu Lab',
    colorName: 'Jade WeiÃŸ',
    colorHex: '#f0f0ea',
    finishId: 2,
    weightTotalG: 1000,
    price: 19.99,
    barcode: ' 6975337 031234 ',
  };

  it('unbekannter Barcode liefert leeres Ergebnis', async () => {
    const res = (await app.inject('/api/barcodes/4000000000000')).json();
    expect(res).toEqual({ product: null, spoolCount: 0, remainingG: 0 });
  });

  it('legt mehrere Spulen an, merkt die Sorte und findet sie wieder', async () => {
    const created = await post<{ id: number; barcode: string; weightRemainingG: number }[]>(
      '/api/spools/batch',
      { spool, count: 3, rememberBarcode: true },
    );
    expect(created.status).toBe(201);
    expect(created.body).toHaveLength(3);
    expect(created.body[0]).toMatchObject({ barcode: '6975337031234', weightRemainingG: 1000 });

    const lookup = (await app.inject('/api/barcodes/6975337031234')).json();
    expect(lookup.product).toMatchObject({
      manufacturer: 'Bambu Lab',
      colorName: 'Jade WeiÃŸ',
      price: 19.99,
    });
    expect(lookup).toMatchObject({ spoolCount: 3, remainingG: 3000 });

    // Erneuter Scan mit neuem Preis aktualisiert die gemerkte Sorte
    await post('/api/spools/batch', {
      spool: { ...spool, price: 17.5 },
      count: 1,
      rememberBarcode: true,
    });
    const again = (await app.inject('/api/barcodes/6975337031234')).json();
    expect(again.product.price).toBe(17.5);
    expect(again.spoolCount).toBe(4);
    expect((await app.inject('/api/products')).json()).toHaveLength(1);
  });

  it('nimmt Meldungen vom Browser entgegen', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/client-log',
      payload: { event: 'scan-photo', data: { size: 123 } },
    });
    expect(res.statusCode).toBe(204);
    const tooBig = await app.inject({
      method: 'POST',
      url: '/api/client-log',
      payload: { event: 'x', data: 'a'.repeat(70_000) },
    });
    expect(tooBig.statusCode).toBe(413);
  });

  it('prÃ¼ft Anzahl und Pflichtfelder', async () => {
    expect((await post('/api/spools/batch', { spool, count: 0 })).status).toBe(400);
    expect((await post('/api/spools/batch', { spool, count: 51 })).status).toBe(400);
    expect((await post('/api/spools/batch', { spool: { typeId: 1 }, count: 1 })).status).toBe(400);
  });

  it('merkt sich die Sorte nur auf Wunsch', async () => {
    await post('/api/spools/batch', { spool, count: 1 });
    const lookup = (await app.inject('/api/barcodes/6975337031234')).json();
    expect(lookup.product).toBeNull();
    expect(lookup.spoolCount).toBe(1);
  });
});

describe('Druckerkosten', () => {
  // Referenzwerte aus Markus' Kostenvergleich (Excel). Halot: Excel rundet die Abnutzung auf
  // 0,07 â‚¬/h (â†’ 0,274); exakt sind 200 â‚¬ / 3000 h = 0,0667 â‚¬/h (â†’ 0,2707).
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
  it.each(cases)('$name kostet $total â‚¬/h', (c) => {
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

  it('rechnet Druckzeit Ã— Stundensatz ins Projekt ein', async () => {
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
      colorName: 'WeiÃŸ',
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
