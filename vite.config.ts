import { createHash } from 'node:crypto';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const RUNTIME_PREFIXES = ['data/proc/', 'terrain/'];
const isRuntimeCached = (f: string) => RUNTIME_PREFIXES.some((p) => f.startsWith(p)) && !f.endsWith('index.json');

/** Every file under `dir`, as paths relative to it with forward slashes. */
function listFiles(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    return statSync(full).isDirectory() ? listFiles(full, rel) : [rel];
  });
}

/**
 * Writes a service worker that precaches the app, its fonts and the
 * navigation data, so the trainer works offline after the first visit.
 *
 * The file list is read from the output folder once the build is written,
 * not from the bundle during generation: Vite drops CSS-only JavaScript
 * chunks late, and a precache list naming a missing file would make the
 * whole install fail. The cache name is a hash of the list, so each deploy
 * replaces the previous cache.
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'panelmix-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = [
        './',
        ...listFiles(outDir)
          // Per-airport procedures and terrain tiles are thousands of files: cached as used, not up front.
          .filter((f) => !f.endsWith('.map') && f !== 'sw.js' && !f.startsWith('.') && !isRuntimeCached(f))
          .sort()
          .map((f) => `./${f}`),
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
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('panelmix-') && k !== CACHE && !k.startsWith('panelmix-runtime')).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const RUNTIME = 'panelmix-runtime-v1';
const RUNTIME_PATHS = ${JSON.stringify(RUNTIME_PREFIXES)};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    // Network first for the page so updates arrive promptly; the cache when offline.
    event.respondWith(fetch(request).catch(() => caches.match('./')));
    return;
  }
  const scope = new URL(self.registration.scope).pathname;
  const path = url.pathname.startsWith(scope) ? url.pathname.slice(scope.length) : url.pathname;
  if (RUNTIME_PATHS.some((p) => path.startsWith(p))) {
    // Procedures and terrain: keep what has been used, for offline flying in the same area.
    event.respondWith(
      caches.open(RUNTIME).then((cache) =>
        cache.match(request).then(
          (hit) =>
            hit ||
            fetch(request).then((res) => {
              if (res.ok) cache.put(request, res.clone());
              return res;
            }),
        ),
      ),
    );
    return;
  }
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});
`;
      writeFileSync(path.join(outDir, 'sw.js'), source);
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
