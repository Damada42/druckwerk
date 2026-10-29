// Mindestmengen: Wann wird Filament knapp? Vorgabe je Filamenttyp, eigene Menge je Sorte.

import type { FilamentSpool, FilamentType, Finish } from './index';

/** Wie Spulen für „Filament wird knapp“ zusammengezählt werden */
export type LowStockGroup = 'manufacturer' | 'color';

export const LOW_STOCK_GROUP_LABELS: Record<LowStockGroup, string> = {
  manufacturer: 'Nach Hersteller und Farbe',
  color: 'Nur nach Farbe (alle Hersteller zusammen)',
};

export interface StockGroup {
  key: string;
  typeId: number;
  colorName: string;
  colorHex: string;
  /** Name des Finish („Normal“, wenn keins gesetzt ist) */
  finish: string;
  /** Hersteller in dieser Gruppe (nach Farbe zusammengezählt auch mehrere) */
  manufacturers: string[];
  spools: FilamentSpool[];
  remaining: number;
  /** Ab dieser Restmenge (g) ist die Gruppe knapp */
  minStockG: number;
  /** Mindestmenge, die an der Sorte selbst eingetragen ist (sonst null = Vorgabe des Typs) */
  ownMinStockG: number | null;
}

/** Mindestmenge einer Spule: eigene Angabe der Sorte, sonst die Vorgabe ihres Typs */
export function spoolMinStock(spool: FilamentSpool, types: FilamentType[]) {
  return spool.minStockG ?? types.find((t) => t.id === spool.typeId)?.minStockG ?? 200;
}

/**
 * Spulen zu Sorten zusammenfassen: Typ + Farbe + Finish, nach Hersteller auch dieser. Nach Farbe
 * zusammengezählt gilt die höchste Mindestmenge der enthaltenen Sorten.
 */
export function stockGroups(
  spools: FilamentSpool[],
  types: FilamentType[],
  finishes: Finish[],
  mode: LowStockGroup = 'manufacturer',
): StockGroup[] {
  const finishName = (id: number | null) => finishes.find((f) => f.id === id)?.name ?? 'Normal';
  const groups = new Map<string, StockGroup>();
  for (const s of spools) {
    const finish = finishName(s.finishId);
    const key = [
      s.typeId,
      s.colorName.trim().toLowerCase(),
      finish.toLowerCase(),
      ...(mode === 'manufacturer' ? [s.manufacturer.trim().toLowerCase()] : []),
    ].join('|');
    const g = groups.get(key) ?? {
      key,
      typeId: s.typeId,
      colorName: s.colorName,
      colorHex: s.colorHex,
      finish,
      manufacturers: [],
      spools: [],
      remaining: 0,
      minStockG: 0,
      ownMinStockG: null,
    };
    g.spools.push(s);
    g.remaining += s.weightRemainingG;
    g.minStockG = Math.max(g.minStockG, spoolMinStock(s, types));
    if (s.minStockG !== null && s.minStockG !== undefined)
      g.ownMinStockG = Math.max(g.ownMinStockG ?? 0, s.minStockG);
    if (!g.manufacturers.includes(s.manufacturer)) g.manufacturers.push(s.manufacturer);
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** Knappe Sorten, die knappste (im Verhältnis zur Mindestmenge) zuerst */
export function lowStock(
  spools: FilamentSpool[],
  types: FilamentType[],
  finishes: Finish[],
  mode: LowStockGroup = 'manufacturer',
): StockGroup[] {
  return stockGroups(spools, types, finishes, mode)
    .filter((g) => g.remaining < g.minStockG)
    .sort((a, b) => a.remaining / a.minStockG - b.remaining / b.minStockG);
}
