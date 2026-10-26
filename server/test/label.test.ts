import { colorNameFromHex, manufacturerFromUrl, parseSpoolLabel } from '@3dapp/shared';
import { describe, expect, it } from 'vitest';

describe('Farbname aus Farbwert', () => {
  it('benennt die Farben im AMS von Markus und typische Bambu-Farben', () => {
    expect(colorNameFromHex('#FF671FFF')).toBe('Orange');
    expect(colorNameFromHex('#FFFFFFFF')).toBe('Weiß');
    expect(colorNameFromHex('#0A2989FF')).toBe('Dunkelblau');
    expect(colorNameFromHex('#E4BD68FF')).toBe('Gold');
    expect(colorNameFromHex('#000000')).toBe('Schwarz');
    expect(colorNameFromHex('#8E9089')).toBe('Grau');
    expect(colorNameFromHex('#C12E1F')).toBe('Rot');
    expect(colorNameFromHex('#F4EE2A')).toBe('Gelb');
    expect(colorNameFromHex('#00AE42')).toBe('Grün');
    expect(colorNameFromHex('#0086D6')).toBe('Blau');
    expect(colorNameFromHex('#5E43B7')).toBe('Lila');
    expect(colorNameFromHex('#F55A74')).toBe('Pink');
    expect(colorNameFromHex('#9D432C')).toBe('Braun');
    expect(colorNameFromHex('#F7E6DE')).toBe('Beige');
    expect(colorNameFromHex(null)).toBeUndefined();
  });
});

const ctx = {
  types: ['PLA', 'PETG', 'TPU', 'ABS', 'ASA', 'PA', 'PC', 'PVA', 'PLA-CF'],
  finishes: ['Normal', 'Matt', 'Silk', 'Glow', 'Glitzer', 'Marmor', 'Holz', 'Carbon (CF)'],
};

describe('Etikett erkennen', () => {
  it('Bambu-Lab-Etikett', () => {
    const text = `Bambu Lab
      PLA Matte
      Charcoal Black
      Net Weight: 1kg  Diameter: 1.75mm ± 0.03mm
      Printing Temp 190-230°C`;
    expect(parseSpoolLabel(text, ctx)).toEqual({
      typeName: 'PLA',
      finishName: 'Matt',
      manufacturer: 'Bambu Lab',
      colorName: 'Schwarz',
      colorHex: '#111111',
      weightG: 1000,
      diameter: 1.75,
    });
  });

  it('Sunlu Silk PLA+ in Gold, Gewicht in Gramm', () => {
    const g = parseSpoolLabel('SUNLU  SILK PLA+  GOLD  1.75 mm  NW 1000g', ctx);
    expect(g).toMatchObject({
      typeName: 'PLA',
      finishName: 'Silk',
      manufacturer: 'Sunlu',
      colorName: 'Gold',
      weightG: 1000,
      diameter: 1.75,
    });
  });

  it('längerer Typname gewinnt (PLA-CF vor PLA)', () => {
    expect(parseSpoolLabel('Polymaker PLA-CF Dark Grey 500 g', ctx)).toMatchObject({
      typeName: 'PLA-CF',
      manufacturer: 'Polymaker',
      colorName: 'Dunkelgrau',
      weightG: 500,
    });
  });

  it('deutsches Etikett mit Komma', () => {
    expect(parseSpoolLabel('Das Filament  PETG  Weiß  0,75 kg  2,85 mm', ctx)).toMatchObject({
      typeName: 'PETG',
      manufacturer: 'Das Filament',
      colorName: 'Weiß',
      weightG: 750,
      diameter: 2.85,
    });
  });

  it('übersteht OCR-Rauschen und erkennt Hersteller aus Schreibweise', () => {
    const noisy = 'eSUN | ~ PETG ~ | Solid  B1ack ? | ...| 1KG | esun3d.com | TRANSPARENT? no';
    const g = parseSpoolLabel(noisy, ctx);
    expect(g.typeName).toBe('PETG');
    expect(g.manufacturer).toBe('eSun');
    expect(g.weightG).toBe(1000);
  });

  it('erfindet nichts bei unbekanntem Text', () => {
    expect(parseSpoolLabel('Danke für Ihren Einkauf!', ctx)).toEqual({
      typeName: undefined,
      finishName: undefined,
      manufacturer: undefined,
      colorName: undefined,
      colorHex: undefined,
      weightG: undefined,
      diameter: undefined,
    });
  });

  it('kennt eigene Hersteller aus der Datenbank', () => {
    expect(
      parseSpoolLabel('Werkstatt Müller TPU 95A Rot', {
        ...ctx,
        manufacturers: ['Werkstatt Müller'],
      }),
    ).toMatchObject({ manufacturer: 'Werkstatt Müller', typeName: 'TPU', colorName: 'Rot' });
  });

  it('verwechselt Wortteile nicht mit Typen (PA in „Paket“, PC in „PCs“)', () => {
    const g = parseSpoolLabel('Paket mit 2 PCs Ersatzteilen', ctx);
    expect(g.typeName).toBeUndefined();
  });
});

describe('Hersteller aus QR-Adresse', () => {
  it('erkennt bekannte Hersteller an der Domain', () => {
    expect(manufacturerFromUrl('https://www.nobufil.com/feinschmelzer')).toBe('Nobufil');
    expect(manufacturerFromUrl('https://bambulab.com/de/filament')).toBe('Bambu Lab');
    expect(manufacturerFromUrl('https://shop.esun3d.net/x')).toBe('eSun');
  });

  it('nimmt sonst den Domain-Namen, bei Unsinn nichts', () => {
    expect(manufacturerFromUrl('https://www.meinfilament.de/a')).toBe('Meinfilament');
    expect(manufacturerFromUrl('kein link')).toBeUndefined();
  });
});
