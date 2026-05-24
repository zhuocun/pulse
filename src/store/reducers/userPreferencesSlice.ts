import { createSlice, PayloadAction } from "@reduxjs/toolkit";

/**
 * Phase 4.2 per-user preferences slice.
 *
 * The slice owns user-level preferences that persist across sessions via
 * a single `localStorage` key. Persistence is implemented as a thin sync
 * function (`persistUserPreferences`) invoked by the store middleware in
 * `src/store/index.ts` whenever this slice's state changes — Redux Toolkit
 * already serializes the slice for us, so the middleware path is a one-
 * liner per state shape. Hydration happens once at boot via
 * `loadPersistedUserPreferences` (same module) which reads the same key
 * and feeds the `preloadedState` of the store builder. If the key is
 * missing or unparseable we fall back to the slice's `initialState` so a
 * malformed localStorage entry never wedges the app.
 */
export type BoardDensity = "comfortable" | "compact";

/**
 * Phase 5 "Liquid Glass" Wave 2 T4 — user-facing glass intensity toggle.
 *
 * Four exposed options, three resolved targets:
 *
 *   - `"auto"`    — defer to the runtime ladder in `useGlassIntensity`
 *                    (OS `prefers-reduced-transparency` → `"solid"`,
 *                    `pointer: coarse` → `"solid"`, otherwise
 *                    `"regular"`). This is the default; users who never
 *                    touch the setting get the sensible per-device
 *                    behaviour with no further action.
 *   - `"clear"`   — most translucent. Highest show-through, modest blur.
 *   - `"regular"` — balanced default (the recipe the chrome ships today).
 *   - `"solid"`   — opaque opt-out. Blur disabled, glass surfaces collapse
 *                    to the page background. Critical for users with
 *                    motion / transparency sensitivity AND for Firefox
 *                    users (no `prefers-reduced-transparency` support
 *                    today).
 *
 * The slice stores the user's CHOICE (which may be `"auto"`); the hook
 * resolves `"auto"` to the effective intensity at render time. Storing
 * `"auto"` as a first-class enum option (vs. a null sentinel) keeps the
 * settings UI honest — the user can deliberately re-pick "Auto" after
 * trying a manual override.
 */
export type GlassIntensityPreference = "auto" | "clear" | "regular" | "solid";

/**
 * Phase 4.2 — defaults the project list applies when loaded with no
 * filter / sort params in the URL. `sort` is one of the five sort modes
 * surfaced in the list toolbar; `managerId` is the persisted manager
 * filter (or `null` to leave the filter unset); `favoritedOnly` toggles
 * the "favorited projects only" view (mirrors the user's `likedProjects`
 * list — projects the user has hearted on a card). The user explicitly
 * saves the current filter state as the default via a button in the
 * project search panel; ad-hoc filter changes do NOT mutate the saved
 * default.
 */
export type ProjectListSort =
    | "createdAt-desc"
    | "createdAt-asc"
    | "name-asc"
    | "name-desc"
    | "favorited-first";

export interface ProjectListDefaults {
    sort: ProjectListSort;
    managerId: string | null;
    favoritedOnly: boolean;
}

export const PROJECT_LIST_DEFAULTS_FALLBACK: ProjectListDefaults = {
    sort: "createdAt-desc",
    managerId: null,
    favoritedOnly: false
};

/**
 * The serialized shape of a single filter preset. `filterState` mirrors
 * the URL-state surface owned by `taskSearchPanel`: `taskName`,
 * `coordinatorId`, `type`. We deliberately store empty strings instead of
 * `null`/`undefined` because the `useUrl` writer round-trips `""` as the
 * "remove this key" signal, so a preset that wants to leave a filter
 * un-set stores it as `""` and the apply path can write the same value
 * back without translation.
 *
 * `boardId === null` marks a "global" preset visible on every board; a
 * specific id scopes it to that board only. The taskSearchPanel filters
 * presets by `(p.boardId === currentBoardId || p.boardId === null)` on
 * render so users see a single dropdown.
 */
export interface SavedFilterPresetState {
    id: string;
    name: string;
    boardId: string | null;
    filterState: {
        taskName: string;
        coordinatorId: string;
        type: string;
        /**
         * Active lens id at save time. Empty string when no lens was
         * selected. Stored as a plain string (not the `LensId` union)
         * so the slice stays decoupled from the lens-chip component
         * — the apply path narrows the value back through
         * `parseLensId` and silently drops anything that doesn't
         * map to a known lens.
         */
        lens: string;
    };
    createdAt: number;
}

