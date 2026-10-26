import { chromium } from '@playwright/test';
import bwipjs from 'bwip-js';
import { writeFileSync } from 'node:fs';
import { FAKE_CAMERA } from '../playwright.config';

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
}
