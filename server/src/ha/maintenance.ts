import {
  MAINTENANCE_LEVELS,
  describeRemaining,
  parseNotifyTarget,
  taskStatus,
  type MaintenanceLevel,
} from '@3dapp/shared';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { schema, type Db } from '../db/index.js';
import { readSettings } from '../routes/storage.js';
import type { HaClient } from './client.js';

const rank = (level: MaintenanceLevel | null) => (level ? MAINTENANCE_LEVELS.indexOf(level) : 0);

/**
 * Prüft alle Wartungspunkte und schickt je Drucker eine Push-Nachricht, wenn ein Punkt „bald
 * fällig“ oder „fällig“ geworden ist – je Stufe nur einmal (notifiedLevel). Ohne Push-Ziel wird
 * nichts vermerkt, damit die Nachricht kommt, sobald eines eingestellt ist.
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
  const target = parseNotifyTarget(settings.maintenanceNotify);
  const printers = db.select().from(schema.printers).all();
  const parts = db.select().from(schema.spareParts).all();
  const tasks = db.select().from(schema.maintenanceTasks).all();
  let sent = 0;

  for (const printer of printers) {
    const raised: { id: number; level: MaintenanceLevel; line: string }[] = [];
    for (const task of tasks.filter((t) => t.printerId === printer.id)) {
      const status = taskStatus(task, printer.operatingHours, now, defaults);
      if (rank(status.level) <= rank(task.notifiedLevel)) {
        // Wieder in Ordnung (z.B. Intervall verlängert): später erneut melden
        if (rank(status.level) < rank(task.notifiedLevel))
          db.update(schema.maintenanceTasks)
            .set({ notifiedLevel: status.level === 'ok' ? null : status.level })
            .where(eq(schema.maintenanceTasks.id, task.id))
            .run();
        continue;
      }
      const part = parts.find((p) => p.id === task.partId);
      const missing = part ? Math.max(0, task.partQty - part.stockQty) : 0;
      const partText = part
        ? ` – ${part.name}: ${part.stockQty} auf Lager${missing ? `, ${missing} fehlt` : ''}`
        : '';
      raised.push({
        id: task.id,
        level: status.level,
        line: `• ${task.name} (${describeRemaining(status)})${partText}`,
      });
    }
    if (!raised.length || !target) continue;
    const due = raised.some((r) => r.level === 'due');
    try {
      await ha.notify(target.connectionId, target.service, {
        title: `Wartung ${due ? 'fällig' : 'bald fällig'}: ${printer.name}`,
        message: raised.map((r) => r.line).join('\n'),
      });
    } catch (e) {
      log?.warn(`Wartungs-Nachricht nicht gesendet: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    sent++;
    for (const r of raised)
      db.update(schema.maintenanceTasks)
        .set({ notifiedLevel: r.level })
        .where(eq(schema.maintenanceTasks.id, r.id))
        .run();
  }
  return sent;
}
