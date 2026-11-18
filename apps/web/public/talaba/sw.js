self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));

self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.mode!=='navigate'||url.origin!==self.location.origin||!url.pathname.startsWith('/talaba/'))return;
  event.respondWith(fetch(event.request).catch(()=>new Response(`<!doctype html><html lang="uz"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>UniVisa Talaba</title><body><h1>Internetga ulaning</h1><p>Hujjatlar va arizalarni ko‘rish uchun ulanish kerak.</p><a href="/talaba/">Qayta urinish</a></body></html>`,{
    status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'},
  })));
});
