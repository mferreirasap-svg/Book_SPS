// Service worker do editor "Retoque": funciona offline e guarda os modelos de IA após o 1º uso.
const CACHE = 'retoque-v1';
const AI_CACHE = 'retoque-ai';
const SHELL = [
  './editor-fotos.html',
  './editor-fotos.webmanifest',
  './icons/retoque-192.png',
  './icons/retoque-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('retoque-') && k !== CACHE && k !== AI_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const u = new URL(req.url);
  const isAI = (u.hostname === 'cdn.jsdelivr.net' && u.pathname.includes('/@mediapipe/'))
            || (u.hostname === 'storage.googleapis.com' && u.pathname.startsWith('/mediapipe-models/'));
  if(isAI){
    // versões fixas: cache primeiro
    e.respondWith(caches.open(AI_CACHE).then(async c => {
      const hit = await c.match(req);
      if(hit) return hit;
      const res = await fetch(req);
      if(res.ok) c.put(req, res.clone());
      return res;
    }));
  } else if(u.origin === location.origin){
    // app: rede primeiro (pega atualizações), cache se estiver offline
    e.respondWith(fetch(req).then(res => {
      if(res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, {ignoreSearch:true})));
  }
});
