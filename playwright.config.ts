import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Eigener Port und frische Datenbank pro Lauf – deine echten Daten bleiben unberührt.
const PORT = 3200;
const DATA_DIR = path.join(tmpdir(), `druckwerk-e2e-${Date.now()}`);
/** Virtuelles Kamerabild mit Barcode, erzeugt in global-setup.ts */
export const FAKE_CAMERA = path.join(tmpdir(), 'druckwerk-fake-camera.mjpeg');

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // Tests bauen aufeinander auf (gleiche Datenbank), daher nacheinander
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  outputDir: 'e2e-results',
  use: {
    baseURL: `https://localhost:${PORT}`,
    // Selbst erstelltes Zertifikat des Testservers akzeptieren
    ignoreHTTPSErrors: true,
    // Vorhandenes Chrome verwenden statt einen eigenen Browser herunterzuladen
    channel: 'chrome',
    headless: true,
    locale: 'de-DE',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
      testIgnore: /(mobile|live)\.spec\.ts/,
    },
    {
      name: 'handy',
      use: { ...devices['Pixel 7'], channel: 'chrome' },
      testMatch: /mobile\.spec\.ts/,
    },
    {
      // Live-Scanner mit virtueller Kamera statt echter Webcam
      name: 'kamera',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        permissions: ['camera'],
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-video-capture=${FAKE_CAMERA}`,
          ],
        },
      },
      testMatch: /live\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'npm start -w server',
    url: `https://localhost:${PORT}/api/stats`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { API_PORT: String(PORT), DATA_DIR, HOST: '127.0.0.1' },
  },
});
