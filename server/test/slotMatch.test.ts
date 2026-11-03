import { colorDistance, spoolsForSlot, slotFilament, type FilamentSpool } from '@3dapp/shared';
import { describe, expect, it } from 'vitest';

const types = [
  { id: 1, name: 'PLA', description: null, minStockG: 200 },
  { id: 2, name: 'PETG', description: null, minStockG: 200 },
];
const finishes = [
  { id: 1, name: 'Normal' },
  { id: 2, name: 'Matt' },
  { id: 3, name: 'Silk' },
];

let nextId = 1;
const spool = (p: Partial<FilamentSpool>): FilamentSpool => ({
  id: nextId++,
  typeId: 2,
  manufacturer: 'Bambu Lab',
  colorName: 'Schwarz',
  colorHex: '#000000',
  finishId: 1,
  diameter: 1.75,
  weightTotalG: 1000,
  weightRemainingG: 500,
  price: null,
  purchaseDate: null,
  location: null,
  storageLocationId: null,
  haTrayEntity: null,
  barcode: null,
  notes: null,
  minStockG: null,
  createdAt: '',
  ...p,
});

describe('Spulen für einen AMS-Slot', () => {
  it('liest Typ, Hersteller und Finish aus dem Slot-Namen', () => {
    expect(slotFilament({ name: 'Bambu PETG Basic', type: 'PETG' }, types, finishes)).toEqual({
      typeName: 'PETG',
      manufacturer: 'Bambu Lab',
      finishName: 'Normal',
    });
    expect(slotFilament({ name: 'Bambu PLA Matte', type: 'PLA' }, types, finishes)).toMatchObject({
      finishName: 'Matt',
    });
    // Fremdspule: Hersteller und Finish unbekannt, nur der Typ filtert
    expect(slotFilament({ name: 'Generic PETG', type: 'PETG' }, types, finishes)).toEqual({
      typeName: 'PETG',
      manufacturer: undefined,
      finishName: undefined,
    });
    // Klipper meldet nichts: kein Filter
    expect(slotFilament({ name: null, type: null }, types, finishes)).toEqual({});
  });

  it('zeigt nur Typ, Hersteller und Finish aus dem Slot, nach Farbnähe sortiert', () => {
    const orange = spool({ colorName: 'Orange', colorHex: '#ff6a13' });
    const schwarz = spool({});
    const schwarzMatt = spool({ finishId: 2 });
    const sunlu = spool({ manufacturer: 'Sunlu', colorName: 'Orange', colorHex: '#ff6a13' });
    const pla = spool({ typeId: 1, colorName: 'Orange', colorHex: '#ff6a13' });
    const leer = spool({ colorName: 'Orange', colorHex: '#ff6a13', weightRemainingG: 0 });
    const gelb = spool({ manufacturer: 'Bambulab', colorName: 'Gelb', colorHex: '#f4ee2a' });

    const { matching, others } = spoolsForSlot(
      { name: 'Bambu PETG Basic', type: 'PETG', color: '#ff6a13' },
      [schwarz, schwarzMatt, sunlu, pla, leer, gelb, orange],
      types,
      finishes,
    );
    expect(matching.map((s) => s.id)).toEqual([orange.id, gelb.id, schwarz.id]);
    expect(others.map((s) => s.id).sort()).toEqual([schwarzMatt.id, sunlu.id, pla.id].sort());
  });

  it('behält eine leere Spule, wenn sie zugeordnet ist', () => {
    const leer = spool({ weightRemainingG: 0 });
    const { matching } = spoolsForSlot(
      { name: 'Bambu PETG Basic', type: 'PETG', color: null },
      [leer],
      types,
      finishes,
      leer.id,
    );
    expect(matching).toEqual([leer]);
  });

  it('sortiert unbekannte Farben ans Ende', () => {
    expect(colorDistance('#000000', '#000000')).toBe(0);
    expect(colorDistance('#000000', '#ffffff')).toBeLessThan(colorDistance('#000000', null));
  });
});