export interface UserPreferencesState {
    boardDensity: BoardDensity;
    savedFilterPresets: SavedFilterPresetState[];
    /**
     * Saved project-list defaults. `null` means the user has not yet
     * clicked "Save as default" — first load falls through to
     * `PROJECT_LIST_DEFAULTS_FALLBACK` (`createdAt-desc`, no manager,
     * unfavorited). Reset-to-default also reads through to the fallback
     * when this is null so the button has a sensible no-op target.
     */
    projectListDefaults: ProjectListDefaults | null;
    /**
     * Phase 5 Liquid Glass Wave 2 T4 — the user's chosen glass intensity.
     * `"auto"` (the default) defers to the runtime ladder in
     * `useGlassIntensity`; the other values are explicit overrides that
     * always win. See `GlassIntensityPreference` for the resolution
     * contract.
     */
    glassIntensity: GlassIntensityPreference;
}

/**
 * Phase 4.2 — capped at 10 to keep the dropdown navigable and the
 * localStorage payload modest. The 11th save attempt triggers a
 * user-facing toast in `taskSearchPanel`; FIFO eviction happens here on
 * the reducer side so the slice is the single point of truth for the
 * cap.
 */
export const SAVED_FILTER_PRESET_LIMIT = 10;

export const USER_PREFERENCES_STORAGE_KEY = "pulse:userPreferences";

/**
 * Phase 4.2 — persisted-blob schema version. The serialized localStorage
 * payload wraps the slice state under a `{ version, state }` envelope so
 * future shape migrations can be detected and either upgraded (legacy
 * → current) or fall back to defaults (forward-incompat) instead of
 * silently dropping fields. See `loadPersistedUserPreferences` for the
 * three branches this drives (legacy missing-version, current, future).
 *
 * Bump policy: only when a field is REMOVED or its semantic meaning
 * CHANGES. Adding an optional field with a default value (e.g.
 * Phase 5 Wave 2 T4's `glassIntensity`) does NOT need a bump — the
 * `readSlice` guard falls through to the default for any field missing
 * from a legacy v1 blob, and a fresh write back persists the upgraded
 * shape on the next dispatch tick. The append-only contract keeps the
 * load path simple and the migration cost zero for the common case.
 */
export const USER_PREFERENCES_SCHEMA_VERSION = 1;

const initialState: UserPreferencesState = {
    boardDensity: "comfortable",
    savedFilterPresets: [],
    projectListDefaults: null,
    /*
     * Default to `"auto"` so brand-new installs get the per-device
     * ladder behaviour without nagging the user to pick something. The
     * ladder collapses to `"solid"` on coarse-pointer surfaces (mobile
     * GPU budget) and when the OS reports `prefers-reduced-transparency:
     * reduce`, leaving the regular Liquid Glass treatment for desktop
     * fine-pointer users on systems that haven't opted out.
     */
    glassIntensity: "auto"
};

const isBoardDensity = (value: unknown): value is BoardDensity =>
    value === "comfortable" || value === "compact";

const isGlassIntensityPreference = (
    value: unknown
): value is GlassIntensityPreference =>
    value === "auto" ||
    value === "clear" ||
    value === "regular" ||
    value === "solid";

const isProjectListSort = (value: unknown): value is ProjectListSort =>
    value === "createdAt-desc" ||
    value === "createdAt-asc" ||
    value === "name-asc" ||
    value === "name-desc" ||
    value === "favorited-first";

const isProjectListDefaults = (
    value: unknown
): value is ProjectListDefaults => {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Record<string, unknown>;
    if (!isProjectListSort(candidate.sort)) return false;
    if (
        candidate.managerId !== null &&
        typeof candidate.managerId !== "string"
    ) {
        return false;
    }
    if (typeof candidate.favoritedOnly !== "boolean") return false;
    return true;
};

const isStringField = (value: unknown): value is string =>
    typeof value === "string";

const isSavedPreset = (value: unknown): value is SavedFilterPresetState => {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Record<string, unknown>;
    if (!isStringField(candidate.id) || !isStringField(candidate.name)) {
        return false;
    }
    if (candidate.boardId !== null && !isStringField(candidate.boardId)) {
        return false;
    }
    if (typeof candidate.createdAt !== "number") return false;
    if (!candidate.filterState || typeof candidate.filterState !== "object") {
        return false;
    }
    const fs = candidate.filterState as Record<string, unknown>;
    if (
        !isStringField(fs.taskName) ||
        !isStringField(fs.coordinatorId) ||
        !isStringField(fs.type)
    ) {
        return false;
    }
    // `lens` was added after the initial 4.2 ship; legacy persisted
    // presets are missing the field and would otherwise fail the
    // guard. Coerce undefined to `""` on the way in so the schema
    // stays append-only.
    if (fs.lens !== undefined && !isStringField(fs.lens)) return false;
    if (fs.lens === undefined) fs.lens = "";
    return true;
};

