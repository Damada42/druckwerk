// Erkennt Spulendaten aus dem OCR-Text eines Filament-Etiketts.

export interface LabelGuess {
  typeName?: string;
  finishName?: string;
  manufacturer?: string;
  colorName?: string;
  colorHex?: string;
  weightG?: number;
  diameter?: number;
}

export interface LabelContext {
  /** Filamenttypen aus der Datenbank, z.B. ['PLA', 'PETG', 'PLA-CF'] */
  types: string[];
  /** Finishes aus der Datenbank, z.B. ['Normal', 'Matt', 'Silk'] */
  finishes: string[];
  /** Bereits verwendete Hersteller (werden zusätzlich zu den bekannten gesucht) */
  manufacturers?: string[];
}

export const KNOWN_MANUFACTURERS = [
  'Bambu Lab',
  'Prusament',
  'Polymaker',
  'Sunlu',
  'eSun',
  'Elegoo',
  'Creality',
  'Anycubic',
  'Geeetech',
  'Eryone',
  'Jayo',
  'Overture',
  'Extrudr',
  'Das Filament',
  'Formfutura',
  'Fillamentum',
  'Spectrum',
  'colorFabb',
  'Kingroon',
  '3DJake',
  'Amazon Basics',
  'Hatchbox',
  'Inland',
  'Tinmorry',
  'Nobufil',
  'Kexcelled',
  'Azurefilm',
  'Sovol',
  'Flashforge',
  'Ziro',
  'Giantarm',
  'Snapmaker',
  'QIDI',
];

/** Schreibweisen auf Etiketten → Name in der App. */
const MANUFACTURER_ALIASES: Record<string, string> = {
  bambu: 'Bambu Lab',
  bambulab: 'Bambu Lab',
  prusa: 'Prusament',
  esun: 'eSun',
  '3djake': '3DJake',
  amazonbasics: 'Amazon Basics',
};

/** Englische/deutsche Begriffe → Finish-Name in der App. */
const FINISH_SYNONYMS: Record<string, string[]> = {
  Matt: ['matte', 'matt', 'mat'],
  Silk: ['silk', 'seide', 'seidig', 'silky'],
  Glow: ['glow', 'luminous', 'nachtleuchtend', 'leuchtend'],
  Glitzer: ['glitter', 'glitzer', 'sparkle', 'galaxy', 'starlight'],
  Marmor: ['marble', 'marmor'],
  Holz: ['wood', 'holz'],
  'Carbon (CF)': ['carbon', 'cf'],
};

