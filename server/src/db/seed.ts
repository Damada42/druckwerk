import { and, count, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

const FILAMENT_TYPES = [
  ['PLA', 'Einfach zu drucken, Standardmaterial'],
  ['PETG', 'Robust, etwas flexibel, lebensmittelecht möglich'],
  ['TPU', 'Flexibel, gummiartig'],
  ['ABS', 'Hitzebeständig, braucht Gehäuse'],
  ['ASA', 'UV-beständig, für draußen'],
  ['PA', 'Nylon, sehr zäh'],
  ['PC', 'Polycarbonat, sehr hitzebeständig'],
  ['PVA', 'Wasserlösliches Stützmaterial'],
  // Ab 0014 (bestehende Installationen bekommen sie über die Migration)
  ['PCTG', 'Wie PETG, zäher und klarer'],
  ['PVB', 'Mit Isopropanol glättbar'],
  ['PP', 'Polypropylen, leicht und chemikalienbeständig'],
  ['TPE', 'Weich-elastisch, noch flexibler als TPU'],
] as const;

const FINISHES = ['Normal', 'Matt', 'Silk', 'Glow', 'Glitzer', 'Marmor', 'Holz', 'Carbon (CF)'];

/** Legt Stammdaten an, solange die Tabellen leer sind. */
export function seed(db: BetterSQLite3Database<typeof schema>) {
  const [{ n: typeCount }] = db.select({ n: count() }).from(schema.filamentTypes).all();
  if (typeCount === 0) {
    db.insert(schema.filamentTypes)
      .values(FILAMENT_TYPES.map(([name, description]) => ({ name, description })))
      .run();
  }

  const [{ n: finishCount }] = db.select({ n: count() }).from(schema.finishes).all();
  if (finishCount === 0) {
    db.insert(schema.finishes)
      .values(FINISHES.map((name) => ({ name })))
      .run();
  }

  const [{ n: printerCount }] = db.select({ n: count() }).from(schema.printers).all();
  if (printerCount === 0) {
    // Die Modellliste legt Migration 0018 an
    const p1s = db
      .select({ id: schema.printerModels.id })
      .from(schema.printerModels)
      .innerJoin(
        schema.manufacturers,
        eq(schema.manufacturers.id, schema.printerModels.manufacturerId),
      )
      .where(and(eq(schema.manufacturers.name, 'Bambu Lab'), eq(schema.printerModels.name, 'P1S')))
      .get();
    db.insert(schema.printers)
      .values({
        name: 'P1S',
        model: 'Bambu Lab P1S',
        modelId: p1s?.id ?? null,
        nozzle: 0.4,
        hasAms: true,
        // Werte aus Markus' Kostenvergleich
        powerW: 160,
        electricityPrice: 0.2,
        purchasePrice: 1600,
        lifetimeHours: 2000,
        maintenancePerYear: 300,
        hoursPerYear: 500,
      })
      .run();
  }
}
