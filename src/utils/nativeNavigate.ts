/**
 * Force a real browser document navigation. Used as a deliberate
 * escape hatch around React Router's history listener on iOS Safari
 * WebKit and Chrome Android, both of which were observed to advance
 * the URL via `history.pushState` without re-rendering the `Routes`
 * element — clicking the project card or the logo would land in
 * `URL changed, page didn't navigate` purgatory until refresh.
 *
 * `window.location.assign` triggers a full document fetch, the React
 * app mounts fresh from `index.html`, and React Router reads the URL
 * on the first render. Slower than SPA navigation; reliable.
 *
 * Same-URL guard: if some other React effect raced ahead and already
 * `replaceState`d the URL to our target (e.g. a `<Navigate>` woken
 * by `useSyncExternalStore` during a fresh login on iPhone iOS 25.5),
 * `window.location.assign(currentPath)` is silently treated as a
 * no-op by mobile Safari and the React tree is never refreshed. Fall
 * back to `reload()` in that case so the document actually reloads
 * and the routing tree mounts cleanly from `index.html`.
 *
 * Tests mock this module so the simulated click can advance jsdom's
 * URL (which doesn't honor real anchor navigation) — see
 * `src/__tests__/app.integration.test.tsx` for the pattern.
 */
const nativeNavigate = (url: string): void => {
    if (typeof window === "undefined") {
        return;
    }
    const { pathname, search, hash } = window.location;
    if (url === pathname + search + hash || url === pathname + search) {
        window.location.reload();
        return;
    }
    window.location.assign(url);
};

export default nativeNavigate;
