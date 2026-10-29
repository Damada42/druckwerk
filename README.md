# Druckwerk – 3D-Druck-Manager

Web-App (PWA) zum Verwalten von 3D-Druck-Projekten: Kanban-Board, Kunden, Team, Filament-Bestand mit
Barcode-Scan, Rechnungen, Angebote als PDF und Drucker mit Live-Status über Home Assistant. PC und Handy
greifen auf dieselben Daten zu.

Druckwerk lässt sich auf drei Arten betreiben – es ist immer dasselbe Programm (dasselbe Docker-Image):

| Weg                                                                 | Wofür                                  | Anmeldung                          |
| ------------------------------------------------------------------- | -------------------------------------- | ---------------------------------- |
| [Home-Assistant-App](#als-home-assistant-app-empfohlen) (empfohlen) | Alltag, mit HA OS                      | Home Assistant                     |
| [Docker-Container](#alternativ-docker-auf-dem-homeserver)           | Homeserver ohne HA OS, z.B. Portainer  | Login-Proxy davor (z.B. Authentik) |
| [Direkt mit Node](#entwicklung-und-betrieb-direkt-mit-node)         | Entwicklung, Test am Handy im Heimnetz | keine                              |

Druckwerk hat **keine eigene Anmeldung**. Es darf daher nur über Home Assistant, hinter einem
Login-Proxy oder im Heimnetz laufen – **nie ungeschützt ins Internet stellen**.

## Als Home-Assistant-App (empfohlen)

1. In Home Assistant **Einstellungen → Apps → App Store**, oben rechts **⋮ → Repositories** und
   `https://github.com/Damada42/druckwerk` hinzufügen.
2. **Druckwerk** installieren, starten und „In Seitenleiste anzeigen“ einschalten.
3. Druckwerk öffnet sich über die Seitenleiste, am Handy in der Home-Assistant-App – auch von
   unterwegs (z.B. über Nabu Casa).

Die Verbindung zu diesem Home Assistant besteht automatisch, ohne Token. Weitere Standorte lassen sich
in den Einstellungen mit Adresse und langlebigem Zugriffstoken hinzufügen. Datenbank und Rechnungen
liegen in der Samba-Freigabe **addon_configs** (`…_druckwerk`) und sind Teil der Home-Assistant-Backups.

Details, Datenumzug aus dem Docker-Container und Hinweise: [`ha-app/DOCS.md`](ha-app/DOCS.md).

**Updates:** Die Version in `ha-app/config.yaml` erhöhen und auf `main` pushen. GitHub Actions baut das
Image mit dieser Version, danach bietet Home Assistant unter Einstellungen → Apps das Update an.

## Alternativ: Docker auf dem Homeserver

Druckwerk läuft als Container, Cloudflare-Tunnel und Authentik-Outpost davor sorgen für HTTPS und Login
(mit MFA).

```
Handy ─HTTPS─▶ Cloudflare ─Tunnel─▶ Authentik-Outpost ─HTTP─▶ Druckwerk-Container (:3000)
```

1. **Image:** Bei jedem Push auf `main` baut GitHub Actions (`.github/workflows/docker.yml`) nach den Tests
   das Image `ghcr.io/<github-name>/druckwerk:latest` (privat).
2. **Portainer:** Unter _Registries_ `ghcr.io` mit GitHub-Name und einem Token (classic, Recht
   `read:packages`) anlegen. Dann _Stacks → Add stack_, Inhalt von `docker-compose.yml` einfügen
   und deployen. Updates: im Stack _Pull and redeploy_.
3. **Authentik:** Provider _Proxy_ (Modus „Proxy“) mit External host `https://druckwerk.<domain>` und
   Internal host `http://<Server-IP>:3100`, dazu eine Application und beides dem Outpost zuweisen.
4. **Cloudflare:** Im Tunnel einen Public Hostname `druckwerk.<domain>` auf den Outpost legen – wie bei
   den anderen Diensten.
5. **Daten umziehen** (falls vorhanden): Am PC `npm run export -w server` (geht bei laufendem Server) und
   den erzeugten Ordner `server/data/export/druckwerk-…` auf den Server kopieren. Dort den Container
   **stoppen** und die Daten mit einem Hilfscontainer ins Volume legen – die alten Datenbankdateien
   müssen weg, sonst spielt SQLite die `-wal`-Datei der leeren Start-Datenbank in die kopierte ein:

   ```bash
   docker run --rm -v druckwerk_druckwerk-data:/data -v /pfad/zum/druckwerk-…:/import alpine sh -c "rm -f /data/3dapp.db*; cp -r /import/. /data/"
   ```

   Dann den Container wieder starten. Den Volume-Namen zeigt Portainer unter _Volumes_ (Stack-Name +
   `_druckwerk-data`). Danach den Server am PC beenden, sonst bucht auch er weiter Filament ab.

6. **Home Assistant:** In den Einstellungen eine Verbindung mit der lokalen Adresse
   (`http://<HA-IP>:8123`) und einem langlebigen Zugriffstoken anlegen – schneller und unabhängig vom
   Internet. Bei übernommenen Daten genügt es, die Adresse zu ändern.
7. **Handy:** `https://druckwerk.<domain>` öffnen, anmelden, im Menü „Zum Startbildschirm“ – mit dem echten
   Zertifikat installiert sich Druckwerk als richtige App.

Läuft die Anmeldung ab, lädt die App von selbst neu und landet beim Authentik-Login.
**Backup:** das Volume `…_druckwerk-data` sichern.

## Entwicklung und Betrieb direkt mit Node

Voraussetzung: [Node.js](https://nodejs.org) 22 oder neuer.

```bash
npm install
```

**Entwicklung** (Server auf Port 3000, Oberfläche mit Hot-Reload auf Port 5173):

```bash
npm run dev
```

Dann im Browser `https://localhost:5173` öffnen – vom Handy aus `https://<IP-des-PCs>:5173`.

**Wie im Betrieb** (Oberfläche bauen und alles über eine Adresse auf Port 3000 ausliefern – am besten
zum Testen am Handy):

```bash
npm run prod
```

Danach ist die App unter `https://<IP-des-PCs>:3000` erreichbar.

### HTTPS im Heimnetz

Ohne Proxy davor läuft die App über **HTTPS**, weil Handy-Browser die Live-Kamera (Barcode-Scanner) nur
über eine sichere Verbindung freigeben. Beim ersten Start erzeugt sie ein eigenes Zertifikat für
`localhost`, den Rechnernamen und die Netzwerk-IP (`server/data/certs/tls.json`, gültig 825 Tage). Ändert
sich die IP, wird es automatisch neu erstellt.

- Beim **ersten Aufruf** zeigt jeder Browser eine Warnung („Verbindung ist nicht privat“), weil das
  Zertifikat nicht von einer offiziellen Stelle stammt. Einmal mit **„Erweitert → Trotzdem fortfahren“**
  bestätigen.
- Die Adresse muss mit **`https://`** beginnen; `http://` antwortet nicht.
- Mit selbst erstelltem Zertifikat lässt sich die App nicht als PWA installieren (Browser verlangen
  dafür ein offizielles Zertifikat). Im Browser funktioniert alles normal; ein Lesezeichen auf dem
  Startbildschirm geht trotzdem.
- HTTPS abschalten: `HTTPS=false` setzen (so läuft auch der Container hinter dem Proxy).

| Variable      | Standard      | Bedeutung                              |
| ------------- | ------------- | -------------------------------------- |
| `API_PORT`    | `3000`        | Port des Servers                       |
| `HOST`        | `0.0.0.0`     | Netzwerk-Interface                     |
| `DATA_DIR`    | `server/data` | Ablage für Datenbank und Rechnungen    |
| `HTTPS`       | `true`        | `false` = nur HTTP (keine Live-Kamera) |
| `HA_POLL_MS`  | `20000`       | Abfrage-Intervall Home Assistant (ms)  |
| `TRUST_PROXY` | `false`       | `true` hinter einem Reverse-Proxy      |

**Backup:** Den Ordner `server/data` sichern (enthält `3dapp.db` samt `-wal`-Datei und alle
hochgeladenen Rechnungen).

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

**Lagerplätze (fertig):** Unter „Einstellungen → Lagerplätze“ einschaltbar. Dann gibt es die Seite
„Lager“ (am Handy über den Knopf „Lager“ auf der Filament-Seite): Regale und Schränke mit beliebig
tiefen Unterplätzen anlegen, z.B. „Wandregal › Links › Reihe 2“, umbenennen, sortieren und löschen. Jede
Spule bekommt ihren Platz per Auswahl – auf der Lager-Seite direkt, im Spulen-Formular und beim Scannen.
Gelöschte Plätze nehmen ihre Unterplätze mit; die Spulen darin verlieren nur die Zuordnung. Ausgeschaltet
bleibt das freie Feld „Lagerort“ wie bisher.

**Angebote & Rechnungen (fertig):** Unter „Einstellungen → Firmendaten“ Name, Adresse, Kontakt, Bank,
optional UID-Nummer und ein Logo eintragen (am besten PNG mit transparentem Hintergrund oder SVG; jedes
Bildformat wird im Browser in PNG umgewandelt). Mit Haken „Kleinunternehmer“ gibt es keine Umsatzsteuer,
dafür steht „Kleinunternehmer gemäß § 6 Abs. 1 Z 27 UStG“ auf jedem Dokument; ohne Haken wird mit dem
eingestellten Satz (Standard 20 %) netto/USt./brutto ausgewiesen. Im Projekt unter „Angebot & Rechnung“
entsteht das PDF: Empfänger aus dem Kunden, erste Position aus Projekttitel und Preis, fortlaufende
Nummern pro Jahr (AN-2026-001, RE-2026-001). Aus einem Angebot wird mit „Als Rechnung“ eine Rechnung.
Rechnungen erscheinen zusätzlich unter „Rechnungen“ als Ausgang. Einmal erstellte PDFs bleiben unverändert.

- **Aufschlag / Marge:** Im Projekt unter „Allgemein“ ein Prozentwert (z.B. 10 %), den jede Position eines
  neuen Angebots bzw. einer Rechnung als Vorschlag bekommt. In der Spalte „Aufschlag %“ lässt er sich je
  Position und Dokument ändern, ohne den Projektwert zu überschreiben. Auf dem PDF steht nur der
  Einzelpreis inklusive Aufschlag – der Aufschlag selbst ist für den Kunden nicht sichtbar.
- **UID-Nummer:** Ebenfalls unter „Allgemein“ als Haken vorgeben, ob die UID-Nummer aufs Dokument kommt;
  im Angebot bzw. in der Rechnung je Dokument umschaltbar.

- **Alle Positionen:** Ein neues Angebot bzw. eine neue Rechnung listet die Projektkosten einzeln auf –
  je Filament eine Materialposition, die Druckzeit mit dem Stundensatz des Druckers und alle
  Zusatzkosten mit Menge und Einheit. Ohne Kosten gibt es wie bisher eine Pauschalposition aus Titel und
  Verkaufspreis; mit „Aus Projektkosten“ und „Pauschal (Verkaufspreis)“ lässt sich umschalten.
- **Dateien ansehen:** PDFs und Fotos öffnen in der App (auch in der Home-Assistant-App am Handy, wo ein
  neues Fenster ohne Anmeldung nur „401 Unauthorized“ zeigen würde), mit Knopf „Herunterladen“.

**Zusatzkosten-Kategorien:** Unter „Einstellungen“ erweiterbar (z.B. Versand, Verpackung,
Nachbearbeitung), jeweils mit Einheit (Stück, Packung, Meter …) und optionalem Standardpreis. Im Projekt
übernimmt die gewählte Kategorie Einheit und Preis als Vorschlag; beides bleibt je Position änderbar.
Ohne Beschreibung steht auf dem Dokument der Kategoriename. Verwendete Kategorien lassen sich nicht löschen.

**Verkaufspreis automatisch:** Bei neuen Projekten folgt der Verkaufspreis den Gesamtkosten plus
Aufschlag (Gewinn = Aufschlag). Wer selbst einen Preis einträgt, beendet den Automatikbetrieb; der Haken
„Aus den Kosten berechnen“ schaltet ihn wieder ein. Bestehende Projekte mit Preis behalten ihren Preis.
Die Pauschalposition im Angebot nimmt den Verkaufspreis ohne weiteren Aufschlag.

**Projekt speichern:** Das Fenster bleibt nach dem Speichern offen und meldet „Gespeichert“ – so geht es
gleich mit Angebot oder Rechnung weiter.

**Sorte bearbeiten:** Hast du mehrere Spulen derselben Sorte (gleicher Typ, Farbe, Finish, Hersteller),
ändert „Sorte bearbeiten“ in der aufgeklappten Gruppe Preis, Farbe, Hersteller, Finish, Durchmesser und
Spulengewicht für alle auf einmal. Restmenge, Lagerplatz und Notizen bleiben je Spule.

**Filament wird knapp:** Jeder Filamenttyp hat unter „Einstellungen“ eine Mindestmenge (Vorgabe 200 g).
Auf der Filament-Seite lässt sie sich je Sorte im Feld „min.“ anpassen (leer = Vorgabe des Typs); neue
Spulen derselben Sorte übernehmen sie. In den Einstellungen wählst du, wie die Übersicht zusammenzählt:
nach Hersteller und Farbe (150 g Bambu Lab Schwarz sind knapp, auch wenn 800 g Sunlu Schwarz da sind)
oder nur nach Farbe (zusammen 950 g Schwarz reichen).

**Herstellerliste:** Der Hersteller einer Spule kommt aus einer Auswahl (Einstellungen → Hersteller,
mit den gängigen Herstellern vorbefüllt), damit keine Tippfehler doppelte Sorten erzeugen. Ein neuer
Hersteller lässt sich direkt im Formular über „Neuer Hersteller …“ eintragen; „bambu lab“ wird zu
„Bambu Lab“. Umbenennen in den Einstellungen ändert alle Spulen mit.

**Backup:** Unter „Einstellungen → Backup“ lädt „Backup herunterladen“ eine ZIP-Datei mit allen Daten,
Rechnungen, Fotos und dem Logo. „Backup einspielen“ ersetzt alles durch den Stand der Datei (auch aus
älteren Versionen); der vorherige Stand bleibt als Sicherheitskopie im Datenordner unter `backup/`.
