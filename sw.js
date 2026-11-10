/* bash-electro service worker: offline za samu aplikaciju.
   Firebase (Auth/Firestore) ide uvijek direktno na mrežu – ne kešira se. */
const C='bash-electro-v2';
const CORE=['./','./index.html','./manifest.webmanifest','./css/cloud.css','./js/cloud.js','./js/firebase-config.js','./icons/icon-192.png','./icons/icon-512.png','https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'];
const CACHE_HOSTS=[location.host,'cdnjs.cloudflare.com','www.gstatic.com','fonts.googleapis.com','fonts.gstatic.com'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>Promise.allSettled(CORE.map(u=>c.add(u)))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;
  let u;try{u=new URL(r.url)}catch(x){return}
  if(!CACHE_HOSTS.includes(u.host)||u.pathname.startsWith('/__/'))return;
  e.respondWith(fetch(r).then(res=>{if(res.ok||res.type==='opaque'){const cp=res.clone();caches.open(C).then(c=>c.put(r,cp))}return res})
    .catch(()=>caches.match(r).then(x=>x||(r.mode==='navigate'?caches.match('./index.html'):Response.error()))))});
