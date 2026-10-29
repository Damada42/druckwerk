import type { BarcodeLookup, SpoolBatchInput } from '@3dapp/shared';
import { count, eq, sum } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { schema, type Db } from '../db/index.js';
import { missingFields, pickColumns } from './crud.js';
import { prepareSpool } from './manufacturers.js';

const { filamentProducts, filamentSpools } = schema;

/** EAN/UPC & Co.: nur Ziffern/Buchstaben, keine Leerzeichen */
export function cleanBarcode(raw: string) {
  // Leerraum und unsichtbare Steuerzeichen (GS1-Feldtrenner) entfernen; QR-Codes enthalten oft lange Adressen
  return raw.replace(/[\s\u0000-\u001f\u007f]+/g, '').slice(0, 256);
}

export function registerScanRoutes(app: FastifyInstance, db: Db) {
  app.get<{ Params: { code: string } }>('/barcodes/:code', (req): BarcodeLookup => {
    const code = cleanBarcode(req.params.code);
    const product = db
      .select()
      .from(filamentProducts)
      .where(eq(filamentProducts.barcode, code))
      .get();
    const stock = db
      .select({ n: count(), remaining: sum(filamentSpools.weightRemainingG) })
      .from(filamentSpools)
      .where(eq(filamentSpools.barcode, code))
      .get();
    return {
      product: product ?? null,
      spoolCount: stock?.n ?? 0,
      remainingG: Number(stock?.remaining ?? 0),
    };
  });

  /** Mehrere gleiche Spulen anlegen und den Barcode optional als Sorte merken. */
  app.post<{ Body: SpoolBatchInput }>('/spools/batch', (req, reply) => {
    const { spool, count: rawCount, rememberBarcode } = req.body ?? ({} as SpoolBatchInput);
    let data = pickColumns(filamentSpools, spool);
    const missing = missingFields(data, ['typeId', 'manufacturer', 'colorName']);
    if (missing.length) {
      return reply.code(400).send({ error: `Pflichtfelder fehlen: ${missing.join(', ')}` });
    }
    const n = Math.floor(Number(rawCount));
    if (!Number.isFinite(n) || n < 1 || n > 50) {
      return reply.code(400).send({ error: 'Anzahl muss zwischen 1 und 50 liegen' });
    }
    data = prepareSpool(db, data, true);
    const barcode =
      typeof data.barcode === 'string' && data.barcode ? cleanBarcode(data.barcode) : null;
    const total = Number(data.weightTotalG ?? 1000);
    const row = { ...data, barcode, weightRemainingG: data.weightRemainingG ?? total };

    const created = db.transaction((tx) => {
      const spools = Array.from({ length: n }, () =>
        tx
          .insert(filamentSpools)
          .values(row as typeof filamentSpools.$inferInsert)
          .returning()
          .get(),
      );
      if (barcode && rememberBarcode) {
        const product = {
          barcode,
          typeId: Number(data.typeId),
          manufacturer: String(data.manufacturer),
          colorName: String(data.colorName),
          colorHex: (data.colorHex as string) ?? '#cccccc',
          finishId: (data.finishId as number | null) ?? null,
          diameter: Number(data.diameter ?? 1.75),
          weightTotalG: total,
          price: (data.price as number | null) ?? null,
        };
        tx.insert(filamentProducts)
          .values(product)
          .onConflictDoUpdate({ target: filamentProducts.barcode, set: product })
          .run();
      }
      return spools;
    });
    return reply.code(201).send(created);
  });
}
