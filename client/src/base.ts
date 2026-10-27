/**
 * Druckwerk läuft entweder unter „/“ oder als Home-Assistant-App hinter Ingress unter
 * „/api/hassio_ingress/<token>/“. Der Server setzt dafür <base href> in index.html; alle Adressen
 * sind deshalb relativ zu dieser Basis.
 */

/** Pfad der Basis ohne Schrägstrich am Ende: „“ oder „/api/hassio_ingress/abc“ */
export const basePath = new URL(document.baseURI).pathname.replace(/\/$/, '');

/** Läuft hinter Home-Assistant-Ingress */
export const underIngress = basePath !== '';

/** „/api/printers“ → „api/printers“ (relativ zur Basis) */
export const appUrl = (path: string) => path.replace(/^\//, '');
