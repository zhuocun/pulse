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
    filterState: { taskName: "", coordinatorId: "", type: "", lens: "" },
    createdAt: 1_700_000_000_000 + Number(id.replace(/[^0-9]/g, "") || "0"),
    ...overrides
});

describe("userPreferencesSlice", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it("seeds with comfortable density, an empty preset list, and no saved project-list defaults", () => {
        expect(
            userPreferencesSlice.reducer(undefined, { type: "@@INIT" })
        ).toEqual({
            boardDensity: "comfortable",
            savedFilterPresets: [],
            projectListDefaults: null
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
            savedFilterPresets: [],
            projectListDefaults: null
        });
    });

    it("loadPersistedUserPreferences round-trips a persisted shape (legacy unversioned)", () => {
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
            savedFilterPresets: [],
            projectListDefaults: null
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

    it("persistUserPreferences writes the wrapped {version, state} envelope", () => {
        persistUserPreferences({
            boardDensity: "compact",
            savedFilterPresets: [makePreset("p1")],
            projectListDefaults: null
        });
        const stored = window.localStorage.getItem(
            USER_PREFERENCES_STORAGE_KEY
        );
        expect(stored).not.toBeNull();
        const parsed = JSON.parse(stored ?? "{}");
        // The new envelope wraps the slice under `state` with the
        // schema `version` sibling. The legacy top-level shape would
        // have exposed `boardDensity` directly off `parsed`.
        expect(parsed.version).toBe(1);
        expect(parsed.state.boardDensity).toBe("compact");
        expect(parsed.state.savedFilterPresets[0].id).toBe("p1");
        expect(parsed.state.projectListDefaults).toBeNull();
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
        // Wrapped envelope — `state` carries the slice fields.
        expect(JSON.parse(stored ?? "{}").state.boardDensity).toBe("compact");
    });
});

/**
 * Phase 4.2 — schema versioning. The persisted blob wraps the slice
 * state under a `{ version, state }` envelope so the load path can
 * detect three migration branches: a current-version blob (`v1`), a
 * legacy unversioned blob (migrate forward), and a future-version blob
 * (forward-incompat — drop to defaults + warn).
 */
describe("userPreferences schema versioning", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it("loads a v1 envelope round-trip without mutation", () => {
        const stored = {
            version: 1,
            state: {
                boardDensity: "compact",
                savedFilterPresets: [makePreset("p1", { boardId: "board-1" })],
                projectListDefaults: {
                    sort: "createdAt-asc",
                    managerId: "member-1",
                    favoritedOnly: true
                }
            }
        };
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify(stored)
        );
        const loaded = loadPersistedUserPreferences();
        expect(loaded.boardDensity).toBe("compact");
        expect(loaded.savedFilterPresets[0].id).toBe("p1");
        expect(loaded.projectListDefaults).toEqual({
            sort: "createdAt-asc",
            managerId: "member-1",
            favoritedOnly: true
        });
        // v1 reads must not rewrite the blob (the bytes the user wrote
        // stay verbatim — the round-trip test above expects this).
        const after = JSON.parse(
            window.localStorage.getItem(USER_PREFERENCES_STORAGE_KEY) ?? "{}"
        );
        expect(after.version).toBe(1);
    });

    it("migrates a legacy unversioned blob forward and writes back as v1", () => {
        // Legacy shape: the slice fields lived at the top level, no
        // `version` sibling. This was the on-disk shape pre-versioning.
        const legacy = {
            boardDensity: "compact",
            savedFilterPresets: [makePreset("legacy-1")]
        };
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify(legacy)
        );
        const loaded = loadPersistedUserPreferences();
        // Best-effort read of the legacy shape — boardDensity and the
        // preset list survive; the new projectListDefaults field gets
        // its null default.
        expect(loaded.boardDensity).toBe("compact");
        expect(loaded.savedFilterPresets[0].id).toBe("legacy-1");
        expect(loaded.projectListDefaults).toBeNull();
        // The load path writes the migrated shape back so the next boot
        // takes the fast v1 read path.
        const after = JSON.parse(
            window.localStorage.getItem(USER_PREFERENCES_STORAGE_KEY) ?? "{}"
        );
        expect(after.version).toBe(1);
        expect(after.state.boardDensity).toBe("compact");
        expect(after.state.savedFilterPresets[0].id).toBe("legacy-1");
    });

    it("falls back to defaults and warns when the blob is a future version", () => {
        const future = {
            version: 99,
            state: {
                boardDensity: "compact",
                savedFilterPresets: [],
                projectListDefaults: null,
                // Hypothetical future field — proves the load path
                // doesn't try to munge unknown shapes.
                somethingFromV99: { whoKnows: true }
            }
        };
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify(future)
        );
        const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {
            // silence the expected warning so the test runner doesn't
            // surface it as noise.
        });
        try {
            const loaded = loadPersistedUserPreferences();
            expect(loaded).toEqual({
                boardDensity: "comfortable",
                savedFilterPresets: [],
                projectListDefaults: null
            });
            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy.mock.calls[0][0]).toMatch(/unsupported version 99/);
        } finally {
            warnSpy.mockRestore();
        }
    });

    it("setProjectListDefaults stores the payload and reset to null clears it", () => {
        const next = userPreferencesSlice.reducer(
            initialState,
            userPreferencesActions.setProjectListDefaults({
                sort: "favorited-first",
                managerId: "member-9",
                favoritedOnly: true
            })
        );
        expect(next.projectListDefaults).toEqual({
            sort: "favorited-first",
            managerId: "member-9",
            favoritedOnly: true
        });
        const cleared = userPreferencesSlice.reducer(
            next,
            userPreferencesActions.setProjectListDefaults(null)
        );
        expect(cleared.projectListDefaults).toBeNull();
    });

    it("drops a malformed projectListDefaults field without dropping the rest of the slice", () => {
        const stored = {
            version: 1,
            state: {
                boardDensity: "compact",
                savedFilterPresets: [],
                // Missing favoritedOnly + bad sort → guard rejects the
                // whole object and falls back to null.
                projectListDefaults: { sort: "nope" }
            }
        };
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify(stored)
        );
        const loaded = loadPersistedUserPreferences();
        expect(loaded.boardDensity).toBe("compact");
        expect(loaded.projectListDefaults).toBeNull();
    });
});
