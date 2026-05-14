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
 * Tests mock this module so the simulated click can advance jsdom's
 * URL (which doesn't honor real anchor navigation) — see
 * `src/__tests__/app.integration.test.tsx` for the pattern.
 */
const nativeNavigate = (url: string): void => {
    if (typeof window === "undefined") {
        return;
    }
    window.location.assign(url);
};

export default nativeNavigate;
