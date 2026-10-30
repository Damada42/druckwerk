# Druckwerk

3D-Druck-Manager direkt in Home Assistant: Projekt-Kanban, Kunden, Team, Filament-Bestand mit
Barcode-Scan, Rechnungen und Drucker mit Live-Status, Steuerung, Kameras und automatischer
Filament-Abbuchung.

## Installation

1. **Einstellungen → Apps → App Store**, oben rechts **⋮ → Repositories** und
   `https://github.com/Damada42/druckwerk` hinzufügen.
2. **Druckwerk** auswählen, **Installieren**, dann **Starten**. „In Seitenleiste anzeigen“ einschalten.
3. Druckwerk öffnet sich über die Seitenleiste – die Anmeldung ist die von Home Assistant, Druckwerk
   ist von außen nicht direkt erreichbar.

## Home Assistant

Drucker kommen aus den Integrationen „Bambu Lab“ (mit bis zu vier AMS) und „Moonraker“ (Klipper).
Die Verbindung zu diesem Home Assistant besteht automatisch (Einstellungen in Druckwerk zeigen
„Dieses Home Assistant (App)“) – kein Token nötig. Weitere Home-Assistant-Instanzen, z.B. in der
Werkstatt, lassen sich wie gewohnt mit Adresse und langlebigem Zugriffstoken hinzufügen.

## Daten

Datenbank, Rechnungen und Diagnose-Log liegen im App-Ordner, über die Samba-Freigabe
**addon_configs** im Ordner `…_druckwerk` erreichbar. Sie sind Teil der Home-Assistant-Backups.

### Daten aus dem Docker-Container übernehmen

1. Am PC bzw. im alten Container `npm run export -w server` ausführen.
2. Die App **stoppen**, im App-Ordner `3dapp.db`, `3dapp.db-wal` und `3dapp.db-shm` löschen
   (sonst spielt SQLite die alte WAL-Datei in die kopierte Datenbank ein) und den Inhalt des
   Export-Ordners hineinkopieren.
3. Die App starten. Unter **Einstellungen** in Druckwerk die alte Verbindung zum **selben** Home
   Assistant trennen – sonst erscheinen die Drucker doppelt. Kameras aus dieser Verbindung danach
   neu hinzufügen (diesmal aus „Home Assistant“).
4. Den alten Container stoppen, sonst bucht auch er weiter Filament ab.

## Hinweise

- Der **Live-Barcode-Scanner** braucht eine sichere Verbindung: Home Assistant über `https://`
  öffnen (z.B. Nabu Casa). Über `http://homeassistant.local:8123` geht das Scannen per Foto.
- Für ein Update erhöht der Entwickler die Version in `ha-app/config.yaml`; Home Assistant zeigt es
  dann unter Einstellungen → Apps an.
