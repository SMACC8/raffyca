/* Raffyca service worker — offline per la traversata.
   Strategia: navigazione network-first (niente trappola della cache vecchia),
   app-shell e dati statici cache-first, tile e forecast con fallback alla cache. */
var VERSION = 'raffyca-rt-v1';
var SHELL = VERSION + '-shell';
var TILES = VERSION + '-tiles';
var DATA  = VERSION + '-data';
var TILE_LIMIT = 600;

var PRECACHE = [
  './raffyca-traversata-map.html',
  './manifest.webmanifest',
  './mediterranean_land_10m.geojson',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL).then(function (c) {
      // aggiungi uno per uno: se un asset fallisce non blocca tutta l'installazione
      return Promise.all(PRECACHE.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k.indexOf('raffyca-rt-') === 0 && k.indexOf(VERSION) !== 0) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function trimCache(name, max) {
  caches.open(name).then(function (c) {
    c.keys().then(function (keys) {
      if (keys.length <= max) return;
      for (var i = 0; i < keys.length - max; i++) c.delete(keys[i]);
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var host = url.hostname;

  // navigazione (l'app): network-first → un redeploy si prende sempre se c'è rete
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') >= 0) {
    e.respondWith(
      fetch(req).then(function (r) {
        caches.open(SHELL).then(function (c) { c.put(req, r.clone()); });
        return r;
      }).catch(function () {
        return caches.match(req).then(function (m) {
          return m || caches.match('./raffyca-traversata-map.html');
        });
      })
    );
    return;
  }

  // tile mappa (CARTO / OpenSeaMap): cache-first + rete in sottofondo, con tetto
  if (host.indexOf('basemaps.cartocdn.com') >= 0 || host.indexOf('openseamap.org') >= 0) {
    e.respondWith(
      caches.open(TILES).then(function (c) {
        return c.match(req).then(function (hit) {
          var net = fetch(req).then(function (r) {
            if (r && (r.ok || r.type === 'opaque')) { c.put(req, r.clone()); trimCache(TILES, TILE_LIMIT); }
            return r;
          }).catch(function () { return hit; });
          return hit || net;
        });
      })
    );
    return;
  }

  // forecast Open-Meteo: network-first, fallback all'ultimo scaricato
  if (host.indexOf('open-meteo.com') >= 0) {
    e.respondWith(
      fetch(req).then(function (r) {
        caches.open(DATA).then(function (c) { c.put(req, r.clone()); });
        return r;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

  // ricerca località Nominatim: solo rete (no cache)
  if (host.indexOf('nominatim.openstreetmap.org') >= 0) return;

  // resto (Leaflet, geojson, ecc.): cache-first
  e.respondWith(
    caches.match(req).then(function (m) {
      return m || fetch(req).then(function (r) {
        if (r && r.ok) caches.open(SHELL).then(function (c) { c.put(req, r.clone()); });
        return r;
      });
    })
  );
});
