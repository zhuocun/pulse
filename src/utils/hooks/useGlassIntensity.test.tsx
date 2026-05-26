import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";

import {
    userPreferencesActions,
    userPreferencesSlice,
    type GlassIntensityPreference
} from "../../store/reducers/userPreferencesSlice";

import useGlassIntensity, { resolveGlassIntensity } from "./useGlassIntensity";

const makeStore = (preference: GlassIntensityPreference = "auto") =>
    configureStore({
        reducer: { userPreferences: userPreferencesSlice.reducer },
        preloadedState: {
            userPreferences: {
                boardDensity: "comfortable" as const,
                savedFilterPresets: [],
                projectListDefaults: null,
                glassIntensity: preference,
                // Phase 6 Wave 1 — set the version sentinel so the
                // hook reads the post-migration shape (the test
                // store doesn't go through the load-path migration).
                glassIntensityVersion: 1,
                colorTheme: "orange" as const
            }
        }
    });

const wrapperFor = (store: ReturnType<typeof makeStore>) => {
    const Wrapper = ({ children }: { children: ReactNode }) => (
        <Provider store={store}>{children}</Provider>
    );
    return Wrapper;
};

/**
 * Helpers that stage the two media queries the hook depends on. The
 * default jest setup at `src/setupTests.ts` stubs `matchMedia` with a
 * `matches: false` result for every query; we extend that to selectively
 * return `true` for the queries we care about so each ladder branch
 * can be asserted in isolation.
 */
type Predicate = (query: string) => boolean;

const stubMatchMedia = (predicate: Predicate) => {
    // setupTests.ts pre-installs a non-configurable `matchMedia` mock;
    // reassigning the writable property is the supported path. Replace
    // the per-test default with one that honours the predicate so each
    // ladder branch can be asserted in isolation.
    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
        matches: predicate(query),
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn()
    })) as unknown as typeof window.matchMedia;
};

describe("resolveGlassIntensity (pure ladder)", () => {
    it("returns an explicit choice unchanged (clear) with no a11y signals", () => {
        expect(resolveGlassIntensity("clear", false, false)).toBe("clear");
    });

    it("returns an explicit choice unchanged (regular) with no a11y signals", () => {
        // Phase 6 Wave 1 — accessibility signals (reducedTransparency,
        // forcedColors) now beat explicit picks. With neither active,
        // the user's regular pick is honoured even on a coarse pointer.
        expect(resolveGlassIntensity("regular", false, true)).toBe("regular");
    });

    it("returns an explicit choice unchanged (solid)", () => {
        expect(resolveGlassIntensity("solid", false, false)).toBe("solid");
    });

    it("auto → solid when the OS reports reduced transparency", () => {
        expect(resolveGlassIntensity("auto", true, false)).toBe("solid");
    });

    /*
     * Phase 6 Wave 1 — the coarse-pointer "auto" default flipped from
     * "solid" to "regular". The iOS-26 chrome upgrades shipped in
     * Phase 5 were invisible on mobile under the old default; flipping
     * to regular makes Liquid Glass the default mobile experience.
     * Existing users keep Solid via the `glassIntensityVersion`
     * migration in `userPreferencesSlice`.
     */
    it("auto → regular on a coarse pointer (Phase 6 default flip)", () => {
        expect(resolveGlassIntensity("auto", false, true)).toBe("regular");
    });

    it("auto → regular on desktop fine-pointer with no opt-out", () => {
        expect(resolveGlassIntensity("auto", false, false)).toBe("regular");
    });

    /*
     * Phase 6 Wave 1 — accessibility signals now win over explicit
     * user picks. The previous baseline let an explicit `"clear"` /
     * `"regular"` slip past the reduced-transparency / forced-colors
     * gate, leaving high-contrast users stranded with translucent
     * chrome. Both signals now step down to `"solid"` regardless of
     * the stored preference.
     */
    it("reduced-transparency steps down explicit clear to solid (a11y beats user pick)", () => {
        expect(resolveGlassIntensity("clear", true, false)).toBe("solid");
    });

    it("reduced-transparency steps down explicit regular to solid (a11y beats user pick)", () => {
        expect(resolveGlassIntensity("regular", true, false)).toBe("solid");
    });

    it("forced-colors steps down explicit clear to solid (a11y beats user pick)", () => {
        expect(resolveGlassIntensity("clear", false, false, true)).toBe(
            "solid"
        );
    });

    it("forced-colors steps down explicit regular to solid (a11y beats user pick)", () => {
        expect(resolveGlassIntensity("regular", false, false, true)).toBe(
            "solid"
        );
    });

    it("forced-colors wins over the auto ladder (coarse pointer, explicit clear)", () => {
        // The full priority test: forced-colors active +
        // (pointer: coarse) + explicit "clear" → "solid". Forced-colors
        // is at the top of the ladder, so even the user-pick branch
        // and the coarse-pointer branch don't get a chance to fire.
        expect(resolveGlassIntensity("clear", false, true, true)).toBe("solid");
    });

    it("forced-colors wins over reduced-transparency (both lead to solid; order is moot but ladder docs forced-colors first)", () => {
        expect(resolveGlassIntensity("auto", true, false, true)).toBe("solid");
    });

    it("forcedColors defaults to false when omitted (backwards compatibility)", () => {
        // The new resolver takes a fourth optional `forcedColors` arg.
        // Callers that pass only three (analytics, screenshot tests,
        // legacy code paths) get the previous behavior — equivalent to
        // forcedColors=false.
        expect(resolveGlassIntensity("auto", false, false)).toBe("regular");
        expect(resolveGlassIntensity("clear", false, false)).toBe("clear");
    });
});

