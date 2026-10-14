const CACHE = 'app-shell-22';

const SHELL = [
  '/',
  '/index.html',
  '/styles.css?v=app-shell-22',
  '/app.js?v=app-shell-22',
  '/js/config.js?v=app-shell-22',
  '/js/db.js?v=app-shell-22',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/apple-touch-icon.png'
];

function isLiveData(url) {
  if (url.hostname.endsWith('.supabase.co')) return true;
  if (url.pathname.startsWith('/api/')) return true;
  return false;
}

function isShellAsset(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname === '/manifest.webmanifest') return true;
  if (url.pathname.startsWith('/icons/')) return true;
  return url.searchParams.get('v') === CACHE && /\.(?:js|css)$/.test(url.pathname);
}

function isDocument(request, url) {
  if (request.mode === 'navigate') return true;
  if (url.origin !== self.location.origin) return false;
  return url.pathname === '/' || url.pathname.endsWith('/index.html');
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) await cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true })
      || await cache.match('/index.html')
      || await cache.match('/');
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (isLiveData(url)) {
    event.respondWith(fetch(request));
    return;
  }
  if (isDocument(request, url)) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (isShellAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
});