/**
 * Reads the slice fields out of a candidate `Record<string, unknown>`
 * (either the persisted v1 `state` sub-object, or — for legacy
 * unversioned blobs — the persisted top-level object) and returns a
 * cleaned-up state value. Each field is type-guarded individually so a
 * single malformed entry never poisons the rest of the slice. Used by
 * both the `v1` branch and the legacy-migration branch of
 * `loadPersistedUserPreferences`.
 */
const readSlice = (
    candidate: Record<string, unknown>
): UserPreferencesState => {
    const presets = Array.isArray(candidate.savedFilterPresets)
        ? candidate.savedFilterPresets.filter(isSavedPreset)
        : [];
    return {
        boardDensity: isBoardDensity(candidate.boardDensity)
            ? candidate.boardDensity
            : initialState.boardDensity,
        savedFilterPresets: presets.slice(-SAVED_FILTER_PRESET_LIMIT),
        projectListDefaults: isProjectListDefaults(
            candidate.projectListDefaults
        )
            ? candidate.projectListDefaults
            : null,
        /*
         * `glassIntensity` was added in Phase 5 Wave 2 T4. Legacy v1
         * blobs persisted before this field shipped do not carry it;
         * the guard's `undefined` fall-through fills in the default
         * (`"auto"`) so we don't need a schema version bump. This is
         * the standard append-only pattern the slice already uses for
         * `filterState.lens` (see `isSavedPreset` above).
         */
        glassIntensity: isGlassIntensityPreference(candidate.glassIntensity)
            ? candidate.glassIntensity
            : initialState.glassIntensity
    };
};

/**
 * Writes the slice's current state back to `localStorage` wrapped in the
 * current schema envelope (`{ version, state }`). Wrapped in try/catch
 * so a `QuotaExceededError` (Safari private browsing, locked down
 * environment) never throws into the dispatch loop.
 */
export const persistUserPreferences = (state: UserPreferencesState): void => {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify({
                version: USER_PREFERENCES_SCHEMA_VERSION,
                state
            })
        );
    } catch {
        // Persistence is best-effort; the in-memory slice is the source
        // of truth for the current session even when localStorage is
        // unavailable.
    }
};

/**
 * Reads the persisted preferences from `localStorage` and returns a
 * cleaned-up state value. Unknown / malformed payloads fall back to the
 * slice's `initialState` so a corrupted entry can never break the boot
 * path. Called by the store builder in `src/store/index.ts` as the
 * `preloadedState` seed; also safe to call from tests that need to
 * stage a specific persisted shape.
 *
 * Schema-version handling (Phase 4.2 — userPreferences v1 envelope):
 *
 * - `version === USER_PREFERENCES_SCHEMA_VERSION` (currently 1) → read
 *   the wrapped `state` sub-object as-is.
 * - `version === undefined` → legacy pre-versioning blob. Best-effort
 *   read of the top-level object (the previous shape WAS the state
 *   shape), then write back wrapped in the current envelope to migrate
 *   forward on the next boot.
 * - `version > USER_PREFERENCES_SCHEMA_VERSION` → assume the user has
 *   downgraded the app after writing a future-shape blob. Fall back to
 *   `initialState` so the boot path stays clean, and log a console
 *   warning so the rollback is at least visible in the devtools.
 * - `version < USER_PREFERENCES_SCHEMA_VERSION` → a hand-edited or
 *   third-party-written blob carrying an explicit past-version sentinel
 *   (e.g. `version: 0`). Treat as unsupported — fall back to
 *   `initialState` + console warning. This is distinct from the
 *   `undefined` branch above: legacy blobs have no `version` sibling at
 *   all, so they take the migration path on faith. A blob that DOES
 *   carry a numeric version below the current schema is by definition a
 *   shape we don't know how to read.
 */
