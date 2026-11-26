// Kategorien für Ersatzteile: unter Einstellungen bearbeitbar und erweiterbar. Die mitgelieferten
// haben einen festen Schlüssel, damit die automatische Zuordnung (Name → Kategorie) sie auch nach
// dem Umbenennen findet.

export interface PartCategory {
  id: number;
  /** Fester Schlüssel: mitgelieferte z.B. „hotend“, eigene „c-<uuid>“ */
  key: string;
  name: string;
  position: number;
}

/** Mitgelieferte Kategorien in ihrer Reihenfolge */
export const PART_CATEGORY_SEED: { key: string; name: string }[] = [
  { key: 'hotend', name: 'Hotend' },
  { key: 'nozzle', name: 'Düsen' },
  { key: 'extruder', name: 'Extruder' },
  { key: 'feed', name: 'Filamentführung' },
  { key: 'ams', name: 'AMS / MMU' },
  { key: 'bed', name: 'Druckbett' },
  { key: 'axes', name: 'Achsen & Führungen' },
  { key: 'drive', name: 'Antrieb & Motoren' },
  { key: 'cooling', name: 'Kühlung' },
  { key: 'electronics', name: 'Elektronik' },
  { key: 'control', name: 'Steuerung' },
  { key: 'enclosure', name: 'Gehäuse' },
  { key: 'consumables', name: 'Wartung & Verbrauchsmaterial' },
  { key: 'other', name: 'Sonstiges' },
];

/**
 * Stichwörter im Namen (klein geschrieben) → Kategorie. Die erste passende Regel gewinnt, daher
 * steht z.B. „wischer“ (Düsenwischer) vor „düse“ und „bett“ vor „thermistor“. Wörter mit
 * führendem Leerzeichen müssen am Wortanfang stehen („ ams“ passt nicht auf „Klammer“).
 * Dieselbe Liste steckt als SQL in der Migration 0020 (bestehende Teile).
 */
export const PART_CATEGORY_RULES: [key: string, words: string[]][] = [
  [
    'consumables',
    [
      'wischer',
      'wiper',
      'fett',
      'grease',
      'schmier',
      'lube',
      'kleber',
      'glue',
      'reinigung',
      'schraube',
      'screw',
    ],
  ],
  ['ams', [' ams', ' mmu', 'happy hare']],
  ['bed', ['bett', ' bed', 'platte', 'build plate', 'plate', 'pei', 'magnetfolie']],
  ['nozzle', ['düse', 'nozzle']],
  [
    'hotend',
    [
      'hotend',
      'hot end',
      'heizblock',
      'heater',
      'heizpatrone',
      'thermistor',
      'silikon',
      'silicone',
    ],
  ],
  ['extruder', ['extruder', 'cutter', 'schneid', 'zahnrad', 'gear']],
  [
    'feed',
    [
      'ptfe',
      'bowden',
      'schlauch',
      'tube',
      'kupplung',
      'coupler',
      'puffer',
      'buffer',
      'spulenhalter',
      'spool holder',
    ],
  ],
  ['cooling', ['lüfter', ' fan', 'kühl', 'cooling', 'heatsink']],
  ['drive', ['riemen', 'belt', 'motor', 'spindel', 'lead screw', 'pulley']],
  ['axes', ['stange', ' rod', 'linear', 'schiene', 'rail', 'lager', 'bearing', 'achse', 'welle']],
  ['control', ['mainboard', 'board', 'display', 'screen', 'platine', 'touch']],
  [
    'electronics',
    ['netzteil', 'kabel', 'cable', 'sensor', 'kamera', 'camera', ' led', 'licht', 'power supply'],
  ],
  [
    'enclosure',
    [
      'gehäuse',
      'tür',
      'door',
      'deckel',
      ' lid',
      'aktivkohle',
      'carbon filter',
      'dichtung',
      'scharnier',
      'glas',
    ],
  ],
];

/** Kategorie-Schlüssel zu einem Teilenamen; ohne Treffer „other“ (Sonstiges) */
export function guessPartCategory(name: string): string {
  const text = ` ${name.toLowerCase()}`;
  return (
    PART_CATEGORY_RULES.find(([, words]) => words.some((w) => text.includes(w)))?.[0] ?? 'other'
  );
}
