import {
  MAINTENANCE_LEVELS,
  describeRemaining,
  parseNotifyTarget,
  renderMessage,
  taskStatus,
  type MaintenanceLevel,
  type MessageVars,
  type NotifyTarget,
} from '@3dapp/shared';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { schema, type Db } from '../db/index.js';
import { readSettings } from '../routes/storage.js';
import type { HaClient } from './client.js';

const rank = (level: MaintenanceLevel | null) => (level ? MAINTENANCE_LEVELS.indexOf(level) : 0);
const DAY = 24 * 60 * 60 * 1000;

/** Gewählte Ziele, ungültige ausgelassen */
export function readTargets(values: string[]): { value: string; target: NotifyTarget }[] {
  return values.flatMap((value) => {
    const target = parseNotifyTarget(value);
    return target ? [{ value, target }] : [];
  });
}

/**
 * Nachricht an alle Ziele; Ergebnis je Ziel. Gilt als zugestellt, wenn mindestens ein Ziel sie
 * angenommen hat.
 */
export async function sendToAll(
  ha: HaClient,
  targets: { value: string; target: NotifyTarget }[],
  message: { title: string; message: string },
) {
  const results = await Promise.allSettled(targets.map((t) => ha.notify(t.target, message)));
  return targets.map((t, i) => {
    const r = results[i];
    return {
      target: t.value,
      error:
        r.status === 'rejected'
          ? r.reason instanceof Error
            ? r.reason.message
            : String(r.reason)
          : null,
    };
  });
}

/**
 * Prüft alle Wartungspunkte und schickt je Drucker eine Nachricht an alle gewählten Ziele, wenn
 * ein Punkt „bald fällig“ oder „fällig“ geworden ist – je Stufe nur einmal (notifiedLevel). Mit
 * eingestellter Erinnerung kommt sie erneut, solange der Punkt fällig ist. Ohne Ziel wird nichts
 * vermerkt, damit die Nachricht kommt, sobald eines eingestellt ist.
 */
export async function checkMaintenance(
  db: Db,
  ha: HaClient,
  now: Date,
  log?: FastifyBaseLogger,
): Promise<number> {
  const settings = readSettings(db);
  if (!settings.maintenance) return 0;
  const defaults = {
    warnHours: settings.maintenanceWarnHours,
    warnDays: settings.maintenanceWarnDays,
  };
  const targets = readTargets(settings.maintenanceNotify);
  const remindMs = settings.maintenanceRemindDays * DAY;
  const printers = db.select().from(schema.printers).all();
  const parts = db.select().from(schema.spareParts).all();
  const tasks = db.select().from(schema.maintenanceTasks).all();
  let sent = 0;

  for (const printer of printers) {
    const raised: { id: number; level: MaintenanceLevel; line: string; missing: string | null }[] =
      [];
    let reminderOnly = true;
    for (const task of tasks.filter((t) => t.printerId === printer.id)) {
      const status = taskStatus(task, printer.operatingHours, now, defaults);
      const remind =
        remindMs > 0 &&
        status.level === 'due' &&
        task.notifiedLevel === 'due' &&
        !!task.notifiedAt &&
        now.getTime() - Date.parse(task.notifiedAt) >= remindMs;
      if (!remind && rank(status.level) <= rank(task.notifiedLevel)) {
        // Wieder in Ordnung (z.B. Intervall verlängert): später erneut melden
        if (rank(status.level) < rank(task.notifiedLevel))
          db.update(schema.maintenanceTasks)
            .set({ notifiedLevel: status.level === 'ok' ? null : status.level, notifiedAt: null })
            .where(eq(schema.maintenanceTasks.id, task.id))
            .run();
        continue;
      }
      if (!remind) reminderOnly = false;
      const part = parts.find((p) => p.id === task.partId);
      const missing = part ? Math.max(0, task.partQty - part.stockQty) : 0;
      const partText = part
        ? ` – ${part.name}: ${part.stockQty} auf Lager${missing ? `, ${missing} fehlt` : ''}`
        : '';
      raised.push({
        id: task.id,
        level: status.level,
        line: `• ${task.name} (${describeRemaining(status)})${partText}`,
        missing: part && missing ? `${part.name} (${missing} Stück)` : null,
      });
    }
    if (!raised.length || !targets.length) continue;
    const due = raised.some((r) => r.level === 'due');
    const missing = raised.flatMap((r) => (r.missing ? [r.missing] : []));
    const vars: MessageVars = {
      drucker: printer.name,
      modell: printer.model,
      stufe: due ? 'fällig' : 'bald fällig',
      anzahl: String(raised.length),
      punkte: raised.map((r) => r.line).join('\n'),
      stunden: Math.round(printer.operatingHours).toLocaleString('de-AT'),
      fehlende_teile: missing.length ? `Fehlt: ${missing.join(', ')}` : '',
    };
    const title = renderMessage(settings.maintenanceTitle, vars) || `Wartung: ${printer.name}`;
    const message = {
      title: reminderOnly ? `${title} (Erinnerung)` : title,
      message: renderMessage(settings.maintenanceMessage, vars) || vars.punkte,
    };
    const results = await sendToAll(ha, targets, message);
    for (const r of results)
      if (r.error) log?.warn(`Wartungs-Nachricht an ${r.target} nicht gesendet: ${r.error}`);
    if (results.every((r) => r.error)) continue;
    sent++;
    for (const r of raised)
      db.update(schema.maintenanceTasks)
        .set({ notifiedLevel: r.level, notifiedAt: now.toISOString() })
        .where(eq(schema.maintenanceTasks.id, r.id))
        .run();
  }
  return sent;
}