export const loadPersistedUserPreferences = (): UserPreferencesState => {
    if (typeof window === "undefined") return initialState;
    try {
        const raw = window.localStorage.getItem(USER_PREFERENCES_STORAGE_KEY);
        if (!raw) return initialState;
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object") return initialState;
        const top = parsed as Record<string, unknown>;
        const version = top.version;
        if (typeof version === "number") {
            if (version === USER_PREFERENCES_SCHEMA_VERSION) {
                const wrappedState =
                    top.state && typeof top.state === "object"
                        ? (top.state as Record<string, unknown>)
                        : null;
                return wrappedState ? readSlice(wrappedState) : initialState;
            }
            if (version > USER_PREFERENCES_SCHEMA_VERSION) {
                // Forward-incompat: a newer app version wrote a shape
                // we don't know how to read. Drop to defaults rather
                // than silently coerce — the user opted into the
                // downgrade, so blanking their preferences is the
                // safest behavior. Surface a console warning so the
                // rollback is debuggable.
                // eslint-disable-next-line no-console
                console.warn(
                    `[userPreferences] Persisted blob has unsupported version ${version} (max known: ${USER_PREFERENCES_SCHEMA_VERSION}); falling back to defaults.`
                );
                return initialState;
            }
            if (version < USER_PREFERENCES_SCHEMA_VERSION) {
                // Past-version numeric (e.g. someone hand-edited the
                // blob to `version: 0`). Distinct from the legacy
                // unversioned branch — those blobs HAVE no `version`
                // sibling, so they take the v1 envelope contract on
                // faith and read top-level fields. A blob that *does*
                // carry an explicit `version` below the current
                // schema would otherwise fall through to the legacy
                // migration path, which reads top-level fields that
                // aren't there and silently drops to defaults without
                // a warning. Mirror the future-version branch's
                // shape so the rollback is at least visible in the
                // devtools.
                // eslint-disable-next-line no-console
                console.warn(
                    `[userPreferences] Persisted blob has unsupported version ${version} (current schema: ${USER_PREFERENCES_SCHEMA_VERSION}); falling back to defaults.`
                );
                return initialState;
            }
        }
        // Legacy unversioned blob: the prior shape WAS the state shape.
        // Migrate forward by reading + persisting under the current
        // envelope so the next boot takes the fast v1 path.
        const migrated = readSlice(top);
        persistUserPreferences(migrated);
        return migrated;
    } catch {
        return initialState;
    }
};

export const userPreferencesSlice = createSlice({
    name: "userPreferences",
    initialState,
    reducers: {
        setBoardDensity(state, action: PayloadAction<BoardDensity>) {
            state.boardDensity = action.payload;
        },
        /**
         * Append a preset. If the list would exceed the cap, the OLDEST
         * preset is dropped to make room (FIFO). The reducer returns the
         * new list as-is; the caller (the save UI) detects "we hit the
         * cap" by comparing list length to the cap BEFORE dispatching
         * so a toast can fire on the 11th attempt.
         */
        addSavedFilterPreset(
            state,
            action: PayloadAction<SavedFilterPresetState>
        ) {
            state.savedFilterPresets.push(action.payload);
            if (state.savedFilterPresets.length > SAVED_FILTER_PRESET_LIMIT) {
                state.savedFilterPresets.splice(
                    0,
                    state.savedFilterPresets.length - SAVED_FILTER_PRESET_LIMIT
                );
            }
        },
        removeSavedFilterPreset(state, action: PayloadAction<string>) {
            const idx = state.savedFilterPresets.findIndex(
                (p) => p.id === action.payload
            );
            if (idx >= 0) state.savedFilterPresets.splice(idx, 1);
        },
        /**
         * Persists the user's chosen project-list defaults. Pass `null`
         * to clear the saved default (the list falls back to
         * `PROJECT_LIST_DEFAULTS_FALLBACK` — `createdAt-desc`, no
         * manager filter, unfavorited).
         */
        setProjectListDefaults(
            state,
            action: PayloadAction<ProjectListDefaults | null>
        ) {
            state.projectListDefaults = action.payload;
        },
        /**
         * Phase 5 Wave 2 T4 — sets the user's glass intensity choice.
         * `"auto"` re-enables the runtime ladder (defer to OS / device
         * cues); `"clear" | "regular" | "solid"` are explicit overrides
         * that always win. `useGlassIntensity` writes the resolved value
         * to `html[data-glass-intensity="…"]` on the next layout effect,
         * which flips every glass surface in one shot.
         */
        setGlassIntensity(
            state,
            action: PayloadAction<GlassIntensityPreference>
        ) {
            state.glassIntensity = action.payload;
        }
    }
});

export const userPreferencesActions = userPreferencesSlice.actions;
