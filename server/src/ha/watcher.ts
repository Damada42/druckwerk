import { filamentGrams, parsePrinterLive, type FilamentBooking } from '@3dapp/shared';
import { eq, isNotNull, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { schema, type Db } from '../db/index.js';
import { spoolInSlot, type HaClient } from './client.js';
import { checkMaintenance } from './maintenance.js';
import { PrintTracker, type BookingPlan } from './tracker.js';

const MAINTENANCE_CHECK_MS = 60_000;

/**
 * Bucht den Verbrauch eines Auftrags von den Spulen ab, die in den Slots stecken. Slots ohne
 * zugeordnete Spule werden übersprungen. Jeder Auftrag wird je Spule nur einmal gebucht.
 */
export function bookPlan(
  db: Db,
  printerId: number,
  plan: BookingPlan,
  log?: FastifyBaseLogger,
): FilamentBooking[] {
  return db.transaction((tx) => {
    const booked: FilamentBooking[] = [];
    for (const share of plan.shares) {
      const spool = spoolInSlot(tx as unknown as Db, share.entityId);
      if (!spool) {
        log?.warn(
          `Keine Spule für ${share.entityId} zugeordnet – ${share.meters !== undefined ? `${share.meters} m` : `${share.grams} g`} nicht gebucht`,
        );
        continue;
      }
      // Klipper: Länge über Durchmesser und Dichte des Filamenttyps in Gramm umrechnen
      const grams =
        share.meters !== undefined
          ? filamentGrams(
              share.meters,
              spool.diameter,
              tx
                .select({ name: schema.filamentTypes.name })
                .from(schema.filamentTypes)
                .where(eq(schema.filamentTypes.id, spool.typeId))
                .get()?.name,
            )
          : share.grams;
      if (grams <= 0) continue;
      const row = tx
        .insert(schema.filamentBookings)
        .values({
          spoolId: spool.id,
          printerId,
          grams,
          jobName: plan.jobName,
          jobKey: plan.jobKey,
          estimated: share.estimated,
        })
        .onConflictDoNothing()
        .returning()
        .get();
      if (!row) continue;
      tx.update(schema.filamentSpools)
        .set({
          weightRemainingG: sql`max(0, ${schema.filamentSpools.weightRemainingG} - ${grams})`,
        })
        .where(eq(schema.filamentSpools.id, spool.id))
        .run();
      booked.push(row);
    }
    return booked;
  });
}

/** Fragt Home Assistant regelmäßig ab und bucht nach jedem Druck das Filament ab */
export function createWatcher(db: Db, ha: HaClient, log?: FastifyBaseLogger) {
  const tracker = new PrintTracker();
  let timer: NodeJS.Timeout | undefined;
  let lastError: string | null = null;
  let lastMaintenanceCheck = -Infinity;
  let maintenanceEvery = MAINTENANCE_CHECK_MS;

  async function tick(now = Date.now()) {
    if (!ha.configured()) return;
    const linked = db
      .select()
      .from(schema.printers)
      .where(isNotNull(schema.printers.haDeviceId))
      .all();
    if (linked.length) await poll(linked, now);
    // Wartung höchstens einmal pro Minute prüfen (auch Drucker ohne Home Assistant)
    if (now - lastMaintenanceCheck >= maintenanceEvery) {
      lastMaintenanceCheck = now;
      await checkMaintenance(db, ha, new Date(now), log);
    }
  }

  async function poll(linked: (typeof schema.printers.$inferSelect)[], now: number) {
    const { entities, errors } = await ha.entities({ fresh: true });
    // Ein nicht erreichbarer Standort stört die anderen nicht; nur bei neuer Ursache loggen
    const message = errors.map((e) => e.message).join(' ') || null;
    if (message && message !== lastError) log?.warn(message);
    lastError = message;
    for (const printer of linked) {
      const live = parsePrinterLive(entities, printer.haDeviceId!);
      // Betriebsstunden übernehmen; ist der Drucker aus („unavailable“), bleibt der letzte Wert
      if (
        live.totalHours !== null &&
        (live.totalHours !== printer.operatingHours || !printer.operatingHoursAt)
      )
        db.update(schema.printers)
          .set({ operatingHours: live.totalHours, operatingHoursAt: new Date(now).toISOString() })
          .where(eq(schema.printers.id, printer.id))
          .run();
      const plan = tracker.observe(`printer-${printer.id}`, live, now);
      if (!plan) continue;
      const booked = bookPlan(db, printer.id, plan, log);
      log?.info(
        `Druck „${plan.jobName ?? '?'}“ auf ${printer.name} ${plan.result === 'finish' ? 'fertig' : 'abgebrochen'}: ` +
          (booked.length
            ? booked.map((b) => `${b.grams} g von Spule ${b.spoolId}`).join(', ')
            : 'nichts gebucht'),
      );
    }
  }

  return {
    tick,
    tracker,
    start(intervalMs: number) {
      // Kurze Abfrage-Intervalle (Klick-Tests) prüfen auch die Wartung öfter
      maintenanceEvery = Math.min(MAINTENANCE_CHECK_MS, intervalMs * 3);
      const run = () =>
        tick().catch((e: Error) => {
          if (e.message !== lastError) log?.warn(`Home Assistant: ${e.message}`);
          lastError = e.message;
        });
      timer = setInterval(run, intervalMs);
      timer.unref();
      void run();
    },
    stop() {
      clearInterval(timer);
    },
  };
}
