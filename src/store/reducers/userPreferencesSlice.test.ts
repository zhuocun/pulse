import { configureStore, type Middleware } from "@reduxjs/toolkit";

import {
    loadPersistedUserPreferences,
    persistUserPreferences,
    SAVED_FILTER_PRESET_LIMIT,
    SavedFilterPresetState,
    USER_PREFERENCES_STORAGE_KEY,
    userPreferencesActions,
    userPreferencesSlice
} from "./userPreferencesSlice";

const initialState = userPreferencesSlice.getInitialState();

const makePreset = (
    id: string,
    overrides?: Partial<SavedFilterPresetState>
): SavedFilterPresetState => ({
    id,
    name: `Preset ${id}`,
    boardId: null,
    filterState: { taskName: "", coordinatorId: "", type: "" },
    createdAt: 1_700_000_000_000 + Number(id.replace(/[^0-9]/g, "") || "0"),
    ...overrides
});

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

    it("addSavedFilterPreset appends in order", () => {
        let state = initialState;
        ["p1", "p2"].forEach((id) => {
            state = userPreferencesSlice.reducer(
                state,
                userPreferencesActions.addSavedFilterPreset(makePreset(id))
            );
        });
        expect(state.savedFilterPresets.map((p) => p.id)).toEqual(["p1", "p2"]);
    });

    it("evicts the oldest preset (FIFO) when adding past the cap", () => {
        let state = initialState;
        for (let i = 0; i < SAVED_FILTER_PRESET_LIMIT + 3; i++) {
            state = userPreferencesSlice.reducer(
                state,
                userPreferencesActions.addSavedFilterPreset(makePreset(`p${i}`))
            );
        }
        expect(state.savedFilterPresets).toHaveLength(
            SAVED_FILTER_PRESET_LIMIT
        );
        // The first 3 entries (oldest) should have been evicted.
        expect(state.savedFilterPresets[0].id).toBe("p3");
        expect(
            state.savedFilterPresets[state.savedFilterPresets.length - 1].id
        ).toBe(`p${SAVED_FILTER_PRESET_LIMIT + 2}`);
    });

    it("removeSavedFilterPreset drops the matching id and leaves the rest", () => {
        let state = initialState;
        ["a", "b", "c"].forEach((id) => {
            state = userPreferencesSlice.reducer(
                state,
                userPreferencesActions.addSavedFilterPreset(makePreset(id))
            );
        });
        const next = userPreferencesSlice.reducer(
            state,
            userPreferencesActions.removeSavedFilterPreset("b")
        );
        expect(next.savedFilterPresets.map((p) => p.id)).toEqual(["a", "c"]);
    });

    it("removeSavedFilterPreset no-ops for an unknown id", () => {
        let state = initialState;
        state = userPreferencesSlice.reducer(
            state,
            userPreferencesActions.addSavedFilterPreset(makePreset("a"))
        );
        const next = userPreferencesSlice.reducer(
            state,
            userPreferencesActions.removeSavedFilterPreset("nope")
        );
        expect(next.savedFilterPresets.map((p) => p.id)).toEqual(["a"]);
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

    it("loadPersistedUserPreferences round-trips a persisted shape", () => {
        const stored = {
            boardDensity: "compact",
            savedFilterPresets: [makePreset("p1", { boardId: "board-1" })]
        };
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify(stored)
        );
        const loaded = loadPersistedUserPreferences();
        expect(loaded.boardDensity).toBe("compact");
        expect(loaded.savedFilterPresets).toHaveLength(1);
        expect(loaded.savedFilterPresets[0].id).toBe("p1");
        expect(loaded.savedFilterPresets[0].boardId).toBe("board-1");
    });

    it("falls back to defaults when localStorage holds garbage", () => {
        window.localStorage.setItem(USER_PREFERENCES_STORAGE_KEY, "not-json");
        expect(loadPersistedUserPreferences()).toEqual({
            boardDensity: "comfortable",
            savedFilterPresets: []
        });
    });

    it("drops malformed preset entries without dropping valid ones", () => {
        const stored = {
            boardDensity: "compact",
            savedFilterPresets: [
                makePreset("good"),
                { id: "bad-no-fields" },
                makePreset("good-2")
            ]
        };
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify(stored)
        );
        const loaded = loadPersistedUserPreferences();
        expect(loaded.savedFilterPresets.map((p) => p.id)).toEqual([
            "good",
            "good-2"
        ]);
    });

    it("rejects unknown density values and falls back to comfortable", () => {
        const stored = {
            boardDensity: "extra-large",
            savedFilterPresets: []
        };
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify(stored)
        );
        expect(loadPersistedUserPreferences().boardDensity).toBe("comfortable");
    });

    it("persistUserPreferences writes the slice JSON under the canonical key", () => {
        persistUserPreferences({
            boardDensity: "compact",
            savedFilterPresets: [makePreset("p1")]
        });
        const stored = window.localStorage.getItem(
            USER_PREFERENCES_STORAGE_KEY
        );
        expect(stored).not.toBeNull();
        const parsed = JSON.parse(stored ?? "{}");
        expect(parsed.boardDensity).toBe("compact");
        expect(parsed.savedFilterPresets[0].id).toBe("p1");
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
