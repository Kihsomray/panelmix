const CACHE = 'panelmix-c1672d8784ff';
const FILES = ["./","./apple-touch-icon.png","./assets/AspenPfd-BjFGfrpT.js","./assets/AspenPfd-IA6B88h0.css","./assets/BezelButton-CwmMV5PK.js","./assets/G1000Mfd-CtS0Aaxn.js","./assets/G1000Pfd-tAdD3VMP.js","./assets/G5Pair-B2kQx60Q.css","./assets/G5Pair-DY7_Ri4N.js","./assets/Gfc500-CW7TrjAr.js","./assets/Gns430-Dj2ghmmZ.js","./assets/Gns530-trDyDe3S.js","./assets/GnsUnit-CZn0aax5.js","./assets/GnsUnit-o9hUPyi3.css","./assets/Gtn650-DmCzYtDz.js","./assets/Gtn750-BNm6NhDg.js","./assets/GtnUnit-BLUVw1zx.js","./assets/GtnUnit-DroYXNR-.css","./assets/Gtx345-BbXJ1eAc.js","./assets/Kap140-C-ku-hkG.js","./assets/Knob-D0ucv8qB.js","./assets/Kt76a-D3lHKOsW.js","./assets/Screen-hilHEhTE.js","./assets/SteamPanel-DeBnSOW6.js","./assets/autopilot-DuXvLDIM.css","./assets/barlow-semi-condensed-latin-500-normal-CFOoVYFH.woff","./assets/barlow-semi-condensed-latin-500-normal-G0uxJNrM.woff2","./assets/barlow-semi-condensed-latin-600-normal-BkLiAYu4.woff2","./assets/barlow-semi-condensed-latin-600-normal-DyOfdMBA.woff","./assets/barlow-semi-condensed-latin-700-normal-BMyZXq_9.woff","./assets/barlow-semi-condensed-latin-700-normal-BpqDG8I9.woff2","./assets/barlow-semi-condensed-latin-ext-500-normal-BXdp1BvY.woff2","./assets/barlow-semi-condensed-latin-ext-500-normal-rZeYuEMb.woff","./assets/barlow-semi-condensed-latin-ext-600-normal-BkQ9hN72.woff2","./assets/barlow-semi-condensed-latin-ext-600-normal-BuP8AaxH.woff","./assets/barlow-semi-condensed-latin-ext-700-normal-BhgEo64M.woff2","./assets/barlow-semi-condensed-latin-ext-700-normal-C0vCoZIV.woff","./assets/barlow-semi-condensed-vietnamese-500-normal-DGADhYWF.woff2","./assets/barlow-semi-condensed-vietnamese-500-normal-hJ2t9k9e.woff","./assets/barlow-semi-condensed-vietnamese-600-normal-DzVrjA0Q.woff","./assets/barlow-semi-condensed-vietnamese-600-normal-b1FQiZcx.woff2","./assets/barlow-semi-condensed-vietnamese-700-normal-BvUTSFNY.woff","./assets/barlow-semi-condensed-vietnamese-700-normal-Dm7RZTvf.woff2","./assets/compat-CPL6vf3_.js","./assets/format-DTNhnBtg.js","./assets/g1000-BkhuZZuh.css","./assets/g1000-C09ukMvU.js","./assets/geo-DtHiDLAU.js","./assets/identEntry-BKXLKZAC.js","./assets/index-BwT8wWWl.css","./assets/index-DqFrD-VF.js","./assets/palette-bPUC451Z.js","./assets/useUnit-BMMgcf8Y.js","./assets/xpdr-B3WOvcI3.js","./assets/xpdr-vnFDo3Y9.css","./data/basemap.json","./data/magvar.json","./data/navdata.json","./icon-192.png","./icon-512.png","./icon.svg","./index.html","./manifest.webmanifest"];

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