describe("useGlassIntensity", () => {
    beforeEach(() => {
        // Reset jsdom state between tests so attribute writes from
        // one case don't leak.
        if (typeof document !== "undefined") {
            delete document.documentElement.dataset.glassIntensity;
        }
    });

    it("returns 'regular' by default on desktop with no opt-out", () => {
        stubMatchMedia(() => false);
        const { result } = renderHook(() => useGlassIntensity(), {
            wrapper: wrapperFor(makeStore("auto"))
        });
        expect(result.current).toBe("regular");
        expect(document.documentElement.dataset.glassIntensity).toBe("regular");
    });

    it("resolves auto to solid when prefers-reduced-transparency is set", () => {
        stubMatchMedia((q) => q === "(prefers-reduced-transparency: reduce)");
        const { result } = renderHook(() => useGlassIntensity(), {
            wrapper: wrapperFor(makeStore("auto"))
        });
        expect(result.current).toBe("solid");
        expect(document.documentElement.dataset.glassIntensity).toBe("solid");
    });

    it("resolves auto to regular on coarse pointer (Phase 6 mobile default flip)", () => {
        // Phase 6 Wave 1 — the coarse-pointer default flipped from
        // "solid" to "regular". Existing users keep Solid via the
        // glassIntensityVersion migration; new "auto" users get the
        // iOS-26 Liquid Glass treatment as the mobile default.
        stubMatchMedia((q) => q === "(pointer: coarse)");
        const { result } = renderHook(() => useGlassIntensity(), {
            wrapper: wrapperFor(makeStore("auto"))
        });
        expect(result.current).toBe("regular");
        expect(document.documentElement.dataset.glassIntensity).toBe("regular");
    });

    it("reduced-transparency steps down explicit clear to solid (Phase 6 a11y wins)", () => {
        // Phase 6 Wave 1 — accessibility signals now win over explicit
        // user picks. The previous baseline let "clear" slip past the
        // reduced-transparency gate; a user who picked "clear" for
        // desktop and switched to a high-contrast profile was stranded.
        stubMatchMedia((q) => q === "(prefers-reduced-transparency: reduce)");
        const { result } = renderHook(() => useGlassIntensity(), {
            wrapper: wrapperFor(makeStore("clear"))
        });
        expect(result.current).toBe("solid");
        expect(document.documentElement.dataset.glassIntensity).toBe("solid");
    });

    it("reduced-transparency steps down explicit regular to solid (Phase 6 a11y wins)", () => {
        stubMatchMedia((q) => q === "(prefers-reduced-transparency: reduce)");
        const { result } = renderHook(() => useGlassIntensity(), {
            wrapper: wrapperFor(makeStore("regular"))
        });
        expect(result.current).toBe("solid");
        expect(document.documentElement.dataset.glassIntensity).toBe("solid");
    });

    it("forced-colors active resolves to solid even for explicit clear (Phase 6 a11y wins)", () => {
        // Forced-colors (Windows high-contrast) replaces every author
        // colour with system tokens; translucent surfaces paint the
        // system Canvas through them and become invisible. Step down
        // to solid regardless of the user's stored pick.
        stubMatchMedia((q) => q === "(forced-colors: active)");
        const { result } = renderHook(() => useGlassIntensity(), {
            wrapper: wrapperFor(makeStore("clear"))
        });
        expect(result.current).toBe("solid");
        expect(document.documentElement.dataset.glassIntensity).toBe("solid");
    });

    it("forced-colors wins over coarse-pointer + explicit clear (full ladder)", () => {
        // The integration test: forced-colors: active AND pointer:
        // coarse AND user picked "clear" → "solid". Forced-colors is
        // at the top of the ladder, so it short-circuits both the
        // user-pick branch and the coarse-pointer branch.
        stubMatchMedia(
            (q) => q === "(forced-colors: active)" || q === "(pointer: coarse)"
        );
        const { result } = renderHook(() => useGlassIntensity(), {
            wrapper: wrapperFor(makeStore("clear"))
        });
        expect(result.current).toBe("solid");
        expect(document.documentElement.dataset.glassIntensity).toBe("solid");
    });

    it("explicit solid preference is written even when ladder would have picked regular", () => {
        stubMatchMedia(() => false);
        const { result } = renderHook(() => useGlassIntensity(), {
            wrapper: wrapperFor(makeStore("solid"))
        });
        expect(result.current).toBe("solid");
    });

    it("re-resolves when the preference dispatches a new value", () => {
        stubMatchMedia(() => false);
        const store = makeStore("auto");
        const { result } = renderHook(() => useGlassIntensity(), {
            wrapper: wrapperFor(store)
        });
        expect(result.current).toBe("regular");
        act(() =>
            store.dispatch(userPreferencesActions.setGlassIntensity("clear"))
        );
        expect(result.current).toBe("clear");
        expect(document.documentElement.dataset.glassIntensity).toBe("clear");
    });

    it("clears the html data attribute on unmount", () => {
        stubMatchMedia(() => false);
        const { unmount } = renderHook(() => useGlassIntensity(), {
            wrapper: wrapperFor(makeStore("clear"))
        });
        expect(document.documentElement.dataset.glassIntensity).toBe("clear");
        unmount();
        expect(document.documentElement.dataset.glassIntensity).toBeUndefined();
    });
});
