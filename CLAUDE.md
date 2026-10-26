# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Druckwerk is a 3D-printing manager: a PWA plus a small home-network server (Node + SQLite). It manages a project Kanban board, customers, team members, filament stock with barcode/OCR scanning, printers with cost per print hour, and invoices. The user is German; the UI text, code comments, test names and README are all German. Keep it that way.

## Commands

Requires Node 22+. On this Windows machine, PowerShell calls may need the PATH refreshed first:
`$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`

- `npm run dev`: server (tsx watch, port 3000) and Vite client (port 5173, proxies `/api` and `/uploads` to 3000), both over HTTPS.
- `npm run prod`: builds the client, then the server serves it plus the API on port 3000. Use this for phone testing. The Vite dev server reloads the page when its HMR websocket reconnects (for example after coming back from the camera app), and on Windows it sometimes serves stale module transforms after multi-step edits.
- `npm run typecheck`: `tsc --noEmit` for both server and client. There is no linter; formatting is done with `npm run format` (Prettier).
- `npm test`: server unit tests (vitest). For a single file or test, run `npx vitest run --root server test/label.test.ts -t "<name>"`.
- `npm run e2e`: builds the client first, then runs Playwright with the installed Chrome (`channel: 'chrome'`, no browser download). It starts its own server on port 3200 with a temporary `DATA_DIR`. Tests in a project share one database and run sequentially, so later specs depend on earlier ones. For a single spec, run `npx playwright test e2e/scan.spec.ts --project desktop`, but only after `npm run build`.
- `npm run db:generate -w server`: after changing `server/src/db/schema.ts`, generate a migration in `server/drizzle/`. Migrations run automatically on server start.

Env vars: `API_PORT` (default 3000; deliberately not `PORT`, which the preview tooling sets), `HOST`, `DATA_DIR` (default `server/data`: DB, uploads, certs, `client-log.jsonl`), `HTTPS=false` to disable TLS.

## Architecture

The repo is an npm-workspaces monorepo: `shared/`, `server/`, `client/`.

### shared/

`shared/` is consumed directly as TypeScript source (`main: src/index.ts`, no build step). It holds:

- Domain interfaces and German label constants (statuses, cost categories, roles).
- Cost math used by both sides: `calcPrinterHourly` (electricity + wear + maintenance per hour) and `calcProjectCosts` (filament + print hours × hourly rate + extras).
- `label.ts`: `parseSpoolLabel` turns OCR text into a filament guess (type, manufacturer, color, finish, weight, diameter).
- `invoice.ts`: `parseInvoice` extracts the gross total (keyword tiers, so subtotal, VAT and shipping are skipped), invoice date, number, vendor and item names from invoice text. Items come from the line-item table (header found by description/quantity/price columns, tolerant of OCR garbling); `describeInvoice` turns them into the description, e.g. "Hama Steckdosenleiste … (Amazon)". Unit tests live in `server/test/invoice.test.ts`, since only the server has vitest.

### server/

Fastify 5 + better-sqlite3 + drizzle-orm.

- `src/app.ts` `buildApp(options)` builds the app without listening. Tests use it with `dbFile: ':memory:'` and `app.inject`.
- The error handler must be registered before the route plugins. It maps SQLite FK and UNIQUE violations to German 409 responses.
- `routes/crud.ts` provides a generic `registerCrud` used for the simple entities.
- `routes/projects.ts`: on create and update, a project replaces its members, filaments and costs wholesale. `PATCH /projects/:id/move` uses fractional `position` values for Kanban ordering.
- `routes/scan.ts`: barcode lookup and batch spool creation. Remembered products live in `filament_products`, keyed by a unique barcode.
- `routes/clientLog.ts`: `POST /api/client-log` receives browser diagnostics, writes them to the server log and appends them to `DATA_DIR/client-log.jsonl`. When debugging phone behavior, read that file. Entries can include a `sample` JPEG data URL of what the live scanner saw.
- `src/cert.ts` `ensureCert` generates and caches a self-signed certificate covering localhost, the hostname and LAN IPs. The Vite dev server reuses the same certificate from `server/data/certs`.
- In production the server also serves `client/dist` with an SPA fallback, plus `/uploads`.

### client/

React 19, Vite 7, Tailwind v4 (tokens in `index.css`), React Router 7 and TanStack Query.

- `src/api.ts` holds all data hooks (`useList`, `useSave`, an optimistic `useMoveProject`, …).
- `components/ui.tsx` holds the shared primitives and German formatters (`euro`, `grams`, `dateDe`).
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

## Context

- Target device: the user's phone, Samsung Internet on Android 10. Chrome on the phone fails to connect.
- The server is reached at `https://<PC-IP>:3000` on the LAN.
- Roadmap: phases 1 (core + Kanban), 2 (filament scan) and 3 (invoice reading) are done. Phase 4 is Home Assistant live status for the Bambu Lab P1S.
