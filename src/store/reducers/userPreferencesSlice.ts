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
 */
export const USER_PREFERENCES_SCHEMA_VERSION = 1;

const initialState: UserPreferencesState = {
    boardDensity: "comfortable",
    savedFilterPresets: [],
    projectListDefaults: null
};

const isBoardDensity = (value: unknown): value is BoardDensity =>
    value === "comfortable" || value === "compact";

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
            : null
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
            // version < current schema — would belong here once we
            // grow a v2. For now there's only v1, so any numeric
            // version below 1 falls through to the legacy migration
            // branch below.
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
        }
    }
});

export const userPreferencesActions = userPreferencesSlice.actions;
