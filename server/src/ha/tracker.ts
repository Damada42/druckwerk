import { ACTIVE_PRINT_STATES, type PrinterLive } from '@3dapp/shared';

/** Was nach einem Druck abgebucht werden soll: Gramm je AMS-Slot */
export interface BookingPlan {
  jobKey: string;
  jobName: string | null;
  result: 'finish' | 'failed';
  shares: { entityId: string; grams: number; estimated: boolean }[];
}

interface Job {
  key: string;
  /** Kennung ist nur geraten (Startzeit fehlte) und darf noch verbessert werden */
  provisional: boolean;
  name: string | null;
  startTime: string | null;
  /** Druckzeit in Sekunden je aktivem Slot */
  slots: Map<string, number>;
  lastSeen: number;
  /** Bei der letzten Beobachtung druckend aus diesem Slot (null = nicht am Drucken) */
  lastSlot: string | null;
  progress: number | null;
  weightG: number | null;
}

/** Längere Lücken (Server war aus) zählen nur so viel, damit ein Slot nicht überwiegt */
const MAX_STEP_S = 120;

/**
 * Verfolgt laufende Druckaufträge je Drucker. Beobachtet regelmäßig den Live-Status und merkt
 * sich, welcher AMS-Slot wie lange aktiv war. Endet der Auftrag, liefert er die Abbuchung:
 * fertig = volles Druckgewicht, abgebrochen = anteilig nach Fortschritt. Bei mehreren Slots
 * wird nach Druckzeit aufgeteilt (Home Assistant meldet keinen Verbrauch pro Slot).
 */
export class PrintTracker {
  private jobs = new Map<string, Job>();

  observe(printerKey: string, live: PrinterLive, now = Date.now()): BookingPlan | null {
    const job = this.jobs.get(printerKey);

    // Drucker kurz offline oder Zustand unklar: Auftrag weiter merken, nichts entscheiden
    if (live.state === 'offline' || live.state === 'unknown') return null;

    if ((ACTIVE_PRINT_STATES as readonly string[]).includes(live.state)) {
      let current = job;
      if (current && live.startTime && current.startTime && live.startTime !== current.startTime) {
        current = undefined; // neuer Auftrag, ohne dass wir das Ende des alten gesehen haben
      }
      if (!current) {
        current = {
          key: jobKey(printerKey, live, now),
          provisional: !live.startTime,
          name: live.taskName,
          startTime: live.startTime,
          slots: new Map(),
          lastSeen: now,
          lastSlot: null,
          progress: live.progress,
          weightG: live.weightG,
        };
        this.jobs.set(printerKey, current);
      } else if (current.provisional && live.startTime) {
        current.key = jobKey(printerKey, live, now);
        current.provisional = false;
        current.startTime = live.startTime;
      }
      this.credit(current, now);
      const slot = live.ams.find((s) => s.active);
      current.lastSlot = live.state === 'running' && slot ? slot.entityId : null;
      current.lastSeen = now;
      current.name = live.taskName ?? current.name;
      current.progress = live.progress ?? current.progress;
      current.weightG = live.weightG ?? current.weightG;
      return null;
    }

    if (!job) return null;
    this.jobs.delete(printerKey);
    this.credit(job, now);
    // Nur ein einziges Mal gesehen (sehr kurzer Druck): Slot trotzdem berücksichtigen
    if (job.slots.size === 0 && job.lastSlot) job.slots.set(job.lastSlot, 0);

    const result = live.state === 'finish' ? 'finish' : 'failed';
    const weight = live.weightG ?? job.weightG;
    const factor = result === 'finish' ? 1 : Math.min(100, Math.max(0, job.progress ?? 0)) / 100;
    const grams = (weight ?? 0) * factor;
    if (grams <= 0 || job.slots.size === 0) return null;

    const total = [...job.slots.values()].reduce((a, b) => a + b, 0);
    const entries = [...job.slots.entries()];
    const estimated = entries.length > 1 || result === 'failed';
    return {
      jobKey: job.key,
      jobName: job.name,
      result,
      shares: entries
        .map(([entityId, seconds]) => ({
          entityId,
          // Nur ein Slot ohne gemessene Zeit (sehr kurzer Druck): alles auf ihn
          grams: round1(total > 0 ? (grams * seconds) / total : grams / entries.length),
          estimated,
        }))
        .filter((s) => s.grams > 0),
    };
  }

  /** Die Zeit seit der letzten Beobachtung dem Slot gutschreiben, der da gedruckt hat */
  private credit(job: Job, now: number) {
    const step = Math.min(MAX_STEP_S, Math.max(0, (now - job.lastSeen) / 1000));
    if (job.lastSlot && step > 0)
      job.slots.set(job.lastSlot, (job.slots.get(job.lastSlot) ?? 0) + step);
  }

  /** Für Tests und Anzeige: wird gerade ein Auftrag verfolgt? */
  tracking(printerKey: string) {
    return this.jobs.has(printerKey);
  }
}

function jobKey(printerKey: string, live: PrinterLive, now: number) {
  return live.startTime
    ? `${printerKey}:${live.startTime}`
    : `${printerKey}:${live.taskName ?? 'auftrag'}:${new Date(now).toISOString()}`;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