/** Farbwörter (de/en) → deutscher Name + Farbton. Längere Begriffe zuerst prüfen. */
const COLORS: { words: string[]; name: string; hex: string }[] = [
  { words: ['dark grey', 'dark gray', 'dunkelgrau'], name: 'Dunkelgrau', hex: '#4b4b4b' },
  { words: ['light grey', 'light gray', 'hellgrau'], name: 'Hellgrau', hex: '#c8c8c8' },
  { words: ['dark blue', 'navy', 'dunkelblau'], name: 'Dunkelblau', hex: '#1f2f6b' },
  { words: ['light blue', 'sky blue', 'hellblau'], name: 'Hellblau', hex: '#7cc4ec' },
  { words: ['dark green', 'dunkelgrün', 'dunkelgruen'], name: 'Dunkelgrün', hex: '#1f5f32' },
  { words: ['black', 'schwarz'], name: 'Schwarz', hex: '#111111' },
  { words: ['white', 'weiß', 'weiss'], name: 'Weiß', hex: '#f5f5f5' },
  { words: ['grey', 'gray', 'grau'], name: 'Grau', hex: '#8a8a8a' },
  { words: ['silver', 'silber'], name: 'Silber', hex: '#c0c0c0' },
  { words: ['gold'], name: 'Gold', hex: '#d4a017' },
  { words: ['red', 'rot'], name: 'Rot', hex: '#c62828' },
  { words: ['orange'], name: 'Orange', hex: '#f57c00' },
  { words: ['yellow', 'gelb'], name: 'Gelb', hex: '#fdd835' },
  { words: ['green', 'grün', 'gruen'], name: 'Grün', hex: '#2e7d32' },
  { words: ['blue', 'blau'], name: 'Blau', hex: '#1565c0' },
  { words: ['cyan', 'türkis', 'tuerkis', 'turquoise'], name: 'Türkis', hex: '#00acc1' },
  { words: ['purple', 'violet', 'lila', 'violett'], name: 'Lila', hex: '#7b1fa2' },
  { words: ['pink', 'rosa'], name: 'Pink', hex: '#ec407a' },
  { words: ['brown', 'braun'], name: 'Braun', hex: '#6d4c41' },
  { words: ['beige', 'ivory', 'elfenbein'], name: 'Beige', hex: '#e8dcc0' },
  {
    words: ['transparent', 'clear', 'klar', 'natural', 'natur'],
    name: 'Transparent',
    hex: '#e6eef2',
  },
];

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.,+\- ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Findet `word` als ganzes Wort (bzw. Wortfolge) im normalisierten Text. */
function hasWord(text: string, word: string) {
  const escaped = normalize(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(text);
}

function findType(text: string, types: string[]) {
  // Längste Namen zuerst, damit „PLA-CF“ vor „PLA“ gewinnt
  const sorted = [...types].sort((a, b) => b.length - a.length);
  const exact = sorted.find((t) => hasWord(text, t));
  if (exact) return exact;
  // „PLA+“, „PLA Pro“, „PETG-HF“ → Grundtyp
  return sorted.find((t) => new RegExp(`(^|[^\\p{L}])${normalize(t)}[+\\- ]`, 'u').test(text));
}

function findFinish(text: string, finishes: string[]) {
  for (const finish of finishes) {
    const words = FINISH_SYNONYMS[finish] ?? [finish];
    if (words.some((w) => hasWord(text, w))) return finish;
  }
  return undefined;
}

function findManufacturer(text: string, extra: string[]) {
  const candidates = [...new Set([...extra, ...KNOWN_MANUFACTURERS])].sort(
    (a, b) => b.length - a.length,
  );
  const direct = candidates.find((m) => hasWord(text, m));
  if (direct) return direct;
  const squashed = text.replace(/\s/g, '');
  const alias = Object.entries(MANUFACTURER_ALIASES).find(([key]) => squashed.includes(key));
  return alias?.[1];
}

function findColor(text: string) {
  for (const color of COLORS) {
    if (color.words.some((w) => hasWord(text, w))) return color;
  }
  return undefined;
}

function findWeight(text: string) {
  // „1kg“, „1 KG“, „0,5 kg“, „1000g“, „Net Weight: 250 g“
  const kg = /(\d+(?:[.,]\d+)?)\s?kg\b/.exec(text);
  if (kg) return Math.round(Number(kg[1].replace(',', '.')) * 1000);
  const g = /(\d{3,4})\s?g\b/.exec(text);
  if (g) return Number(g[1]);
  return undefined;
}

function findDiameter(text: string) {
  const m = /(1[.,]75|2[.,]85|3[.,]0?0?)\s?mm/.exec(text) ?? /\b(1[.,]75|2[.,]85)\b/.exec(text);
  return m ? Number(m[1].replace(',', '.')) : undefined;
}

/** Wertet erkannten Etikett-Text aus. Felder, die nicht sicher erkannt wurden, bleiben leer. */
/**
 * Hersteller aus einer Web-Adresse (QR-Codes führen oft nur auf die Hersteller-Seite):
 * bekannter Name, wenn die Domain passt, sonst der Domain-Name mit großem Anfangsbuchstaben.
 */
export function manufacturerFromUrl(raw: string, extra: string[] = []): string | undefined {
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    return undefined;
  }
  const parts = host.replace(/^www\./, '').split('.');
  const name = parts.length > 1 ? parts[parts.length - 2] : parts[0];
  if (!name) return undefined;
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const known = [...extra, ...KNOWN_MANUFACTURERS].find((m) => squash(m) === squash(name));
  const alias = Object.entries(MANUFACTURER_ALIASES).find(([key]) => squash(name).includes(key));
  return known ?? alias?.[1] ?? name[0].toUpperCase() + name.slice(1);
}

/**
 * Deutscher Farbname zu einem Farbwert (z.B. aus dem AMS), als Vorschlag. Nach Farbton,
 * Sättigung und Helligkeit statt „nächste Tabellenfarbe“, sonst wird Gold (#e4bd68) zu Gelb.
 */
export function colorNameFromHex(hex: string | null | undefined): string | undefined {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex ?? '');
  if (!m) return undefined;
  const [r, g, b] = m.slice(1, 4).map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;

  if (s < 0.15 || d < 0.08) {
    if (l > 0.9) return 'Weiß';
    if (l > 0.65) return 'Hellgrau';
    if (l > 0.38) return 'Grau';
    if (l > 0.16) return 'Dunkelgrau';
    return 'Schwarz';
  }
  if (h >= 5 && h < 50 && l < 0.42) return 'Braun';
  if (h >= 15 && h < 60 && l > 0.82) return 'Beige';
  if (h < 15 || h >= 345) return l > 0.62 ? 'Pink' : 'Rot';
  if (h < 35) return 'Orange';
  if (h < 55) return s < 0.85 ? 'Gold' : 'Gelb';
  if (h < 70) return 'Gelb';
  if (h < 160) return l < 0.3 ? 'Dunkelgrün' : 'Grün';
  if (h < 195) return 'Türkis';
  if (h < 250) return l < 0.35 ? 'Dunkelblau' : l > 0.65 ? 'Hellblau' : 'Blau';
  if (h < 290) return 'Lila';
  return 'Pink';
}

export function parseSpoolLabel(raw: string, ctx: LabelContext): LabelGuess {
  const text = normalize(raw);
  const color = findColor(text);
  return {
    typeName: findType(text, ctx.types),
    finishName: findFinish(text, ctx.finishes),
    manufacturer: findManufacturer(text, ctx.manufacturers ?? []),
    colorName: color?.name,
    colorHex: color?.hex,
    weightG: findWeight(text),
    diameter: findDiameter(text),
  };
}
