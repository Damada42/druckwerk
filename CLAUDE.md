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

Tooling on this machine:

- There is no Python and no `gh` CLI. Use Node for scripts. CI status can only be seen on GitHub (Actions tab).
- `core.autocrlf=true`, and the working tree mixes CRLF and LF files. Prettier writes LF, so it can make untouched files show up in `git status`. Check them with `git diff --ignore-cr-at-eol` and `git checkout` the ones without real changes. String replacements in scripts must handle `\r\n`.

Env vars: `API_PORT` (default 3000; deliberately not `PORT`, which the preview tooling sets), `HOST`, `DATA_DIR` (default `server/data`: DB, uploads, certs, `client-log.jsonl`), `HTTPS=false` to disable TLS, `HA_POLL_MS` (default 20000; the e2e server uses 500), `TRUST_PROXY=true` behind a reverse proxy. `NODE_ENV=production` (set by `npm start`) makes the server serve `client/dist`.

## Deployment

- In production the app runs as a Docker container on the user's home server (Portainer, stack in `docker-compose.yml`, host port 3100). Every push to `main` triggers `.github/workflows/docker.yml`: it runs only `typecheck` and `npm test`, then publishes `ghcr.io/<owner>/druckwerk` tagged `latest`, the commit SHA and the version from `ha-app/config.yaml`. CI doesn't run the e2e suite, so run `npm run e2e` locally before pushing.
- The Dockerfile's runtime stage copies only `shared/src`, `server/src`, `server/drizzle` and the built `client/dist`. A new runtime file outside those (e.g. a server-side fixture or asset) needs its own `COPY` line.
- It sits behind Cloudflare Tunnel → Authentik proxy outpost (login with MFA). The container serves plain HTTP (`HTTPS=false`, `TRUST_PROXY=true`, data in `/data`).
- The app has no auth of its own, so it must never be exposed without the proxy.
- Proxy constraints:
  - `request()` in `api.ts` fetches with `redirect: 'manual'`. An opaque redirect means the Authentik session expired, and the page reloads at most once a minute (`e2e/proxy.spec.ts`).
  - The service worker must not serve navigations from cache (`navigateFallback: null`), otherwise Authentik can't redirect to the login.
- `GET /api/health` is the Docker healthcheck.
- `npm run export -w server` writes a consistent DB copy plus uploads to `server/data/export/` for moving data into the container.
- Without Docker on the PC, verify the Dockerfile's runtime stage by replaying it in a temp folder: copy only what it copies, then `npm ci --omit=dev -w server -w shared` and `node --import tsx src/index.ts`.

## Home Assistant App

HA renamed add-ons to "Apps" in 2026.2; use that term with the user. The same Docker image runs as a Docker container and as an HA App.

- This repo is the App repository: `repository.yaml` at the root, the App in `ha-app/` (`config.yaml`, `DOCS.md`). The Supervisor pulls `ghcr.io/damada42/druckwerk:<version from ha-app/config.yaml>`; CI tags the image with that version. HA only offers an update after that version is bumped.
- Ingress serves the App under `/api/hassio_ingress/<token>/` and strips that prefix before the request reaches the server, sending it in `X-Ingress-Path`. Because of this:
  - `client/index.html` has `<base href="/" />`. `withBase` in `app.ts` replaces it with the ingress path (the header is validated first), so index.html is always served through `sendIndex` (`index: false` on @fastify/static).
  - Every URL in the client must be relative. Use `appUrl('/api/…')` from `client/src/base.ts` for fetches and `<img src>`, and plain relative paths for static files. Vite builds with `base: './'`, and the router gets `basename` from `document.baseURI`. Under ingress no service worker is registered.
  - `e2e/ingress.spec.ts` runs the app behind `e2e/ingress-proxy.ts` (port 3298), which mimics ingress, and fails on any request outside the prefix.
- With `SUPERVISOR_TOKEN` set (`supervisorToken` in `buildApp`):
  - The server only accepts requests from the ingress gateway `172.30.32.2` and from localhost (Docker healthcheck), since the app has no auth of its own.
  - `createHaClient` creates one `ha_connections` row with `local = true`. Its URL (`http://supervisor/core`) and token are resolved at runtime and never stored. It can be renamed but not removed. Without a supervisor token (data moved back to Docker), it reports an error and can be deleted.
