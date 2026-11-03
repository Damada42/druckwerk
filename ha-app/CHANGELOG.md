# Änderungen

## 0.8.4

- Spulen-Auswahl am AMS-Slot nennt den Lagerplatz jeder Spule, bzw. in welchem Slot sie schon steckt.
- Unter einer zugeordneten Spule steht ihr Lagerplatz – so weißt du beim Wechseln, wohin sie zurückgehört.
- Lager: jede Spule zeigt ihr Finish (Basic, Matt …) und, wenn sie in Verwendung ist,
  in welchem Drucker und Slot sie gerade steckt.

## 0.8.3

- Spulen-Auswahl am AMS-Slot zeigt nur Spulen mit Typ, Hersteller und Finish aus dem Slot
  („Bambu PETG Basic“ → Bambu Lab, PETG, Normal), die ähnlichste Farbe zuerst.
- Die Auswahl nennt das Finish jeder Spule; „Alle Spulen anzeigen“ holt den restlichen Bestand dazu.

## 0.8.2

- Neuer Drucker: Die Auswahl des Home-Assistant-Geräts füllt Name und Modell vor
  (z.B. „the_one“ / „Bambu Lab P1S“). Eingetippte Werte bleiben stehen.

## 0.8.1

- Nach einer abgelaufenen HA-Sitzung (Tab lange im Hintergrund) erscheint kein leeres
  „401: Unauthorized“ mehr; Druckwerk lädt die Daten weiter, sobald HA die Sitzung erneuert.

## 0.8.0

- Backup nach Bereichen: beim Sichern und Einspielen lassen sich Projekte, Kunden, Team,
  Filament, Lager, Drucker, Firmendaten und Einstellungen einzeln wählen.
- Vor dem Einspielen zeigt Druckwerk, was im Backup steckt.

## 0.7.2

- „Gleiche Spule nochmal anlegen“ kopiert die AMS-Zuordnung nicht mehr mit.
  Doppelte Zuordnungen werden aufgelöst (die zuerst angelegte Spule bleibt im Slot).

## 0.7.1

- Das Backup-ZIP lässt sich im Windows-Explorer entpacken (Fehler 0x80004005 behoben).

## 0.7.0

- Klipper-Drucker über die Integration „Moonraker“: Status, Fortschritt, Restzeit, Schichten,
  Temperaturen, Vorschaubild, Pause/Fortsetzen/Abbrechen und Geschwindigkeit in Prozent.
- Platz „Spule im Drucker“: der Verbrauch in Metern wird in Gramm umgerechnet und abgebucht.
- Drucker-Seite am Handy nicht mehr breiter als der Bildschirm.

## 0.6.1

- Scannen in der Home-Assistant-App: Live-Scanner statt Foto (Fotos öffnen dort nur die Galerie).
- Bei einem neuen Barcode wird der Aufdruck daneben gleich mitgelesen.

## 0.6.0

- „Filament wird knapp“ nach Sorten, wahlweise je Hersteller und Farbe oder nur je Farbe.
- Mindestmenge je Filamenttyp (Vorgabe 200 g) und eigene Menge je Sorte.
- Herstellerliste mit einheitlicher Schreibweise; neue Typen PCTG, PVB, PP, TPE.
- Backup: alle Daten und Dateien als ZIP herunterladen und wieder einspielen.

## 0.5.2

- Handy: Kanban-Spalten 72 % breit, ruhigeres Scrollen beim Ziehen, „Mehr“-Menü in der unteren Leiste.
- Kostenvergleich der Drucker passt ohne seitliches Scrollen.

## 0.5.1

- Verkaufspreis folgt automatisch den Gesamtkosten plus Aufschlag, bis du selbst einen einträgst.
- PDF: die eigene Adresse steht nicht mehr doppelt.

## 0.5.0

- Angebot/Rechnung listen Filament, Druckzeit und alle Zusatzkosten einzeln auf
  (umschaltbar auf eine Pauschalposition).
- Zusatzkosten-Kategorien mit Einheit und Standardpreis in den Einstellungen.
- PDFs und Rechnungsfotos öffnen in der App (kein 401 mehr in der HA-App am Handy).
- Projekt speichern lässt das Fenster offen.
- Zahlenfelder lassen sich leeren und neu tippen.

## 0.4.0

- „Sorte bearbeiten“ ändert Preis, Farbe, Hersteller, Finish usw. für alle Spulen einer Sorte.
- Aufschlag in Prozent und UID-Nummer je Projekt und je Angebot/Rechnung.

## 0.3.0

- Lagerplätze für Spulen, Angebote und Rechnungen als PDF.
