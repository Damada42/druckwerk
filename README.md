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

Dann im Browser `http://localhost:5173` öffnen – vom Handy aus `http://<IP-des-PCs>:5173`.

**Dauerbetrieb** (eine Adresse für alles, Port 3000):

```bash
npm run build
```

```bash
npm start
```

Danach ist die App unter `http://<IP-des-PCs>:3000` erreichbar und lässt sich auf dem Handy über
„Zum Startbildschirm hinzufügen“ wie eine App installieren.

| Variable   | Standard      | Bedeutung                           |
| ---------- | ------------- | ----------------------------------- |
| `API_PORT` | `3000`        | Port des Servers                    |
| `HOST`     | `0.0.0.0`     | Netzwerk-Interface                  |
| `DATA_DIR` | `server/data` | Ablage für Datenbank und Rechnungen |

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

- **Phase 2:** Filament per Handy-Kamera scannen (Barcode/QR, Bambu-RFID über AMS)
- **Phase 3:** Rechnungen per OCR auslesen (Betrag, Datum vorschlagen)
- **Phase 4:** Home-Assistant-Anbindung für Live-Status des Bambu Lab P1S (Fortschritt, Temperaturen, AMS-Slots)
