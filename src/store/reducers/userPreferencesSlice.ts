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

const initialState: UserPreferencesState = {
    boardDensity: "comfortable",
    savedFilterPresets: []
};

const isBoardDensity = (value: unknown): value is BoardDensity =>
    value === "comfortable" || value === "compact";

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
 * Reads the persisted preferences from `localStorage` and returns a
 * cleaned-up state value. Unknown / malformed payloads fall back to the
 * slice's `initialState` so a corrupted entry can never break the boot
 * path. Called by the store builder in `src/store/index.ts` as the
 * `preloadedState` seed; also safe to call from tests that need to
 * stage a specific persisted shape.
 */
export const loadPersistedUserPreferences = (): UserPreferencesState => {
    if (typeof window === "undefined") return initialState;
    try {
        const raw = window.localStorage.getItem(USER_PREFERENCES_STORAGE_KEY);
        if (!raw) return initialState;
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object") return initialState;
        const candidate = parsed as Record<string, unknown>;
        const presets = Array.isArray(candidate.savedFilterPresets)
            ? candidate.savedFilterPresets.filter(isSavedPreset)
            : [];
        return {
            boardDensity: isBoardDensity(candidate.boardDensity)
                ? candidate.boardDensity
                : initialState.boardDensity,
            savedFilterPresets: presets.slice(-SAVED_FILTER_PRESET_LIMIT)
        };
    } catch {
        return initialState;
    }
};

/**
 * Writes the slice's current state back to `localStorage`. Wrapped in
 * try/catch so a `QuotaExceededError` (Safari private browsing, locked
 * down environment) never throws into the dispatch loop.
 */
export const persistUserPreferences = (state: UserPreferencesState): void => {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(
            USER_PREFERENCES_STORAGE_KEY,
            JSON.stringify(state)
        );
    } catch {
        // Persistence is best-effort; the in-memory slice is the source
        // of truth for the current session even when localStorage is
        // unavailable.
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
        }
    }
});

export const userPreferencesActions = userPreferencesSlice.actions;
