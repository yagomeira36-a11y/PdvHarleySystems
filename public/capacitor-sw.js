const CACHE_NAME = "harley-pdv-android-shell-v1";
const CACHE_PREFIX = "harley-pdv-android-shell-";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function cacheResponse(request, response) {
  if (!response.ok || response.type !== "basic") return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
}

async function aquecerCache(urls) {
  const sameOriginUrls = urls.filter((value) => {
    try {
      return new URL(value, self.location.origin).origin === self.location.origin;
    } catch {
      return false;
    }
  });

  await Promise.all(
    sameOriginUrls.map(async (value) => {
      const url = new URL(value, self.location.origin);
      const request = new Request(url.href, { credentials: "include" });
      try {
        const response = await fetch(request);
        await cacheResponse(request, response);
      } catch (error) {
        console.warn(`Não foi possível armazenar ${url.href} para uso offline:`, error);
      }
    })
  );
}

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_SHELL") return;
  event.waitUntil(
    aquecerCache([event.data.url, ...(Array.isArray(event.data.resources) ? event.data.resources : [])])
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          await cacheResponse(request, response);
          return response;
        } catch {
          const cachedPage = await caches.match(request);
          if (cachedPage) return cachedPage;

          return new Response(
            "<!doctype html><html lang=\"pt-BR\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Offline</title><body><main><h1>PDV offline</h1><p>Conecte-se à internet e abra o PDV novamente para carregar os dados.</p></main></body></html>",
            {
              status: 503,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            }
          );
        }
      })()
    );
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    ["script", "style", "font", "image"].includes(request.destination)
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        if (cached) return cached;

        const response = await fetch(request);
        await cacheResponse(request, response);
        return response;
      })()
    );
  }
});
