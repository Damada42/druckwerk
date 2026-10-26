# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Druckwerk is a 3D-printing manager: a PWA plus a small home-network server (Node + SQLite). It manages a project Kanban board, customers, team members, filament stock with barcode/OCR scanning, printers with cost per print hour and Bambu Lab live status via Home Assistant, and invoices with OCR prefill. The user is German; the UI text, code comments, test names and README are all German. Keep it that way.

## Commands

Requires Node 22+. On this Windows machine, PowerShell calls may need the PATH refreshed first:
`$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`

- `npm run dev`: server (tsx watch, port 3000) and Vite client (port 5173, proxies `/api` and `/uploads` to 3000), both over HTTPS.
- `npm run prod`: builds the client, then the server serves it plus the API on port 3000. Use this for phone testing. The Vite dev server reloads the page when its HMR websocket reconnects (for example after coming back from the camera app), and on Windows it sometimes serves stale module transforms after multi-step edits.
- `npm run typecheck`: `tsc --noEmit` for both server and client. There is no linter; formatting is done with Prettier. `npm run format` (`prettier --write .`) also rewrites other sessions' checkouts under `.claude/worktrees/`, so run `npx prettier --write <changed files>` instead.
- `npm test`: server unit tests (vitest). For a single file or test, run `npx vitest run --root server test/label.test.ts -t "<name>"`.
- `npm run e2e`: builds the client first, then runs Playwright with the installed Chrome (`channel: 'chrome'`, no browser download). It starts its own server on port 3200 with a temporary `DATA_DIR`. Tests in a project share one database and run sequentially, so later specs depend on earlier ones. For a single spec, run `npx playwright test e2e/scan.spec.ts --project desktop`, but only after `npm run build`.
- `npm run db:generate -w server`: after changing `server/src/db/schema.ts`, generate a migration in `server/drizzle/`. Migrations run automatically on server start. drizzle-kit asks interactively when a change could be a column rename (a column added and one dropped in the same table). That prompt can't be answered here, so add the new column in one migration and drop the old one in a second (see `0003`/`0004`). To move existing data, append SQL to the generated file after a `--> statement-breakpoint` (see `0005`, which moves the HA URL and token from `settings` into `ha_connections`). Before a data migration reaches the user's real database:
  - Stop the prod server.
  - Copy `server/data/3dapp.db` together with its `-wal` and `-shm` files into `server/data/backup/` (git-ignored). WAL mode keeps most of the data in the `-wal` file.

Env vars: `API_PORT` (default 3000; deliberately not `PORT`, which the preview tooling sets), `HOST`, `DATA_DIR` (default `server/data`: DB, uploads, certs, `client-log.jsonl`), `HTTPS=false` to disable TLS, `HA_POLL_MS` (default 20000; the e2e server uses 500).

## Architecture

The repo is an npm-workspaces monorepo: `shared/`, `server/`, `client/`.

### shared/

`shared/` is consumed directly as TypeScript source (`main: src/index.ts`, no build step). It holds:

