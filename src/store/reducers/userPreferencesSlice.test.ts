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
            projectListDefaults: null,
            // Phase 5 Wave 2 T4 — default to "auto" so brand-new
            // installs get the per-device ladder (no user-visible UI
            // nag for "pick a glass setting"). Phase 6 Wave 1 — the
            // coarse-pointer branch of the auto ladder now resolves
            // to "regular" (was "solid"); new installs persist
            // glassIntensityVersion at the current sentinel so the
            // load-path migration is a no-op for them.
            glassIntensity: "auto",
            glassIntensityVersion: 1,
            // Runtime colour-theme switch — orange is the default so
            // existing users see no change.
            colorTheme: "orange"
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
            projectListDefaults: null,
            glassIntensity: "auto",
            // Phase 6 Wave 1 — brand-new installs get the current
            // migration sentinel so the load-path migration is a
            // no-op for them (they receive the post-flip default).
            glassIntensityVersion: 1,
            colorTheme: "orange"
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
            projectListDefaults: null,
            glassIntensity: "auto",
            glassIntensityVersion: 1,
            colorTheme: "orange"
        });
    });

    it("falls back to defaults (with a warning) on a future/unknown schema version", () => {
        // The slice only ever WRITES version 1, so a higher version can
        // only arrive from a future build (then a downgrade) or a foreign
        // writer — never from normal app use. Treat it as forward-incompat:
        // blank to defaults rather than misread an unknown shape, and warn
        // so the rollback is debuggable. This is by design, and is the path
        // behind the audit-env "unsupported version 4" console noise — a
        // fresh real-user session never reaches it.
        const warnSpy = jest
            .spyOn(console, "warn")
            .mockImplementation(() => {});
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify({
                version: 4,
                state: { boardDensity: "compact", savedFilterPresets: [] }
            })
        );

        expect(loadPersistedUserPreferences()).toEqual(initialState);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("unsupported version 4")
        );

        warnSpy.mockRestore();
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

    /*
     * Phase 5 Wave 2 T4 — `glassIntensity` round-trips through the v1
     * envelope as an additive field. A legacy v1 blob with no
     * `glassIntensity` sibling falls back to `"auto"`, and an explicit
     * stored value (e.g. `"clear"`) survives the load path.
     */
    it("loads an explicit glassIntensity choice from a v1 envelope", () => {
        const stored = {
            version: 1,
            state: {
                boardDensity: "comfortable",
                savedFilterPresets: [],
                projectListDefaults: null,
                glassIntensity: "clear"
            }
        };
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify(stored)
        );
        expect(loadPersistedUserPreferences().glassIntensity).toBe("clear");
    });

    it("migrates a legacy v1 blob with no glassIntensity field to solid (Phase 6 Wave 1)", () => {
        // A v1 envelope persisted BEFORE Wave 2 T4 shipped — the
        // append-only guard fills `glassIntensity` with the default
        // ("auto"), but the Phase 6 Wave 1 migration then rewrites
        // "auto" to "solid" because the blob carries no
        // `glassIntensityVersion` sentinel. The user is treated as a
        // pre-Phase-6 install with no explicit preference.
        const stored = {
            version: 1,
            state: {
                boardDensity: "compact",
                savedFilterPresets: [],
                projectListDefaults: null
            }
        };
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify(stored)
        );
        const loaded = loadPersistedUserPreferences();
        expect(loaded.glassIntensity).toBe("solid");
        expect(loaded.glassIntensityVersion).toBe(1);
        // Existing fields survive — the additive field doesn't poison
        // the legacy read.
        expect(loaded.boardDensity).toBe("compact");
    });

    it("rejects an unknown glassIntensity value and falls back to auto (then migrates to solid)", () => {
        // Type-guard rejection: the bad value reads as `undefined`,
        // falls through to the default `"auto"`. The Phase 6 Wave 1
        // migration then rewrites that `"auto"` to `"solid"` because
        // the blob doesn't carry a `glassIntensityVersion` sentinel.
        const stored = {
            version: 1,
            state: {
                boardDensity: "comfortable",
                savedFilterPresets: [],
                projectListDefaults: null,
                glassIntensity: "translucent-lizard"
            }
        };
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify(stored)
        );
        const loaded = loadPersistedUserPreferences();
        expect(loaded.glassIntensity).toBe("solid");
        expect(loaded.glassIntensityVersion).toBe(1);
    });

    it("setGlassIntensity flips through every option", () => {
        let state = initialState;
        for (const next of ["clear", "regular", "solid", "auto"] as const) {
            state = userPreferencesSlice.reducer(
                state,
                userPreferencesActions.setGlassIntensity(next)
            );
            expect(state.glassIntensity).toBe(next);
        }
    });

    /*
     * Runtime colour-theme switch — append-only field (no schema bump),
     * mirroring how glassIntensity was added. A blob with no `colorTheme`
     * sibling falls through to orange; an explicit shipped palette name
     * survives; an unknown name is rejected back to orange.
     */
    it("setColorTheme flips through every shipped palette", () => {
        let state = initialState;
        for (const next of ["sky", "emerald", "orange"] as const) {
            state = userPreferencesSlice.reducer(
                state,
                userPreferencesActions.setColorTheme(next)
            );
            expect(state.colorTheme).toBe(next);
        }
    });

    it("loads an explicit colorTheme choice from a v1 envelope", () => {
        const stored = {
            version: 1,
            state: {
                boardDensity: "comfortable",
                savedFilterPresets: [],
                projectListDefaults: null,
                glassIntensity: "auto",
                glassIntensityVersion: 1,
                colorTheme: "sky"
            }
        };
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify(stored)
        );
        expect(loadPersistedUserPreferences().colorTheme).toBe("sky");
    });

    it("falls back to orange for a legacy blob with no colorTheme field", () => {
        // A v1 envelope persisted before the colour-theme picker shipped
        // carries no `colorTheme` sibling — the append-only guard fills
        // in the orange default so existing users keep the historical
        // brand.
        const stored = {
            version: 1,
            state: {
                boardDensity: "comfortable",
                savedFilterPresets: [],
                projectListDefaults: null,
                glassIntensity: "auto",
                glassIntensityVersion: 1
            }
        };
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify(stored)
        );
        expect(loadPersistedUserPreferences().colorTheme).toBe("orange");
    });

    it("rejects an unknown colorTheme value and falls back to orange", () => {
        const stored = {
            version: 1,
            state: {
                boardDensity: "comfortable",
                savedFilterPresets: [],
                projectListDefaults: null,
                glassIntensity: "auto",
                glassIntensityVersion: 1,
                colorTheme: "ultraviolet"
            }
        };
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify(stored)
        );
        expect(loadPersistedUserPreferences().colorTheme).toBe("orange");
    });

    it("persists a glassIntensity choice through the store middleware", () => {
        /*
         * Wires the same persistence middleware shape the prod store
         * uses so the round-trip "dispatch → localStorage" path is
         * exercised end-to-end (mirrors the boardDensity persistence
         * test above).
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
        testStore.dispatch(userPreferencesActions.setGlassIntensity("solid"));
        const stored = window.localStorage.getItem(
            USER_PREFERENCES_STORAGE_KEY
        );
        expect(stored).not.toBeNull();
        expect(JSON.parse(stored ?? "{}").state.glassIntensity).toBe("solid");
    });

    it("persistUserPreferences writes the wrapped {version, state} envelope", () => {
        persistUserPreferences({
            boardDensity: "compact",
            savedFilterPresets: [makePreset("p1")],
            projectListDefaults: null,
            glassIntensity: "auto",
            glassIntensityVersion: 1,
            colorTheme: "orange"
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
        expect(parsed.state.glassIntensity).toBe("auto");
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
 * Phase 6 Wave 1 — one-shot `glassIntensity` runtime-default migration.
 * The Phase 5 resolver collapsed `glassIntensity: "auto"` to `"solid"` on
 * coarse-pointer surfaces; Phase 6 collapses it to `"regular"`. To avoid
 * surprising existing mobile users by suddenly enabling Liquid Glass on
 * their phones, the load path rewrites their stored `"auto"` to `"solid"`
 * once — gated by `glassIntensityVersion` so the rewrite only ever runs
 * once per user. Explicit picks (`"clear"`, `"regular"`, `"solid"`) are
 * preserved unchanged.
 */
describe("userPreferences glassIntensityVersion migration", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it("migrates a pre-Phase-6 v1 blob with glassIntensity=auto to solid (and bumps version to 1)", () => {
        // The canonical existing-user migration case. A v1 envelope
        // persisted before Phase 6 Wave 1 carried no
        // `glassIntensityVersion` sibling and a default-of-auto
        // `glassIntensity`. The Phase 6 load path detects the missing
        // sentinel and rewrites to "solid" so the user keeps the
        // legacy mobile experience after the resolver default flip.
        const stored = {
            version: 1,
            state: {
                boardDensity: "comfortable",
                savedFilterPresets: [],
                projectListDefaults: null,
                glassIntensity: "auto"
                // glassIntensityVersion deliberately absent
            }
        };
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify(stored)
        );
        const loaded = loadPersistedUserPreferences();
        expect(loaded.glassIntensity).toBe("solid");
        expect(loaded.glassIntensityVersion).toBe(1);
    });

    it("persists the migrated shape back so the next load is a no-op", () => {
        // The migration writes the post-migration state back to
        // localStorage so the next boot reads the value directly
        // (no repeated rewriting of the stored bytes). This is the
        // idempotency contract — calling loadPersistedUserPreferences
        // twice yields the same result on both calls.
        const stored = {
            version: 1,
            state: {
                boardDensity: "comfortable",
                savedFilterPresets: [],
                projectListDefaults: null,
                glassIntensity: "auto"
            }
        };
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify(stored)
        );
        loadPersistedUserPreferences();
        // Inspect the persisted bytes — the post-migration state
        // should now be present so the next boot skips the
        // migration branch entirely.
        const after = JSON.parse(
            window.localStorage.getItem(USER_PREFERENCES_STORAGE_KEY) ?? "{}"
        );
        expect(after.state.glassIntensity).toBe("solid");
        expect(after.state.glassIntensityVersion).toBe(1);
        // Second load: idempotent — same result, no further rewrite.
        const second = loadPersistedUserPreferences();
        expect(second.glassIntensity).toBe("solid");
        expect(second.glassIntensityVersion).toBe(1);
    });

    it("preserves an explicit regular pick across the migration (no auto→solid rewrite)", () => {
        // The migration only rewrites `"auto"` users — anyone who
        // explicitly picked `"regular"` (or "clear" / "solid")
        // already opted into a specific intensity. The version
        // sentinel is still bumped so the next load skips the
        // check.
        const stored = {
            version: 1,
            state: {
                boardDensity: "comfortable",
                savedFilterPresets: [],
                projectListDefaults: null,
                glassIntensity: "regular"
                // glassIntensityVersion deliberately absent
            }
        };
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify(stored)
        );
        const loaded = loadPersistedUserPreferences();
        expect(loaded.glassIntensity).toBe("regular");
        expect(loaded.glassIntensityVersion).toBe(1);
    });

    it("preserves an explicit clear pick across the migration", () => {
        const stored = {
            version: 1,
            state: {
                boardDensity: "comfortable",
                savedFilterPresets: [],
                projectListDefaults: null,
                glassIntensity: "clear"
            }
        };
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify(stored)
        );
        const loaded = loadPersistedUserPreferences();
        expect(loaded.glassIntensity).toBe("clear");
        expect(loaded.glassIntensityVersion).toBe(1);
    });

    it("preserves an explicit solid pick across the migration", () => {
        const stored = {
            version: 1,
            state: {
                boardDensity: "comfortable",
                savedFilterPresets: [],
                projectListDefaults: null,
                glassIntensity: "solid"
            }
        };
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify(stored)
        );
        const loaded = loadPersistedUserPreferences();
        expect(loaded.glassIntensity).toBe("solid");
        expect(loaded.glassIntensityVersion).toBe(1);
    });

    it("does not re-migrate when glassIntensityVersion is already at the current value", () => {
        // A user who already ran the Phase 6 migration once and
        // subsequently re-picked "auto" (deliberately, from the
        // settings UI) should be left alone — their "auto" is the
        // post-flip "auto" which resolves to Regular on mobile, and
        // that's the experience they asked for.
        const stored = {
            version: 1,
            state: {
                boardDensity: "comfortable",
                savedFilterPresets: [],
                projectListDefaults: null,
                glassIntensity: "auto",
                glassIntensityVersion: 1
            }
        };
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify(stored)
        );
        const loaded = loadPersistedUserPreferences();
        expect(loaded.glassIntensity).toBe("auto");
        expect(loaded.glassIntensityVersion).toBe(1);
        // The stored bytes should be unchanged (no rewrite — the
        // migration branch was skipped).
        const after = JSON.parse(
            window.localStorage.getItem(USER_PREFERENCES_STORAGE_KEY) ?? "{}"
        );
        expect(after.state.glassIntensity).toBe("auto");
        expect(after.state.glassIntensityVersion).toBe(1);
    });

    it("new install (no persisted state) gets the post-flip default + current version", () => {
        // No persisted state at all — the initialState seed kicks
        // in. Brand-new users get the Phase 6 default ("auto" which
        // resolves to Regular on mobile) and the current version
        // sentinel so the load path migration is a no-op on the
        // next boot.
        const loaded = loadPersistedUserPreferences();
        expect(loaded.glassIntensity).toBe("auto");
        expect(loaded.glassIntensityVersion).toBe(1);
    });

    it("migrates a legacy UNVERSIONED blob with glassIntensity=auto to solid", () => {
        // The legacy unversioned path also runs through the
        // glassIntensity migration — a user who never updated past
        // the pre-v1-envelope shape still gets the auto→solid
        // rewrite so they keep their mobile Solid.
        const legacy = {
            // No `version` sibling — legacy pre-envelope shape.
            boardDensity: "compact",
            savedFilterPresets: [],
            glassIntensity: "auto"
        };
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify(legacy)
        );
        const loaded = loadPersistedUserPreferences();
        expect(loaded.glassIntensity).toBe("solid");
        expect(loaded.glassIntensityVersion).toBe(1);
        // Legacy migration also persists the wrapped envelope —
        // verify the bytes carry both the v1 envelope AND the
        // post-migration glassIntensity state.
        const after = JSON.parse(
            window.localStorage.getItem(USER_PREFERENCES_STORAGE_KEY) ?? "{}"
        );
        expect(after.version).toBe(1);
        expect(after.state.glassIntensity).toBe("solid");
        expect(after.state.glassIntensityVersion).toBe(1);
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
                projectListDefaults: null,
                glassIntensity: "auto",
                glassIntensityVersion: 1,
                colorTheme: "orange"
            });
            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy.mock.calls[0][0]).toMatch(/unsupported version 99/);
        } finally {
            warnSpy.mockRestore();
        }
    });

    it("falls back to defaults and warns when the blob carries a past-version numeric sentinel", () => {
        // Phase 4.2 review follow-up — a blob with an explicit numeric
        // `version` below the current schema (e.g. someone hand-edited
        // to `version: 0`) used to silently drop through to the legacy
        // unversioned branch. That branch reads top-level fields that
        // aren't there on a v1-shaped envelope and returns defaults
        // with NO warning, masking the corruption. The load path now
        // mirrors the future-version branch and warns on this case
        // too.
        const past = {
            version: 0,
            state: {
                boardDensity: "compact",
                savedFilterPresets: [],
                projectListDefaults: null
            }
        };
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify(past)
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
                projectListDefaults: null,
                glassIntensity: "auto",
                glassIntensityVersion: 1,
                colorTheme: "orange"
            });
            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy.mock.calls[0][0]).toMatch(/unsupported version 0/);
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
