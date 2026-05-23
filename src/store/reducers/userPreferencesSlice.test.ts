import { configureStore, type Middleware } from "@reduxjs/toolkit";

import {
    loadPersistedUserPreferences,
    persistUserPreferences,
    USER_PREFERENCES_STORAGE_KEY,
    userPreferencesActions,
    userPreferencesSlice
} from "./userPreferencesSlice";

const initialState = userPreferencesSlice.getInitialState();

describe("userPreferencesSlice", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it("seeds with comfortable density and an empty preset list", () => {
        expect(
            userPreferencesSlice.reducer(undefined, { type: "@@INIT" })
        ).toEqual({
            boardDensity: "comfortable",
            savedFilterPresets: []
        });
    });

    it("setBoardDensity flips between comfortable and compact", () => {
        const next = userPreferencesSlice.reducer(
            initialState,
            userPreferencesActions.setBoardDensity("compact")
        );
        expect(next.boardDensity).toBe("compact");
        const back = userPreferencesSlice.reducer(
            next,
            userPreferencesActions.setBoardDensity("comfortable")
        );
        expect(back.boardDensity).toBe("comfortable");
    });
});

describe("userPreferences persistence", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it("loadPersistedUserPreferences returns initial state when nothing is stored", () => {
        expect(loadPersistedUserPreferences()).toEqual({
            boardDensity: "comfortable",
            savedFilterPresets: []
        });
    });

    it("loadPersistedUserPreferences round-trips a persisted density", () => {
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify({
                boardDensity: "compact",
                savedFilterPresets: []
            })
        );
        const loaded = loadPersistedUserPreferences();
        expect(loaded.boardDensity).toBe("compact");
    });

    it("falls back to defaults when localStorage holds garbage", () => {
        window.localStorage.setItem(USER_PREFERENCES_STORAGE_KEY, "not-json");
        expect(loadPersistedUserPreferences()).toEqual({
            boardDensity: "comfortable",
            savedFilterPresets: []
        });
    });

    it("rejects unknown density values and falls back to comfortable", () => {
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify({
                boardDensity: "extra-large",
                savedFilterPresets: []
            })
        );
        expect(loadPersistedUserPreferences().boardDensity).toBe("comfortable");
    });

    it("persistUserPreferences writes the slice JSON under the canonical key", () => {
        persistUserPreferences({
            boardDensity: "compact",
            savedFilterPresets: []
        });
        const stored = window.localStorage.getItem(
            USER_PREFERENCES_STORAGE_KEY
        );
        expect(stored).not.toBeNull();
        const parsed = JSON.parse(stored ?? "{}");
        expect(parsed.boardDensity).toBe("compact");
    });

    it("persists through the store middleware after a dispatched action", () => {
        /*
         * Build a throwaway store wired with the same persistence
         * middleware shape the prod store uses. We don't import
         * `store` from `./index` because that singleton already
         * hydrated from whatever happened to be in localStorage at
         * module-eval time; a fresh store gives the test a clean
         * baseline.
         */
        const persistMiddleware: Middleware = (api) => (nxt) => (action) => {
            const before = api.getState().userPreferences;
            const result = nxt(action);
            const after = api.getState().userPreferences;
            if (before !== after) persistUserPreferences(after);
            return result;
        };
        const testStore = configureStore({
            reducer: { userPreferences: userPreferencesSlice.reducer },
            middleware: (getDefault) => getDefault().concat(persistMiddleware)
        });
        testStore.dispatch(userPreferencesActions.setBoardDensity("compact"));
        const stored = window.localStorage.getItem(
            USER_PREFERENCES_STORAGE_KEY
        );
        expect(stored).not.toBeNull();
        expect(JSON.parse(stored ?? "{}").boardDensity).toBe("compact");
    });
});
