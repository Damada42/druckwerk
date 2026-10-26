import { describeInvoice, findAmounts, findDate, parseInvoice } from '@3dapp/shared';
import { describe, expect, it } from 'vitest';

describe('Beträge und Daten erkennen', () => {
  it('liest deutsche und englische Schreibweise, ignoriert Daten und Mengen', () => {
    expect(findAmounts('Summe 1.234,56 €')).toEqual([1234.56]);
    expect(findAmounts('Total $1,234.56')).toEqual([1234.56]);
    expect(findAmounts('2 x 8,00 = 16,00')).toEqual([8, 16]);
    expect(findAmounts('Datum 12.03.2026, Menge 3')).toEqual([]);
    expect(findAmounts('Gewicht 1.75 mm')).toEqual([1.75]);
  });

  it('versteht gängige Datumsformate', () => {
    expect(findDate('Rechnungsdatum: 05.03.2026')).toBe('2026-03-05');
    expect(findDate('Datum 5.3.26')).toBe('2026-03-05');
    expect(findDate('Invoice date 2026-10-01')).toBe('2026-10-01');
    expect(findDate('12. März 2026')).toBe('2026-03-12');
    expect(findDate('Order placed March 7, 2026')).toBe('2026-03-07');
    expect(findDate('31.02.2026')).toBeUndefined();
  });
});

