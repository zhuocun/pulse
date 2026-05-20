/**
 * Service Worker for Pulse PWA.
 *
 * Caching strategy (from docs/mobile-native-best-practices.md §2.F):
 *   - App shell (HTML): NetworkFirst with 3s timeout, fall back to cache
 *   - Hashed static assets (JS/CSS with content hash): CacheFirst (immutable)
 *   - Icons, avatars, images: StaleWhileRevalidate
 *   - Google Fonts stylesheets: StaleWhileRevalidate
 *   - Google Fonts woff2 files: CacheFirst (immutable font binaries)
 *   - API calls: NetworkOnly (handled by React Query)
 */

const CACHE_VERSION = "pulse-v2";
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const FONT_CACHE = `${CACHE_VERSION}-fonts`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;

const APP_SHELL_URLS = ["/", "/index.html"];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(APP_SHELL_CACHE)
            .then((cache) => cache.addAll(APP_SHELL_URLS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter(
                            (key) =>
                                key.startsWith("pulse-") &&
                                ![
                                    APP_SHELL_CACHE,
                                    STATIC_CACHE,
                                    FONT_CACHE,
                                    IMAGE_CACHE
                                ].includes(key)
                        )
                        .map((key) => caches.delete(key))
                )
            )
            .then(() => self.clients.claim())
    );
});

/**
 * NetworkFirst with timeout: attempt network, fall back to cache if the
 * network takes too long or fails entirely.
 */
async function networkFirst(request, cacheName, timeoutMs = 3000) {
    const cache = await caches.open(cacheName);
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(request, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (response.ok) {
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        const cached = await cache.match(request);
        return cached || new Response("Offline", { status: 503 });
    }
}

/**
 * CacheFirst: serve from cache if available, otherwise fetch and cache.
 * Used for immutable hashed assets.
 */
async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
        cache.put(request, response.clone());
    }
    return response;
}

/**
 * StaleWhileRevalidate: serve from cache immediately, update in background.
 * Used for non-critical resources that benefit from freshness.
 */
async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    const fetchPromise = fetch(request)
        .then((response) => {
            if (response.ok) {
                cache.put(request, response.clone());
            }
            return response;
        })
        .catch(() => cached);
    return cached || fetchPromise;
}

function isHashedAsset(url) {
    return /\.[a-f0-9]{8,}\.(js|css|woff2?)$/i.test(url.pathname);
}

function isGoogleFontStylesheet(url) {
    return (
        url.hostname === "fonts.googleapis.com" &&
        url.pathname.startsWith("/css")
    );
}

function isGoogleFontFile(url) {
    return (
        url.hostname === "fonts.gstatic.com" && /\.woff2?$/.test(url.pathname)
    );
}

function isImage(url) {
    return /\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(url.pathname);
}

function isNavigationRequest(request) {
    return request.mode === "navigate";
}

function isApiRequest(url) {
    return url.pathname.startsWith("/api/");
}

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    if (event.request.method !== "GET") return;
    if (isApiRequest(url)) return;

    if (isNavigationRequest(event.request)) {
        event.respondWith(networkFirst(event.request, APP_SHELL_CACHE));
        return;
    }

    if (isHashedAsset(url)) {
        event.respondWith(cacheFirst(event.request, STATIC_CACHE));
        return;
    }

    if (isGoogleFontFile(url)) {
        event.respondWith(cacheFirst(event.request, FONT_CACHE));
        return;
    }

    if (isGoogleFontStylesheet(url)) {
        event.respondWith(staleWhileRevalidate(event.request, FONT_CACHE));
        return;
    }

    if (isImage(url)) {
        event.respondWith(staleWhileRevalidate(event.request, IMAGE_CACHE));
        return;
    }

    if (url.origin === self.location.origin) {
        event.respondWith(staleWhileRevalidate(event.request, STATIC_CACHE));
    }
});
