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
 *   - Unclassified same-origin GETs: NetworkOnly (no implicit caching)
 *
 * Update lifecycle:
 *   `install` no longer calls `self.skipWaiting()` — instead, the client
 *   surfaces a "New version available" toast and explicitly posts
 *   `{type: "SKIP_WAITING"}` when the user accepts. This avoids dropping
 *   in-flight state on a tab the user hasn't seen the update offer in.
 *
 * Cache versioning:
 *   `CACHE_VERSION` is the source of truth — bump it on every deploy
 *   that changes the cached asset set. `activate` deletes any cache key
 *   that doesn't carry the current version prefix, so stale caches from
 *   previous releases are evicted lazily on the first new activation.
 */

const CACHE_VERSION = "pulse-v4";
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const FONT_CACHE = `${CACHE_VERSION}-fonts`;
const IMAGE_CACHE = `${CACHE_VERSION}-images`;

const ACTIVE_CACHES = [APP_SHELL_CACHE, STATIC_CACHE, FONT_CACHE, IMAGE_CACHE];

const APP_SHELL_URLS = ["/", "/index.html"];

/*
 * Allow-list of same-origin path prefixes that may be cached under
 * STATIC_CACHE. Anything outside this list (e.g. /api/, /share-target,
 * a future /auth/csrf) falls through to network-only — this prevents
 * the catch-all SWR strategy from silently capturing JSON endpoints.
 */
const STATIC_PATH_PREFIXES = [
    "/icons/",
    "/assets/",
    "/manifest.webmanifest",
    "/apple-touch-icon"
];

self.addEventListener("install", (event) => {
    // NOTE: intentionally no `self.skipWaiting()` here. The client posts
    // `{type: "SKIP_WAITING"}` after the user accepts the update toast.
    event.waitUntil(
        caches
            .open(APP_SHELL_CACHE)
            .then((cache) => cache.addAll(APP_SHELL_URLS))
    );
});

self.addEventListener("message", (event) => {
    // Client-driven update: the page posts `{type: "SKIP_WAITING"}` from
    // the reload toast once the user is ready to swap to the new worker.
    if (event.data && event.data.type === "SKIP_WAITING") {
        self.skipWaiting();
    }
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
                                !ACTIVE_CACHES.includes(key)
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

function isAppShellStatic(url) {
    if (url.origin !== self.location.origin) return false;
    return STATIC_PATH_PREFIXES.some((prefix) =>
        url.pathname.startsWith(prefix)
    );
}

self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    if (event.request.method !== "GET") return;
    if (isApiRequest(url)) return;

    if (isNavigationRequest(event.request)) {
        // Network-first for HTML — picks up new bundles immediately, falls
        // back to the cached shell on offline / slow networks.
        event.respondWith(networkFirst(event.request, APP_SHELL_CACHE));
        return;
    }

    if (isHashedAsset(url)) {
        // Cache-first for content-hashed assets. The hash itself is the
        // cache buster, so any change ships a new URL.
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

    /*
     * Routing order is load-bearing: `isAppShellStatic` MUST run before
     * `isImage`. Same-origin shell paths like `/icons/icon-*.png` and
     * `/apple-touch-icon-*.png` would otherwise be captured by the
     * generic image predicate and routed to IMAGE_CACHE's SWR strategy,
     * defeating the cache-first contract those install assets need.
     * Cross-origin images (CDN avatars, etc.) still flow through
     * `isImage` because `isAppShellStatic` rejects non-same-origin URLs.
     * See Bug 4 in `docs/design/ui-ux-comprehensive-review-2026-05.md`.
     */
    if (isAppShellStatic(url)) {
        // Same-origin static shell paths (icons, manifest, apple-touch-icon,
        // /assets/ Vite bucket) cache-first.
        event.respondWith(cacheFirst(event.request, STATIC_CACHE));
        return;
    }

    if (isImage(url)) {
        event.respondWith(staleWhileRevalidate(event.request, IMAGE_CACHE));
        return;
    }

    // NOTE: unclassified same-origin GETs intentionally fall through to
    // the browser's network handling. The previous catch-all SWR captured
    // any same-origin response into STATIC_CACHE — a footgun for future
    // JSON-shaped endpoints that live outside /api/.
});
