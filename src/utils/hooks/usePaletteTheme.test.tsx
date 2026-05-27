import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";

import {
    userPreferencesActions,
    userPreferencesSlice,
    type ColorThemePreference
} from "../../store/reducers/userPreferencesSlice";
import { getPalette, paletteToCss } from "../../theme/palettes";

import usePaletteTheme from "./usePaletteTheme";

const STYLE_ID = "pulse-theme-vars";

const makeStore = (colorTheme: ColorThemePreference = "orange") =>
    configureStore({
        reducer: { userPreferences: userPreferencesSlice.reducer },
        preloadedState: {
            userPreferences: {
                boardDensity: "comfortable" as const,
                savedFilterPresets: [],
                projectListDefaults: null,
                glassIntensity: "auto" as const,
                glassIntensityVersion: 1,
                colorTheme
            }
        }
    });

const wrapperFor = (store: ReturnType<typeof makeStore>) => {
    const Wrapper = ({ children }: { children: ReactNode }) => (
        <Provider store={store}>{children}</Provider>
    );
    return Wrapper;
};

const styleEl = () =>
    document.getElementById(STYLE_ID) as HTMLStyleElement | null;

describe("usePaletteTheme", () => {
    beforeEach(() => {
        // Remove any seeded / leftover style element between tests so each
        // case exercises a clean DOM.
        styleEl()?.remove();
    });

    it("returns the resolved palette for the stored name (orange default)", () => {
        const { result } = renderHook(() => usePaletteTheme(), {
            wrapper: wrapperFor(makeStore("orange"))
        });
        expect(result.current.name).toBe("orange");
    });

    it("returns the chosen palette when an explicit theme is stored", () => {
        const { result } = renderHook(() => usePaletteTheme(), {
            wrapper: wrapperFor(makeStore("emerald"))
        });
        expect(result.current.name).toBe("emerald");
    });

    it("falls back to orange for an unknown stored name", () => {
        const { result } = renderHook(() => usePaletteTheme(), {
            // Cast through unknown — the slice type forbids this value,
            // but a hand-edited localStorage blob could carry it; the
            // resolver must not strand the app.
            wrapper: wrapperFor(
                makeStore("not-a-palette" as ColorThemePreference)
            )
        });
        expect(result.current.name).toBe("orange");
    });

    it("creates the style element when absent and renders the palette CSS", () => {
        expect(styleEl()).toBeNull();
        renderHook(() => usePaletteTheme(), {
            wrapper: wrapperFor(makeStore("sky"))
        });
        const el = styleEl();
        expect(el).not.toBeNull();
        expect(el?.textContent).toBe(paletteToCss(getPalette("sky")));
    });

    it("replaces an existing seeded element's content in place (no duplicate)", () => {
        // Simulate index.tsx's synchronous seed with the orange default.
        const seed = document.createElement("style");
        seed.id = STYLE_ID;
        seed.textContent = paletteToCss(getPalette("orange"));
        document.head.appendChild(seed);

        renderHook(() => usePaletteTheme(), {
            wrapper: wrapperFor(makeStore("sky"))
        });
        // Exactly one element with the id — the seed was reused, not
        // duplicated.
        expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1);
        expect(styleEl()?.textContent).toBe(paletteToCss(getPalette("sky")));
    });

    it("re-renders the CSS when the preference dispatches a new value", () => {
        const store = makeStore("orange");
        const { result } = renderHook(() => usePaletteTheme(), {
            wrapper: wrapperFor(store)
        });
        expect(result.current.name).toBe("orange");
        act(() => store.dispatch(userPreferencesActions.setColorTheme("sky")));
        expect(result.current.name).toBe("sky");
        expect(styleEl()?.textContent).toBe(paletteToCss(getPalette("sky")));
    });

    it("restores the orange default on unmount (does not strand the app)", () => {
        const { unmount } = renderHook(() => usePaletteTheme(), {
            wrapper: wrapperFor(makeStore("emerald"))
        });
        expect(styleEl()?.textContent).toBe(
            paletteToCss(getPalette("emerald"))
        );
        unmount();
        // Cleanup restores the default rather than deleting the element so
        // the whole app's colour identity stays intact.
        expect(styleEl()).not.toBeNull();
        expect(styleEl()?.textContent).toBe(paletteToCss(getPalette("orange")));
    });
});
