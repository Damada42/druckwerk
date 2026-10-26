/** Meldet einen Schritt oder Fehler ans Server-Log (für die Fehlersuche auf Handys). Wirft nie. */
export function clientLog(event: string, data?: Record<string, unknown>) {
  try {
    const body = JSON.stringify({ event, data });
    // sendBeacon überlebt auch Seitenwechsel; Fallback auf fetch
    if (
      !navigator.sendBeacon?.('/api/client-log', new Blob([body], { type: 'application/json' }))
    ) {
      fetch('/api/client-log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined);
    }
  } catch {
    // Logging darf die App nie stören
  }
}

export const errorInfo = (e: unknown) =>
  e instanceof Error
    ? { name: e.name, message: e.message, stack: e.stack?.slice(0, 800) }
    : { value: String(e) };

/** Unerwartete Fehler im Browser automatisch melden. */
export function installGlobalErrorLogging() {
  window.addEventListener('error', (e) =>
    clientLog('js-error', { message: e.message, source: e.filename, line: e.lineno }),
  );
  window.addEventListener('unhandledrejection', (e) =>
    clientLog('unhandled-rejection', errorInfo(e.reason)),
  );
}
