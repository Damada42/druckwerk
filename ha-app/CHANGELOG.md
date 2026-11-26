# Änderungen

## 0.11.0

- Neu: **Druckermodelle** unter Einstellungen – eine Liste je Hersteller, schon mit gängigen Modellen
  von Bambu Lab, Prusa, Anycubic, Creality, Elegoo, QIDI, Flashforge und weiteren, selbst erweiterbar.
- Im Druckerformular erst den Hersteller wählen, dann erscheinen nur dessen Modelle. Beim Verknüpfen
  mit Home Assistant wird das Modell automatisch gewählt. Bestehende Drucker sind schon zugeordnet.
- Ersatzteile passen jetzt zu **mehreren Modellen**; die Ersatzteil-Seite lässt sich nach Modell
  filtern, und beim Wartungspunkt stehen die passenden Teile oben.
- Wartungsnachrichten an **mehrere Ziele** und auch per **Telegram** (wenn die Telegram-Integration in
  Home Assistant eingerichtet ist). Text aus einer Vorlage oder selbst geschrieben, mit Vorschau.
- Optional eine **Erinnerung** alle paar Tage, solange eine Wartung fällig ist.
- Das bisher gewählte Handy bleibt als Ziel erhalten.

## 0.10.0

- Klipper mit **MMU** (z.B. Happy Hare): ein Platz je Gate statt nur einer Spule. Die Gates kommen aus
  den Filamentsensoren von Moonraker, oder du gibst die Anzahl Slots im Druckerformular an.
- Optional eine **Zusatz-Entity** am Drucker (z.B. REST-Sensor auf Happy Hares `mmu`-Objekt): dann
  zeigt Druckwerk Material, Farbe und Name je Gate, „Übernehmen“ legt die Spule im Bestand an, und
  der Verbrauch wird nach Druckzeit auf die Gates aufgeteilt.
- Ohne Zusatz-Entity weiß Druckwerk nicht, welches Gate gedruckt hat, und bucht nur ab, wenn genau
  einem Gate eine Spule zugeordnet ist.
- Bei Klipper-Druckern heißt es jetzt „MMU“ statt „AMS“.

## 0.9.0

- Neu: **Ersatzteile & Wartung** (unter Einstellungen einschalten). Ersatzteile mit Hersteller,
  Artikelnummer, Shop-Link, Preis, Lagerbestand und Mindestbestand – auch im Lager an ihrem Platz.
- Jeder Drucker bekommt einen Wartungsplan: Punkte zum Tauschen, Reinigen, Schmieren oder Prüfen,
  fällig nach Betriebsstunden und/oder Monaten. Die Betriebsstunden kommen bei Bambu-Druckern aus
  „Gesamtnutzung“, bei Klipper aus der Gesamtdruckzeit; ohne Home Assistant trägst du sie selbst ein.
- Vorwarnung (Standard 300 h bzw. 14 Tage vorher) auf der Druckerkarte und in der Übersicht unter
  „Wartung fällig“, mit den benötigten Teilen und ihrem Lagerstand.
- „Wartung erledigt“ setzt die Zähler zurück, bucht getauschte Teile vom Lager ab und schreibt ins
  Wartungsprotokoll; die letzte Wartung lässt sich rückgängig machen.
- Für P1S/P1P gibt es eine Vorlage nach Bambus Wartungsempfehlung: Stangen monatlich reinigen,
  Z-Spindeln alle drei Monate fetten usw. Punkte, die Bambu nach Rollen oder Zustand empfiehlt
  (Schneidklinge, PTFE-Schlauch, Hotend …), bekommen beim Übernehmen dein eigenes Intervall.
- Optional eine Push-Nachricht über die Companion App, wenn eine Wartung bald bzw. jetzt fällig ist.

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
