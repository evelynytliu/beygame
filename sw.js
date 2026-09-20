// Neon Spinner service worker — app-shell cache for offline play
const CACHE = 'neon-spinner-v2';
const ASSETS = [
    '.',
    'index.html',
    'css/style.css',
    'js/audio.js',
    'js/parts.js',
    'js/app.js',
    'js/vendor/three.min.js',
    'manifest.webmanifest',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;
    e.respondWith(
        caches.match(e.request).then(cached => {
            if (cached) return cached;
            return fetch(e.request).then(resp => {
                const copy = resp.clone();
                if (resp.ok || resp.type === 'opaque') {
                    caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
                }
                return resp;
            }).catch(() => cached);
        })
    );
});
