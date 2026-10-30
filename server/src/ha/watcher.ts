import { filamentGrams, parsePrinterLive, type FilamentBooking } from '@3dapp/shared';
import { eq, isNotNull, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { schema, type Db } from '../db/index.js';
import { spoolInSlot, type HaClient } from './client.js';
import { PrintTracker, type BookingPlan } from './tracker.js';

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

  async function tick(now = Date.now()) {
    if (!ha.configured()) return;
    const linked = db
      .select()
      .from(schema.printers)
      .where(isNotNull(schema.printers.haDeviceId))
      .all();
    if (!linked.length) return;
    const { entities, errors } = await ha.entities({ fresh: true });
    // Ein nicht erreichbarer Standort stört die anderen nicht; nur bei neuer Ursache loggen
    const message = errors.map((e) => e.message).join(' ') || null;
    if (message && message !== lastError) log?.warn(message);
    lastError = message;
    for (const printer of linked) {
      const live = parsePrinterLive(entities, printer.haDeviceId!);
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