- Domain interfaces and German label constants (statuses, cost categories, roles).
- Cost math used by both sides: `calcPrinterHourly` (electricity + wear + maintenance per hour) and `calcProjectCosts` (filament + print hours × hourly rate + extras).
- `label.ts`: `parseSpoolLabel` turns OCR text into a filament guess (type, manufacturer, color, finish, weight, diameter).
- `invoice.ts`: `parseInvoice` extracts the gross total (keyword tiers, so subtotal, VAT and shipping are skipped), invoice date, number, vendor and item names from invoice text. Items come from the line-item table (header found by description/quantity/price columns, tolerant of OCR garbling); `describeInvoice` turns them into the description, e.g. "Hama Steckdosenleiste … (Amazon)". Unit tests live in `server/test/invoice.test.ts`, since only the server has vitest.
- `printer.ts`: `parsePrinterLive` turns Home Assistant entities of the `bambu_lab` integration into a `PrinterLive` status. Entities are matched by entity-id suffix in German and English (the user's HA runs in German: `sensor.the_one_druckstatus`), with a leading `_` so `temperatur_der_duse` doesn't also match `zieltemperatur_der_duse`. AMS slots and the external spool are found by their attributes (`tray_uuid`, `slot`), not by name. AMS units are separate HA devices linked to the printer via `via_device_id`.

### server/

Fastify 5 + better-sqlite3 + drizzle-orm.

- `src/app.ts` `buildApp(options)` builds the app without listening. Tests use it with `dbFile: ':memory:'` and `app.inject`.
- The error handler must be registered before the route plugins. It maps SQLite FK and UNIQUE violations to German 409 responses.
- `routes/crud.ts` provides a generic `registerCrud` used for the simple entities.
- `routes/projects.ts`: on create and update, a project replaces its members, filaments and costs wholesale. `PATCH /projects/:id/move` uses fractional `position` values for Kanban ordering.
- `routes/scan.ts`: barcode lookup and batch spool creation. Remembered products live in `filament_products`, keyed by a unique barcode.
- `routes/clientLog.ts`: `POST /api/client-log` receives browser diagnostics, writes them to the server log and appends them to `DATA_DIR/client-log.jsonl`. When debugging phone behavior, read that file. The `sample` field holds a JPEG data URL of what the live scanner saw (`scan-live`), or the first 6000 characters of recognized text (`invoice-read`), so parser misreads can be turned into unit tests.
- `src/cert.ts` `ensureCert` generates and caches a self-signed certificate covering localhost, the hostname and LAN IPs. The Vite dev server reuses the same certificate from `server/data/certs`.
- In production the server also serves `client/dist` with an SPA fallback, plus `/uploads`.
- Home Assistant (`src/ha/`, `routes/ha.ts`):
  - `client.ts` `createHaClient` manages several HA connections (one per location) from the `ha_connections` table. Neither URL nor token is ever sent to the browser: `/api/ha/status` returns `maskUrl(url)`, and error messages name the location instead of the address.
  - Printers store only `haDeviceId`. HA device IDs are unique across instances, so the hub finds a printer's connection by looking up the device in the merged entities. `entities()` returns `{ entities, errors }`; an unreachable location shows up in `errors` and does not break the others.
  - It fetches all Bambu entities in one `POST /api/template` request (`BAMBU_TEMPLATE`). The template only copies whitelisted attributes, because some HA attributes (sets) can't be serialized with `tojson`. On the user's HA, some sensors have `options` as a set, so `options` is only taken from `select.` entities and piped through `| list`. If one attribute can't be serialized, the whole live status fails, so check template changes against the real HA with `ha_eval_template` before shipping.
  - Speed (`POST /printers/:id/speed`) sets the `select` entity. Skipping objects (`POST /printers/:id/skip`) calls `bambu_lab.skip_objects` with `device_id` and comma-joined object IDs from the printable-objects sensor; the server refuses to skip the last remaining object. Both are only possible while printing.
  - Entity results are cached for 2 s for browser polling; the watcher always passes `fresh: true`.
  - `tracker.ts` `PrintTracker` is pure. It credits the time between two polls to the AMS slot that was printing at the start of that interval. When a job ends it returns a `BookingPlan`: full print weight on finish, weight × progress when the job fails, split by slot time when several slots printed.
  - `watcher.ts` runs the tracker every `haPollMs`. `bookPlan` deducts from the spool whose `haTrayEntity` equals the slot entity. `filament_bookings` has a unique index on (job key, spool), so a job is never booked twice. A booking can be undone with `DELETE /api/bookings/:id`.
  - `POST /api/ams-import` creates a spool from live AMS slot data and links it to the slot. The manufacturer, type and finish come from `parseSpoolLabel` on the slot name; the color name comes from `colorNameFromHex` in `label.ts`, which uses hue, saturation and lightness bands (tested against Bambu's palette).
  - `buildApp` returns `{ app, db, ha, watcher }`. Tests pass `haFetch` and call `watcher.tick(now)` manually.
  - `server/test/fake-ha.ts` (`FakeHa`) emulates HA from a fixture of the user's real P1S data (`test/fixtures/bambu-p1s.json`). The e2e global setup runs it as an HTTP server on port 3299; `POST /test/print` and `GET /test/calls` steer and inspect it.

### client/

React 19, Vite 7, Tailwind v4 (tokens in `index.css`), React Router 7 and TanStack Query.

- `src/api.ts` holds all data hooks (`useList`, `useSave`, an optimistic `useMoveProject`, …).
- `components/ui.tsx` holds the shared primitives and German formatters (`euro`, `grams`, `dateDe`).
- `ColorDot` draws on a `<canvas>` on purpose. Samsung Internet's forced dark mode recolors CSS backgrounds, SVG and even `<img>` swatches: large dots get darkened (white turned black), small ones lightened. Neither `<meta name="color-scheme">` nor `color-scheme: only light` stops this. A test page on the user's phone showed that canvas content stays untouched. Draw any new filament color swatch with `ColorDot`.
- The Kanban board uses @dnd-kit with separate Mouse and Touch sensors (a PointerSensor gets cancelled by the browser's scroll on phones; touch drags start after a 250 ms press). After a drop the board keeps the new arrangement until the move is confirmed, otherwise the drop animation flies back to the old spot.
- Scanning lives in `src/scan/` and `pages/ScanDialog.tsx` / `ScanSpoolForm.tsx`. These modules are lazy-loaded.
  - `barcode.ts` prefers the browser's native `BarcodeDetector` (secure context only; present on Android, absent on desktop Chrome/Windows) with ZXing as a fallback.
  - `live.ts` grabs video frames into a canvas (2× zoom, manual focus sweep when the camera only offers manual focus). Code 128 must be read twice identically; ITF and Code 39 are excluded because blurry frames produced false reads.
  - The user's phone gives the browser no autofocus (`focusMode: ["manual"]`), so live frames stay blurry there. The dialog detects this, remembers it in localStorage (`druckwerk.scan.noAutofocus`) and switches the barcode button to the photo path (camera app with autofocus), which works reliably.
  - When several codes are in a photo, EAN/UPC wins over QR. QR codes that are only a manufacturer URL count as `generic`: the manufacturer comes from the domain and "Sorte merken" defaults off.
  - `ocr.ts` `recognizeText` runs tesseract.js (deu + eng; language data comes from the CDN).
  - `invoice.ts` `readInvoiceText` reads PDFs with pdfjs-dist. It regroups text items into lines by y position so table rows like "Gesamtbetrag … 35,65 €" stay together. It falls back to OCR of page 1 for scanned PDFs and photos. The invoices tab in `ProjectDetail.tsx` prefills only fields the user hasn't touched.
  - `image.ts` decodes photos once and downscales them to limit memory on phones.
- Live camera access needs HTTPS. The service worker fails to register under a self-signed cert; this is expected and silenced in `main.tsx`.
- `clientLog(event, data)` (sendBeacon) is the way to get diagnostics from devices.

### e2e/

- Projects: `desktop`, `handy` (Pixel 7, `mobile.spec.ts`) and `kamera` (`live.spec.ts`).
- The `kamera` project feeds Chrome a fake camera stream. `global-setup.ts` renders an EAN with bwip-js into an MJPEG file.
- The photo-based scan tests upload into the hidden `data-testid="barcode-photo"` and `"label-photo"` inputs.
- Playwright has no touch-drag API. `mobile.spec.ts` drives real touch gestures (long press, swipe) through a CDP session with `Input.dispatchTouchEvent`, and checks the drop per animation frame with `requestAnimationFrame`.
- `printer.spec.ts` walks the Home Assistant flow (connect, link, AMS import, print, pause, booking, undo) against `FakeHa`. Its tests depend on each other and on spec order. After changing the fake printer state it waits for `/api/printers/1/live` before reloading, because the server caches HA data for 2 s.
- `invoice.spec.ts` renders an invoice HTML page to a PDF (`page.pdf`) or a screenshot (photo/OCR path) instead of keeping binary fixtures.

## Context

- Target device: the user's phone, Samsung Internet on Android 10. Chrome on the phone fails to connect.
- The server is reached at `https://<PC-IP>:3000` on the LAN. The phone only sees client changes after the `npm run prod` server has been restarted (it rebuilds the client), followed by a page reload on the phone.
- Roadmap:
  - Done: phases 1 (core + Kanban), 2 (filament scan), 3 (invoice reading) and 4 (Home Assistant for the Bambu Lab P1S). Phase 4 covers live status, control, speed, skipping objects, AMS linking and import, automatic filament deduction and several HA locations.
  - Next is a Klipper printer (Artillery "SidewinderX1", via the `moonraker` integration in HA). Its HA entities couldn't be inspected yet because the printer was offline. Look at the real data first: Klipper skips objects via `EXCLUDE_OBJECT`, and the app's live status only understands `bambu_lab` so far.
- The user's Home Assistant is reachable through the HA MCP tools in this environment. Use them (read-only) to look at real entity data, e.g. `ha_eval_template` with `BAMBU_TEMPLATE`. Never put the user's token anywhere; the user enters it in the app.
