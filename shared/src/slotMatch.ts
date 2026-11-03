import type { FilamentSpool, FilamentType, Finish } from './index';
import { parseSpoolLabel } from './label';
import type { AmsSlot } from './printer';

/** Was laut AMS im Slot steckt – leere Felder filtern nicht */
export interface SlotFilament {
  typeName?: string;
  manufacturer?: string;
  finishName?: string;
}

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Liest Typ, Hersteller und Finish aus dem Slot-Namen („Bambu PETG Basic“, „Generic PLA“).
 * Bei erkanntem Hersteller ohne Finish-Wort gilt „Normal“ (Bambu „Basic“, „HF“);
 * bei „Generic“ bleibt das Finish offen, weil das AMS es nicht kennt.
 */
export function slotFilament(
  slot: Pick<AmsSlot, 'name' | 'type'>,
  types: FilamentType[],
  finishes: Finish[],
): SlotFilament {
  if (!slot.type && !slot.name) return {};
  const guess = parseSpoolLabel(`${slot.name ?? ''} ${slot.type ?? ''}`, {
    types: types.map((t) => t.name),
    finishes: finishes.map((f) => f.name),
  });
  const typeName = guess.typeName ?? slot.type ?? undefined;
  const finishName =
    guess.finishName ??
    (guess.manufacturer && finishes.some((f) => f.name === 'Normal') ? 'Normal' : undefined);
  return { typeName, manufacturer: guess.manufacturer, finishName };
}

/** Passt die Spule zu dem, was im Slot steckt? */
export function spoolMatchesSlot(
  spool: FilamentSpool,
  want: SlotFilament,
  types: FilamentType[],
  finishes: Finish[],
): boolean {
  if (want.typeName) {
    const type = types.find((t) => t.id === spool.typeId)?.name ?? '';
    if (type.toLowerCase() !== want.typeName.toLowerCase()) return false;
  }
  // „Bambulab“ und „Bambu Lab“ sind derselbe Hersteller
  if (want.manufacturer && squash(spool.manufacturer) !== squash(want.manufacturer)) return false;
  if (want.finishName) {
    const finish = finishes.find((f) => f.id === spool.finishId)?.name ?? 'Normal';
    if (finish !== want.finishName) return false;
  }
  return true;
}

function rgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
}

/** Abstand zweier Farben (0 = gleich, max. ≈ 442); unbekannte Farben ganz hinten (1000) */
export function colorDistance(a: string | null | undefined, b: string | null | undefined) {
  const x = a ? rgb(a) : null;
  const y = b ? rgb(b) : null;
  if (!x || !y) return 1000;
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/**
 * Spulen für die Auswahl an einem Slot: `matching` passt zu Typ, Hersteller und Finish
 * im Slot (nach Farbnähe zum Slot sortiert), `others` ist der restliche Bestand (nach Typ,
 * Hersteller und Farbe). Leere Spulen fallen weg, außer der zugeordneten.
 */
export function spoolsForSlot(
  slot: Pick<AmsSlot, 'name' | 'type' | 'color'>,
  spools: FilamentSpool[],
  types: FilamentType[],
  finishes: Finish[],
  linkedId?: number,
) {
  const want = slotFilament(slot, types, finishes);
  const typeName = (s: FilamentSpool) => types.find((t) => t.id === s.typeId)?.name ?? '';
  const byName = (a: FilamentSpool, b: FilamentSpool) =>
    typeName(a).localeCompare(typeName(b), 'de') ||
    a.manufacturer.localeCompare(b.manufacturer, 'de') ||
    a.colorName.localeCompare(b.colorName, 'de');
  const byColor = (a: FilamentSpool, b: FilamentSpool) =>
    colorDistance(a.colorHex, slot.color) - colorDistance(b.colorHex, slot.color) || byName(a, b);
  const available = spools.filter((s) => s.weightRemainingG > 0 || s.id === linkedId);
  const matching: FilamentSpool[] = [];
  const others: FilamentSpool[] = [];
  for (const s of available)
    (spoolMatchesSlot(s, want, types, finishes) ? matching : others).push(s);
  return { want, matching: matching.sort(byColor), others: others.sort(byName) };
}
