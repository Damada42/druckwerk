import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Eigener Port und frische Datenbank pro Lauf – deine echten Daten bleiben unberührt.
const PORT = 3200;
const DATA_DIR = path.join(tmpdir(), `druckwerk-e2e-${Date.now()}`);

export default defineConfig({
  testDir: './e2e',
  // Tests bauen aufeinander auf (gleiche Datenbank), daher nacheinander
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  outputDir: 'e2e-results',
  use: {
    baseURL: `http://localhost:${PORT}`,
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
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: 'handy',
      use: { ...devices['Pixel 7'], channel: 'chrome' },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'npm start -w server',
    url: `http://localhost:${PORT}/api/stats`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { API_PORT: String(PORT), DATA_DIR, HOST: '127.0.0.1' },
  },
});
