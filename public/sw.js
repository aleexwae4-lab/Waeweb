const CACHE="waeweb-shell-rc55";
const SHELL=["/","/styles.css","/book-experience.css","/app.js","/browser.js",
  "/browser-core.js","/workspace.js","/web-page-merge.js","/omnibox.js",
  "/local-intent.js","/maps-core.js","/native-map.js","/map-tiles.js","/directions.js",
  "/directions-core.js","/translator.js","/youtube-player.js","/voice-reader.js",
  "/accounts.js","/business-profile.js","/marketplace.js",
  "/favicon.svg","/manifest.webmanifest","/opensearch.xml"];
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(
    keys.filter(key=>key.startsWith("waeweb-shell-")&&key!==CACHE).map(key=>caches.delete(key))
  )).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin||url.pathname.startsWith("/api/"))return;
  if(request.mode==="navigate"){
    event.respondWith(fetch(request).then(response=>{
      if(response.ok)caches.open(CACHE).then(cache=>cache.put("/",response.clone()));
      return response;
    }).catch(()=>caches.match("/")));
    return;
  }
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
    if(response.ok&&["script","style","image","manifest"].includes(request.destination))
      caches.open(CACHE).then(cache=>cache.put(request,response.clone()));
    return response;
  })));
});
