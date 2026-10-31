import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/**
 * Emits a service worker that precaches the app, its fonts and the navigation
 * data, so the trainer works offline after the first visit. The cache name is
 * a hash of the file list, so each deploy replaces the previous cache.
 */
function serviceWorker(): Plugin {
  return {
    name: 'panelmix-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const data = readdirSync('public/data').map((f) => `./data/${f}`);
      const files = [
        './',
        ...Object.keys(bundle).filter((f) => !f.endsWith('.map')).map((f) => `./${f}`),
        ...data,
        './icon.svg',
        './apple-touch-icon.png',
        './icon-192.png',
        './icon-512.png',
        './manifest.webmanifest',
      ];
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      const source = `const CACHE = 'panelmix-${version}';
const FILES = ${JSON.stringify(files)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('panelmix-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    // Network first for the page so updates arrive promptly; the cache when offline.
    event.respondWith(fetch(request).catch(() => caches.match('./')));
    return;
  }
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serviceWorker()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