- Data lives in `/config` (`addon_config` map), so it's reachable via Samba and included in HA backups. `backup_pre` runs `src/checkpoint.ts` to flush the SQLite WAL first.

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
- Cameras (`routes/cameras.ts`, table `printer_cameras`): a printer has any number of cameras, each either an HA `camera.*` entity (with its `haConnectionId`, since entity IDs aren't unique across instances) or a direct MJPEG URL (Crowsnest/Klipper). `CAMERA_TEMPLATE` lists all `camera.*` entities, not only `bambu_lab` ones. The browser only ever loads `/api/cameras/:id/stream|snapshot`; the server pipes HA's `camera_proxy_stream`/`camera_proxy` or the direct URL. `fetchWithTimeout` with a `stream` signal applies the 8 s timeout only until headers arrive, and `reply.raw` `close` aborts the upstream fetch. Passwords in camera URLs are masked (`maskUrlPassword`) in every response; sending the masked URL back unchanged keeps the stored one. Credentials in a URL are sent as Basic auth, because Node's fetch rejects URLs with userinfo. Without a snapshot URL, `snapshotFromStream` derives `?action=snapshot` from Crowsnest stream URLs.
  - `server/test/fake-ha.ts` (`FakeHa`) emulates HA from a fixture of the user's real P1S data (`test/fixtures/bambu-p1s.json`). The e2e global setup runs it as an HTTP server on port 3299; `POST /test/print` and `GET /test/calls` steer and inspect it.
- Settings (`routes/storage.ts`): the `settings` key-value table holds `AppSettings` feature switches (`GET/PUT /api/settings`, JSON values, typed against `DEFAULT_SETTINGS`) and the `company` profile (`routes/documents.ts`). Nav items with a `feature` key only show when that switch is on (`useNavItems` in `Layout.tsx`).
- Storage locations (`storage_locations`, `shared/src/storage.ts`): a self-referencing tree (`parentId`, cascade delete) with `position` among siblings. Spools point to it via `storageLocationId` (set null on delete). drizzle-kit drops `ON DELETE` from `ALTER TABLE … ADD … REFERENCES`, so `0008` was edited by hand; check generated SQL for that after adding FK columns. With the switch off, the old free-text `location` field is used instead.
- Quotes and invoices (`routes/documents.ts`, `documents/pdf.ts`, table `project_documents`): pdfkit renders A4 PDFs with the built-in Helvetica (WinAnsi covers umlauts, €, §). The document stores a snapshot (recipient, items, VAT mode, totals) and its PDF in uploads; it never re-renders. Numbers are `AN-`/`RE-<year>-NNN`, unique. An invoice also inserts an outgoing `invoices` row (`invoiceId`); deleting that row keeps the PDF because the document still owns it. The logo is uploaded as PNG: the browser rasterizes any image (incl. SVG) in `logoToPng` (`CompanyCard.tsx`). Server tests read PDF text with `pdfjs-dist` (`verbosity: 0`).

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
- `PrinterCameras.tsx` streams only the selected camera (MJPEG in an `<img>`); the others show snapshots refreshed every 10 s. Streams stop when the page is hidden or the card scrolls out of view, because each open MJPEG stream holds one of the browser's six HTTP/1.1 connections to the server. If the stream fails, it falls back to snapshots every 3 s.

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
  - Done since: several cameras per printer (HA entities or direct MJPEG URLs).
  - Done since: Druckwerk as a Home Assistant App (see "Home Assistant App" above). Not yet tried on the user's real HA (HA OS VM on Proxmox, amd64).
  - Done since: storage locations for spools (switchable) and quotes/invoices as PDF. The user is in Austria: tax wording follows the Austrian UStG (small business note `§ 6 Abs. 1 Z 27 UStG`, "UID-Nummer", 20 % standard rate).
  - Next, a Klipper printer (Artillery "SidewinderX1", via the `moonraker` integration in HA). Its HA entities couldn't be inspected yet because the printer was offline. Look at the real data first: Klipper skips objects via `EXCLUDE_OBJECT`, and the app's live status only understands `bambu_lab` so far.
- The user's Home Assistant is reachable through the HA MCP tools in this environment. Use them (read-only) to look at real entity data, e.g. `ha_eval_template` with `BAMBU_TEMPLATE`. Never put the user's token anywhere; the user enters it in the app.
