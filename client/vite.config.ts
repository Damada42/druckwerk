import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { ensureCert } from '../server/src/cert';

// Der Server läuft im Dev-Modus ebenfalls über HTTPS (selbst erstelltes Zertifikat)
const api = { target: 'https://localhost:3000', secure: false };

export default defineConfig(async ({ command }) => {
  // Gleiches Zertifikat wie der Server, damit das Handy nur einmal bestätigen muss
  const tls =
    command === 'serve' && process.env.HTTPS !== 'false'
      ? await ensureCert(fileURLToPath(new URL('../server/data/certs', import.meta.url)))
      : undefined;

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        // Registrierung selbst in main.tsx, damit der erwartete Fehler bei selbst erstelltem
        // Zertifikat (Browser verweigern dann den Service Worker) still abgefangen wird
        injectRegister: false,
        includeAssets: ['icon.svg'],
        manifest: {
          name: '3D-Druck-Manager',
          short_name: 'Druckwerk',
          description: 'Projekte, Kunden, Filament und Drucker verwalten',
          lang: 'de',
          theme_color: '#ea580c',
          background_color: '#0c0a09',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // Seitenaufrufe immer übers Netz: Hinter dem Login-Proxy (Authentik) muss der Proxy
          // eine abgelaufene Sitzung zur Anmeldung umleiten können. Aus dem Cache kämen nur Assets.
          navigateFallback: null,
        },
      }),
    ],
    server: {
      port: 5173,
      https: tls && { key: tls.key, cert: tls.cert },
      proxy: { '/api': api, '/uploads': api },
    },
  };
});