describe('Rechnung auslesen', () => {
  it('Elektronik-Händler: Endbetrag statt Zwischensumme oder MwSt', () => {
    const g = parseInvoice(`
      reichelt elektronik GmbH & Co. KG
      Elektronikring 1, 26452 Sande
      Rechnung
      Rechnungsnummer: RE-2026-004711
      Rechnungsdatum: 14.10.2026
      Lieferdatum: 12.10.2026
      Pos  Artikel                 Menge   Preis    Gesamt
      1    Arduino Nano            2       8,40     16,80
      2    WS2812B LED-Streifen 1m 1       12,90    12,90
      Zwischensumme netto                            24,96
      MwSt. 19 %                                      4,74
      Versand                                          5,95
      Gesamtbetrag                                    35,65 €
    `);
    expect(g).toEqual({
      amount: 35.65,
      date: '2026-10-14',
      number: 'RE-2026-004711',
      vendor: 'Reichelt',
      items: ['Arduino Nano', 'WS2812B LED-Streifen 1m'],
    });
    expect(describeInvoice(g)).toBe('Arduino Nano, WS2812B LED-Streifen 1m (Reichelt)');
  });

  it('Amazon-PDF: umbrochene Artikelnamen ohne ASIN, Preise und Steuer', () => {
    const g = parseInvoice(`
      Rechnung
      Verkauft von ePerformances GmbH
      Rechnungsdatum
      /Lieferdatum  30 September 2026
      MARKUS MUSTER  Rechnungsnummer  DE60027O6N70TU
      Zahlbetrag  10,07 €
      Amazon.de
      Rechnungsdetails
      Beschreibung  Menge  Stückpreis  USt. %  Stückpreis  Zwischensumme
      (ohne USt.)  (inkl. USt.)  (inkl. USt.)
      SUNLU PLA Filament 1.75mm 1kg, 3D Drucker  1  8,39 €  20 %  10,07 €  10,07 €
      Filament PLA Spule, Schwarz | B07PGY2JP1 ( 6936601312345 )
      Versandkosten  0,00 €  20 %  0,00 €  0,00 €
      Gesamtpreis  8,39 €  1,68 €  10,07 €
    `);
    expect(g.amount).toBe(10.07);
    expect(g.items).toEqual([
      'SUNLU PLA Filament 1.75mm 1kg, 3D Drucker Filament PLA Spule, Schwarz',
    ]);
    expect(describeInvoice(g)).toBe(
      'SUNLU PLA Filament 1.75mm 1kg, 3D Drucker Filament PLA Spule, Schwarz (Amazon)',
    );
  });

  it('Amazon-Foto: verstümmelter Tabellenkopf und Preise ohne Komma (echter OCR-Text)', () => {
    const g = parseInvoice(`
      amazonde chun
      Verkauft von Amazon EU S.ar.l.
      /Lieferdatum: 16 September 2026
      MARKUS MUSTER Rechnungsnummer LU6S93EI3AEUI
      MUSTERSTRASSE 1 Zahlbetrag 5,03€
      Bestellinformationen 3 SEE es
      Rechnungsdetails SRE
      Bes i Sh ati i Menge: Stückpreis USE % Stückpreis Zwischensumme
      SAE eR (ohne USt) (inkl. USt) (inkl. USt)
      ‚Hama Steckdosenleiste 3-Fach, ohne Schalter, 1,4m, GS Gepruf| |... 1 419€ 20% 5,03€ 503€
      ASIN: BO0006J9XX ans:
      Versandkosten 0,00€ 0,00 € 0,00€
      Gesamtpreis 5.03€
    `);
    expect(g.amount).toBe(5.03);
    expect(g.items).toEqual(['Hama Steckdosenleiste 3-Fach, ohne Schalter, 1,4m, GS Gepruf']);
    expect(describeInvoice(g)).toBe(
      'Hama Steckdosenleiste 3-Fach, ohne Schalter, 1,4m, GS Gepruf (Amazon)',
    );
  });

  it('mehrere Artikel mit ASIN-Zeilen; ab drei Artikeln wird zusammengefasst', () => {
    const g = parseInvoice(`
      Amazon EU S.à r.l.
      Beschreibung  Menge  Stückpreis  Zwischensumme
      Kingroon Druckbett PEI Federstahlplatte 257 x 257 mm  1  24,99 €  24,99 €
      ASIN: B0ABCDEFGH
      Messing Gewindeeinsätze M3 Set, 100 Stück  2  7,49 €  14,98 €
      ASIN: B0BCDEFGHI
      Isopropanol 99,9 % 1 Liter  1  9,90 €  9,90 €
      ASIN: B0CDEFGHIJ
      Gesamtpreis  49,87 €
    `);
    expect(g.items).toEqual([
      'Kingroon Druckbett PEI Federstahlplatte 257 x 257 mm',
      'Messing Gewindeeinsätze M3 Set, 100 Stück',
      'Isopropanol 99,9 % 1 Liter',
    ]);
    expect(describeInvoice(g)).toBe(
      'Kingroon Druckbett PEI Federstahlplatte 257 x 257 mm + 2 weitere (Amazon)',
    );
  });

  it('Amazon: Bestellnummer, „Zahlbetrag“ und Monatsnamen', () => {
    const g = parseInvoice(`
      Rechnung
      Amazon EU S.à r.l.
      Rechnungsdatum / Lieferdatum 3. Oktober 2026
      Rechnungsnummer DE6ABCDEF12345
      Bestellnummer 302-1234567-7654321
      Zwischensumme (ohne USt.) 21,00 €
      USt. 19 % 3,99 €
      Zahlbetrag 24,99 €
    `);
    expect(g.amount).toBe(24.99);
    expect(g.date).toBe('2026-10-03');
    expect(g.number).toBe('DE6ABCDEF12345');
    expect(g.vendor).toBe('Amazon');
  });

  it('englische Rechnung mit Betrag in der Zeile darunter (Tabellen-Layout aus OCR)', () => {
    const g = parseInvoice(`
      AliExpress
      Invoice No. 8123456789
      Invoice Date: Sep 28, 2026
      Subtotal
      US $18.20
      Shipping
      US $2.10
      Order Total
      US $20.30
    `);
    expect(g.amount).toBe(20.3);
    expect(g.date).toBe('2026-09-28');
    expect(g.number).toBe('8123456789');
    expect(g.vendor).toBe('AliExpress');
  });

  it('unbekannter Händler: Firmenname mit Rechtsform, Notlösung größter Euro-Betrag', () => {
    const g = parseInvoice(`
      Holzwerkstatt Meier GmbH, Hauptstr. 3, 12345 Berlin
      Beleg Nr. 2026/117 vom 01.09.2026
      Buchenholzplatte 18 mm      2 Stk     19,50 €
      Leimholz                    1 Stk     12,00 €
      Bitte überweisen Sie 51,00 €
    `);
    expect(g.amount).toBe(51);
    expect(g.date).toBe('2026-09-01');
    expect(g.number).toBe('2026/117');
    expect(g.vendor).toBe('Holzwerkstatt Meier GmbH');
  });

  it('leerer oder unbrauchbarer Text liefert keine Werte statt Unsinn', () => {
    expect(parseInvoice('')).toEqual({
      amount: undefined,
      date: undefined,
      number: undefined,
      vendor: undefined,
      items: [],
    });
    expect(parseInvoice('Hallo Welt\nkeine Zahlen hier').amount).toBeUndefined();
  });
});
