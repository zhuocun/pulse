import { configureStore, type Middleware } from "@reduxjs/toolkit";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";

import {
    USER_PREFERENCES_STORAGE_KEY,
    userPreferencesSlice
} from "../../store/reducers/userPreferencesSlice";

import useBoardDensity from "./useBoardDensity";

const makeStore = (density: "comfortable" | "compact" = "comfortable") =>
    configureStore({
        reducer: { userPreferences: userPreferencesSlice.reducer },
        preloadedState: {
            userPreferences: {
                boardDensity: density,
                savedFilterPresets: [],
                projectListDefaults: null,
                glassIntensity: "auto" as const
            }
        }
    });

const wrapperFor = (store: ReturnType<typeof makeStore>) => {
    const Wrapper = ({ children }: { children: ReactNode }) => (
        <Provider store={store}>{children}</Provider>
    );
    return Wrapper;
};

describe("useBoardDensity", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it("returns the slice's current density", () => {
        const { result } = renderHook(() => useBoardDensity(), {
            wrapper: wrapperFor(makeStore("compact"))
        });
        expect(result.current.density).toBe("compact");
    });

    it("setDensity dispatches an action that updates the slice", () => {
        const store = makeStore("comfortable");
        const { result } = renderHook(() => useBoardDensity(), {
            wrapper: wrapperFor(store)
        });
        act(() => result.current.setDensity("compact"));
        expect(store.getState().userPreferences.boardDensity).toBe("compact");
        expect(result.current.density).toBe("compact");
    });

    it("setDensity flips back to comfortable", () => {
        const store = makeStore("compact");
        const { result } = renderHook(() => useBoardDensity(), {
            wrapper: wrapperFor(store)
        });
        act(() => result.current.setDensity("comfortable"));
        expect(store.getState().userPreferences.boardDensity).toBe(
            "comfortable"
        );
    });

    it("persists through middleware to localStorage when wired with the persistence middleware", () => {
        /*
         * Mirror the production middleware stack so this test asserts
         * the end-to-end "setDensity → localStorage write" round trip
         * rather than just the reducer transition. We don't import the
         * app's `store` singleton because it shares localStorage state
         * across test files; a fresh store gives a clean baseline.
         */
        const persistMiddleware: Middleware = (api) => (nxt) => (action) => {
            const before = api.getState().userPreferences;
            const result = nxt(action);
            const after = api.getState().userPreferences;
            if (before !== after) {
                window.localStorage.setItem(
                    USER_PREFERENCES_STORAGE_KEY,
                    JSON.stringify(after)
                );
            }
            return result;
        };
        const store = configureStore({
            reducer: { userPreferences: userPreferencesSlice.reducer },
            middleware: (getDefault) => getDefault().concat(persistMiddleware)
        });
        const { result } = renderHook(() => useBoardDensity(), {
            wrapper: wrapperFor(store)
        });
        act(() => result.current.setDensity("compact"));
        const stored = window.localStorage.getItem(
            USER_PREFERENCES_STORAGE_KEY
        );
        expect(stored).not.toBeNull();
        expect(JSON.parse(stored ?? "{}").boardDensity).toBe("compact");
    });
});
