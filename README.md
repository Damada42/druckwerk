# Druckwerk – 3D-Druck-Manager

Web-App (PWA) zum Verwalten von 3D-Druck-Projekten: Kanban-Board, Kunden, Team, Filament-Bestand und Drucker.
Läuft als kleiner Server im Heimnetz; PC und Handy greifen auf dieselben Daten zu.

## Starten

Voraussetzung: [Node.js](https://nodejs.org) 22 oder neuer.

```bash
npm install
```

**Entwicklung** (Server auf Port 3000, Oberfläche mit Hot-Reload auf Port 5173):

```bash
npm run dev
```

Dann im Browser `https://localhost:5173` öffnen – vom Handy aus `https://<IP-des-PCs>:5173`.

**Dauerbetrieb** (eine Adresse für alles, Port 3000):

```bash
npm run build
```

```bash
npm start
```

Danach ist die App unter `https://<IP-des-PCs>:3000` erreichbar.

### HTTPS im Heimnetz

Die App läuft über **HTTPS**, weil Handy-Browser die Live-Kamera (Barcode-Scanner) nur über eine
sichere Verbindung freigeben. Beim ersten Start erzeugt sie ein eigenes Zertifikat für `localhost`, den
Rechnernamen und die Netzwerk-IP (`server/data/certs/tls.json`, gültig 825 Tage). Ändert sich die IP,
wird es automatisch neu erstellt.

- Beim **ersten Aufruf** zeigt jeder Browser eine Warnung („Verbindung ist nicht privat“), weil das
  Zertifikat nicht von einer offiziellen Stelle stammt. Einmal mit **„Erweitert → Trotzdem fortfahren“**
  bestätigen.
- Die Adresse muss mit **`https://`** beginnen; `http://` antwortet nicht mehr.
- Mit selbst erstelltem Zertifikat lässt sich die App nicht als PWA installieren (Browser verlangen
  dafür ein offizielles Zertifikat). Im Browser funktioniert alles normal; ein Lesezeichen auf dem
  Startbildschirm geht trotzdem.
- HTTPS abschalten: `HTTPS=false` setzen.

| Variable     | Standard      | Bedeutung                              |
| ------------ | ------------- | -------------------------------------- |
| `API_PORT`   | `3000`        | Port des Servers                       |
| `HOST`       | `0.0.0.0`     | Netzwerk-Interface                     |
| `DATA_DIR`   | `server/data` | Ablage für Datenbank und Rechnungen    |
| `HTTPS`      | `true`        | `false` = nur HTTP (keine Live-Kamera) |
| `HA_POLL_MS` | `20000`       | Abfrage-Intervall Home Assistant (ms)  |

**Backup:** Den Ordner `server/data` sichern (enthält `3dapp.db` und alle hochgeladenen Rechnungen).

## Aufbau

```
shared/   gemeinsame Typen, Konstanten, Kostenberechnung
server/   Fastify + SQLite (Drizzle ORM), REST-API unter /api
client/   React + Vite + Tailwind, PWA
```

- Datenbank-Schema: `server/src/db/schema.ts`. Nach Änderungen `npm run db:generate -w server` ausführen;
  die Migration wird beim nächsten Serverstart automatisch angewendet.
- Tests: `npm test`, Typprüfung: `npm run typecheck`.
- Klick-Tests (Playwright, nutzt das installierte Chrome headless): `npm run e2e`.
  Läuft auf Port 3200 mit einer frischen Datenbank – deine Daten bleiben unberührt.
  Zum Zuschauen mit sichtbarem Browser: `npm run e2e:ui`, Bericht ansehen: `npm run e2e:report`.

## Stand & nächste Schritte

**Phase 1 (fertig):** Übersicht, Projekt-Kanban mit Drag & Drop, Projektdetails (Team, Material,
Zusatzkosten, Rechnungen inkl. PDF/Foto-Upload, Kostenrechnung), Kunden, Team, Filament nach
Typ → Farbe/Finish/Hersteller → Spule, Drucker mit Kosten pro Druckstunde (Strom, Abnutzung,
Wartung) und Kostenvergleich, Einstellungen. Projekte rechnen Druckzeit × Stundensatz als
Maschinenkosten ein.

**Phase 2 (fertig):** Filament scannen unter „Filament → Scannen“:

- **Barcode** (EAN/UPC/QR) live mit der Kamera, als Foto oder eingetippt. Beim ersten Scan füllst du die
  Sorte aus, danach ist sie vorausgefüllt; mehrere gleiche Spulen auf einmal anlegen.
- **Etikett-Foto:** Texterkennung (Tesseract, Deutsch + Englisch) schlägt Typ, Hersteller, Farbe, Finish,
  Gewicht und Durchmesser vor. Die Sprachdaten (~10 MB) lädt der Browser beim ersten Mal aus dem
  Internet und speichert sie danach.
- Über HTTPS öffnet „Barcode / QR-Code scannen“ den **Live-Scanner** im Kamerabild. Manche Handys
  erlauben dem Browser keinen Autofokus – dann bleibt das Live-Bild unscharf. Die App erkennt das,
  merkt es sich und nimmt ab dann direkt ein **Foto über die Kamera-App** (mit Autofokus).
- Sind Strichcode und QR-Code auf dem Foto, gewinnt der Strichcode. QR-Codes, die nur auf die
  Hersteller-Webseite führen, liefern den Hersteller, merken sich aber keine Sorte (wären bei allen
  Farben gleich).

**Phase 3 (fertig):** Rechnungen auslesen unter „Projekt → Rechnungen“: Beim Anhängen eines PDFs
oder Fotos schlägt die App **Endbetrag, Rechnungsdatum, Rechnungsnummer und als Beschreibung die
gekauften Artikel samt Händler** vor, z.B. „SUNLU PLA Filament 1.75mm (Amazon)“ (Feld-Hinweis „erkannt“).
Ab drei Artikeln steht dort „… + 2 weitere“; ohne erkennbare Artikeltabelle nur der Händler. PDFs mit Textebene werden direkt gelesen (pdf.js), Fotos und eingescannte PDFs per
Texterkennung. Von Hand eingetragene Werte bleiben unangetastet; der erkannte Text ist zum Prüfen
aufklappbar.

**Phase 4 (fertig):** Home-Assistant-Anbindung für Bambu-Lab-Drucker (Integration „Bambu Lab“ in HA):

- **Einrichten:** Unter „Einstellungen → Home Assistant“ einen Standort-Namen, die Adresse (z.B.
  `http://homeassistant.local:8123`) und einen langlebigen Zugriffstoken eintragen (HA → Profil →
  Sicherheit → Langlebige Zugriffstoken). Adresse und Token bleiben auf dem Server; die Adresse wird nur
  gekürzt angezeigt (`https://abc•••.ui.nabu.casa`). Danach unter „Drucker → Bearbeiten“ das gefundene
  HA-Gerät wählen.
- **Mehrere Standorte:** Beliebig viele Home-Assistant-Verbindungen, z.B. „Zuhause“ und „Werkstatt“. Die
  Drucker aller Standorte stehen in derselben Auswahl; ist ein Standort offline, laufen die anderen weiter.
- **Live-Status** auf der Drucker-Seite und in der Übersicht: Status, Fortschritt, Schicht, Restzeit,
  Endzeit, Temperaturen, Auftrag mit Vorschaubild.
- **Steuerung:** Pause, Fortsetzen, Abbrechen (mit Rückfrage) und Druckraumbeleuchtung. Während eines
  Drucks außerdem die **Geschwindigkeit** (Leise 50 %, Standard, Sport 124 %, Ludicrous 166 %) und
  **Teile überspringen**: Plattenbild mit markierten Teilen, Teile ankreuzen, bestätigen – mindestens ein
  Teil muss weiterlaufen.
- **AMS:** Die Slots zeigen Material, Farbe und Rest-% laut Drucker. Jedem Slot lässt sich eine Spule aus
  dem Bestand zuordnen; im Filament-Bestand steht sie dann als „Im AMS, Slot n“. Ist die Spule noch nicht
  im Bestand, legt „Übernehmen“ sie mit den AMS-Daten an (Hersteller, Typ, Farbe mit deutschem Farbnamen,
  Restmenge aus Rest-%) und ordnet sie gleich zu – Farbname und Preis danach bei Bedarf anpassen.
- **Automatisch abbuchen:** Der Server fragt HA alle 20 s ab (`HA_POLL_MS`), merkt sich, welcher Slot wie
  lange gedruckt hat, und bucht nach dem Druck das Druckgewicht von den zugeordneten Spulen ab. Bei
  mehreren Farben wird nach Druckzeit aufgeteilt, abgebrochene Drucke anteilig nach Fortschritt (beides als
  „≈ geschätzt“ markiert). Jede Abbuchung lässt sich auf der Drucker-Seite rückgängig machen. Läuft der
  Server während eines Drucks nicht, wird dieser Druck nicht gebucht.
