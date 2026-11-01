const CACHE = 'panelmix-4a8dc37c1e43';
const FILES = ["./","./apple-touch-icon.png","./assets/AspenPfd-BlFb2wVb.js","./assets/AspenPfd-IA6B88h0.css","./assets/BezelButton-BMk2RECS.js","./assets/G1000Mfd-B3d6rR-8.js","./assets/G1000Pfd-piFvzJES.js","./assets/G5Pair-B2kQx60Q.css","./assets/G5Pair-CDOGPwKE.js","./assets/Gfc500-B5kAb5ec.js","./assets/Gns430-NZKJ4ymf.js","./assets/Gns530-CyC83Z4v.js","./assets/GnsUnit-C8HeDYwc.css","./assets/GnsUnit-QOGMw1eF.js","./assets/Gtn650-CVdwnaUt.js","./assets/Gtn750-Dr3N5gpT.js","./assets/GtnUnit-BrdUg0jJ.js","./assets/GtnUnit-DroYXNR-.css","./assets/Gtx345-DTZt3Jd-.js","./assets/Kap140-mjrWV0ZG.js","./assets/Knob-D5rlfPME.js","./assets/Kt76a-Cxji73SV.js","./assets/Screen-C5CrR5tw.js","./assets/SteamPanel-zg_AgK0X.js","./assets/autopilot-DuXvLDIM.css","./assets/barlow-semi-condensed-latin-500-normal-CFOoVYFH.woff","./assets/barlow-semi-condensed-latin-500-normal-G0uxJNrM.woff2","./assets/barlow-semi-condensed-latin-600-normal-BkLiAYu4.woff2","./assets/barlow-semi-condensed-latin-600-normal-DyOfdMBA.woff","./assets/barlow-semi-condensed-latin-700-normal-BMyZXq_9.woff","./assets/barlow-semi-condensed-latin-700-normal-BpqDG8I9.woff2","./assets/barlow-semi-condensed-latin-ext-500-normal-BXdp1BvY.woff2","./assets/barlow-semi-condensed-latin-ext-500-normal-rZeYuEMb.woff","./assets/barlow-semi-condensed-latin-ext-600-normal-BkQ9hN72.woff2","./assets/barlow-semi-condensed-latin-ext-600-normal-BuP8AaxH.woff","./assets/barlow-semi-condensed-latin-ext-700-normal-BhgEo64M.woff2","./assets/barlow-semi-condensed-latin-ext-700-normal-C0vCoZIV.woff","./assets/barlow-semi-condensed-vietnamese-500-normal-DGADhYWF.woff2","./assets/barlow-semi-condensed-vietnamese-500-normal-hJ2t9k9e.woff","./assets/barlow-semi-condensed-vietnamese-600-normal-DzVrjA0Q.woff","./assets/barlow-semi-condensed-vietnamese-600-normal-b1FQiZcx.woff2","./assets/barlow-semi-condensed-vietnamese-700-normal-BvUTSFNY.woff","./assets/barlow-semi-condensed-vietnamese-700-normal-Dm7RZTvf.woff2","./assets/compat-Dhs85xBi.js","./assets/g1000-BkhuZZuh.css","./assets/g1000-ud8tQ3Xn.js","./assets/identEntry-BjtQzvNU.js","./assets/index-BcrI--lG.css","./assets/index-CMsJ6Z-K.js","./assets/palette-bPUC451Z.js","./assets/useUnit-BODrbeX5.js","./assets/xpdr-B3WOvcI3.js","./assets/xpdr-vnFDo3Y9.css","./data/airspace.json","./data/airways.json","./data/basemap.json","./data/fixes.json","./data/localizers.json","./data/magvar.json","./data/navdata.json","./data/proc/index.json","./icon-192.png","./icon-512.png","./icon.svg","./index.html","./manifest.webmanifest","./terrain/index.json"];

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
const RUNTIME_PATHS = ["data/proc/","terrain/"];

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
