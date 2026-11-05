const APP_VERSION = "20261105-v32";
const CACHE_NAME = "sim-murojaah-ibs-" + APP_VERSION;

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./app.js",
  "./icon-192-v11.png",
  "./icon-512-v11.png",
  "./Download/",
  "./Download/index.html"
];

function isSameOrigin(request) {
  try {
    return new URL(request.url).origin === self.location.origin;
  } catch (err) {
    return false;
  }
}

function safeNavigationCacheKey(url) {
  const clean = new URL(url.href);
  clean.search = "";
  clean.hash = "";
  return clean.href;
}

function isPublicTokenRoute(url) {
  return url.searchParams.has("raporToken") || url.searchParams.has("laporanToken");
}

function isCriticalAsset(url) {
  return (
    url.pathname.endsWith("/index.html") ||
    url.pathname.endsWith("/manifest.webmanifest") ||
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/icon-192-v11.png") ||
    url.pathname.endsWith("/icon-512-v11.png")
  );
}

async function precacheShell(cache) {
  await Promise.all(APP_SHELL.map(async function (path) {
    try {
      const absoluteUrl = new URL(path, self.registration.scope).href;
      const request = new Request(absoluteUrl, { cache: "reload" });
      const response = await fetch(request);
      if (response && response.ok) {
        await cache.put(absoluteUrl, response.clone());
      }
    } catch (err) {
      // Satu aset tambahan yang tidak tersedia tidak boleh menggagalkan SW.
      console.warn("Precache dilewati:", path, err);
    }
  }));
}

async function networkFirst(request, fallbackUrl) {
  const requestUrl = new URL(request.url);
  const cache = await caches.open(CACHE_NAME);
  const cacheKey = safeNavigationCacheKey(requestUrl);

  try {
    const response = await fetch(request, { cache: "no-store" });

    if (response && response.ok && isSameOrigin(request)) {
      await cache.put(cacheKey, response.clone());
    }

    return response;
  } catch (err) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }

    return Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);

  const fetchPromise = fetch(request)
    .then(async function (response) {
      if (response && response.ok && isSameOrigin(request)) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(function () {
      return cached || Response.error();
    });

  return cached || fetchPromise;
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(precacheShell)
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return key.startsWith("sim-murojaah-ibs-") && key !== CACHE_NAME;
            })
            .map(function (key) {
              return caches.delete(key);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
      .then(function () {
        return self.clients.matchAll({
          type: "window",
          includeUncontrolled: true
        });
      })
      .then(function (clientList) {
        clientList.forEach(function (client) {
          client.postMessage({
            type: "SIM_SW_ACTIVATED",
            version: APP_VERSION
          });
        });
      })
  );
});

self.addEventListener("message", function (event) {
  const data = event.data || {};
  if (data.type === "SIM_SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", function (event) {
  const request = event.request;
  if (request.method !== "GET") return;
  if (!isSameOrigin(request)) return;

  const url = new URL(request.url);

  if (url.pathname.endsWith("/sw.js")) return;

  /*
   * Jangan simpan token rapor/laporan pada Cache Storage.
   * Route publik tetap dimuat dari jaringan lalu diarahkan ke Apps Script.
   */
  if (request.mode === "navigate" && isPublicTokenRoute(url)) {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .catch(function () {
          return caches.match(new URL("./index.html", self.registration.scope).href);
        })
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(
        request,
        new URL("./index.html", self.registration.scope).href
      )
    );
    return;
  }

  if (isCriticalAsset(url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

/* =========================
   FCM BACKGROUND PUSH
========================= */

function safeJsonFromPush(event) {
  try {
    if (!event.data) return {};
    return event.data.json();
  } catch (err) {
    return {};
  }
}

self.addEventListener("push", function (event) {
  const payload = safeJsonFromPush(event);
  const data = payload.data || {};
  const notification = payload.notification || {};

  const title =
    notification.title ||
    data.title ||
    "SIM Murojaah IBS";

  const body =
    notification.body ||
    data.body ||
    "Ada notifikasi baru.";

  let targetUrl = data.url || data.link || "./";
  try {
    const parsed = new URL(targetUrl, self.registration.scope);
    if (parsed.origin !== self.location.origin) {
      targetUrl = self.registration.scope;
    } else {
      targetUrl = parsed.toString();
    }
  } catch (err) {
    targetUrl = self.registration.scope;
  }

  const icon = data.icon || "./icon-192-v11.png";
  const badge = data.badge || "./icon-192-v11.png";

  const options = {
    body: body,
    icon: icon,
    badge: badge,
    data: { url: targetUrl },
    tag: data.tag || "sim-murojaah-notification",
    renotify: true,
    requireInteraction: data.requireInteraction === "true"
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();

  let targetUrl =
    event.notification && event.notification.data && event.notification.data.url
      ? event.notification.data.url
      : self.registration.scope;

  try {
    const parsed = new URL(targetUrl, self.registration.scope);
    targetUrl = parsed.origin === self.location.origin
      ? parsed.toString()
      : self.registration.scope;
  } catch (err) {
    targetUrl = self.registration.scope;
  }

  event.waitUntil(
    self.clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then(function (clientList) {
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();
          client.postMessage({
            type: "SIM_NOTIFICATION_CLICK",
            url: targetUrl
          });
          return;
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
