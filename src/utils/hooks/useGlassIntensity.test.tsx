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
                glassIntensity: preference
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
    it("returns an explicit choice unchanged (clear)", () => {
        expect(resolveGlassIntensity("clear", false, false)).toBe("clear");
    });

    it("returns an explicit choice unchanged (regular)", () => {
        expect(resolveGlassIntensity("regular", true, true)).toBe("regular");
    });

    it("returns an explicit choice unchanged (solid)", () => {
        expect(resolveGlassIntensity("solid", false, false)).toBe("solid");
    });

    it("auto → solid when the OS reports reduced transparency", () => {
        expect(resolveGlassIntensity("auto", true, false)).toBe("solid");
    });

    it("auto → solid on a coarse pointer (mobile GPU budget)", () => {
        expect(resolveGlassIntensity("auto", false, true)).toBe("solid");
    });

    it("auto → regular on desktop fine-pointer with no opt-out", () => {
        expect(resolveGlassIntensity("auto", false, false)).toBe("regular");
    });

    it("explicit clear beats reduced-transparency (user override wins)", () => {
        // The user can opt INTO glass even when the OS suggests
        // reducing transparency — the explicit toggle is the user's
        // deliberate override.
        expect(resolveGlassIntensity("clear", true, true)).toBe("clear");
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

    it("resolves auto to solid on coarse pointer (mobile GPU budget)", () => {
        stubMatchMedia((q) => q === "(pointer: coarse)");
        const { result } = renderHook(() => useGlassIntensity(), {
            wrapper: wrapperFor(makeStore("auto"))
        });
        expect(result.current).toBe("solid");
        expect(document.documentElement.dataset.glassIntensity).toBe("solid");
    });

    it("explicit clear preference wins over the reduced-transparency ladder", () => {
        // User deliberately turned glass ON despite the OS hint — the
        // explicit choice must override the auto ladder. Mirrors the
        // "explicit clear beats reduced-transparency" unit above but
        // proves the hook also threads the value through.
        stubMatchMedia((q) => q === "(prefers-reduced-transparency: reduce)");
        const { result } = renderHook(() => useGlassIntensity(), {
            wrapper: wrapperFor(makeStore("clear"))
        });
        expect(result.current).toBe("clear");
        expect(document.documentElement.dataset.glassIntensity).toBe("clear");
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
