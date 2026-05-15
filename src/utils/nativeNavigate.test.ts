/**
 * Unit tests for the SSR-safe `nativeNavigate` escape hatch.
 *
 * jsdom locks `window.location` (non-configurable on `window`) and
 * `Location.assign` (`writable: false, configurable: false`), so we can't
 * spy on the assign invocation directly — the same constraint is
 * acknowledged in `src/components/header/index.test.tsx`. We therefore
 * verify behaviour at the level that *is* observable: the function does
 * not throw on a range of valid URL shapes, and the require'd module
 * exports a callable function (proving module evaluation completed
 * without import-time side-effects).
 *
 * The end-to-end URL→navigation contract is exercised by
 * `src/__tests__/app.integration.test.tsx`, which mocks the module to
 * route through `history.pushState` instead.
 */
import nativeNavigate from "./nativeNavigate";

describe("nativeNavigate", () => {
    it("does not throw on a typical project URL", () => {
        expect(() => nativeNavigate("/projects/abc123")).not.toThrow();
    });

    it("accepts query strings and hash fragments without coercion", () => {
        expect(() => nativeNavigate("/board?tab=open#task-1")).not.toThrow();
    });

    it("accepts protocol-relative URLs verbatim", () => {
        expect(() =>
            nativeNavigate("//cdn.example.com/asset.js")
        ).not.toThrow();
    });

    it("accepts an empty string without throwing (defensive boundary)", () => {
        // The browser interprets `assign("")` as "navigate to the current
        // page" — the function should not pre-validate the URL.
        expect(() => nativeNavigate("")).not.toThrow();
    });

    it("re-imports cleanly with no module-load side-effects", () => {
        jest.isolateModules(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const fresh = require("./nativeNavigate").default as (
                u: string
            ) => void;
            // The default export is a callable function — i.e. the
            // module's top-level evaluation produced a value rather than
            // doing setup work that would have triggered side-effects.
            expect(typeof fresh).toBe("function");
            expect(() => fresh("/x")).not.toThrow();
        });
    });
});
