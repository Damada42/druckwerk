import { chromium } from '@playwright/test';
import bwipjs from 'bwip-js';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { APP_PORT, FAKE_CAMERA, FAKE_HA_PORT, INGRESS_PORT } from '../playwright.config';
import { FakeHa, type RawEntity } from '../server/test/fake-ha';
import { startIngressProxy } from './ingress-proxy';

export const LIVE_EAN = '9783161484100';

/**
 * Baut das Bild der virtuellen Kamera: ein Barcode mittig auf weißem Grund, als MJPEG-Datei
 * (mehrere gleiche JPEG-Bilder hintereinander), die Chrome als Kamerabild abspielt.
 */
export default async function globalSetup() {
  const png = await bwipjs.toBuffer({
    bcid: 'ean13',
    text: LIVE_EAN,
    scale: 3,
    height: 20,
    includetext: true,
    backgroundcolor: 'FFFFFF',
  });
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  await page.setContent(
    `<body style="margin:0;height:100vh;display:grid;place-items:center;background:#fff">
       <img src="data:image/png;base64,${png.toString('base64')}" style="width:520px">
     </body>`,
  );
  const frame = await page.screenshot({ type: 'jpeg', quality: 92 });
  await browser.close();
  writeFileSync(FAKE_CAMERA, Buffer.concat(Array.from({ length: 30 }, () => frame)));

  // Nachgebautes Home Assistant mit den echten P1S-Daten aus den Server-Tests
  const fixture = JSON.parse(
    readFileSync(path.join(__dirname, '../server/test/fixtures/bambu-p1s.json'), 'utf8'),
  ) as RawEntity[];
  const ha = new FakeHa(fixture);
  await ha.listen(FAKE_HA_PORT);
  // Wie Home-Assistant-Ingress vor dem Testserver
  const ingress = await startIngressProxy(INGRESS_PORT, APP_PORT);
  return async () => {
    await ha.close();
    await new Promise((resolve) => ingress.close(resolve));
  };
}
