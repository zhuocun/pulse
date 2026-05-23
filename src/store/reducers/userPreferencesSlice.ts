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
 *
 * The first wave (this commit) wires the density toggle. Saved filter
 * presets land in a follow-up commit that reuses the same persistence
 * scaffolding via the `savedFilterPresets` slot below.
 */
export type BoardDensity = "comfortable" | "compact";

/**
 * The serialized shape of a single filter preset. `filterState` mirrors
 * the URL-state surface owned by `taskSearchPanel`. The follow-up Part B
 * commit wires the reducers; the field is declared up-front so the
 * persistence shape stays stable from day one.
 */
export interface SavedFilterPresetState {
    id: string;
    name: string;
    boardId: string | null;
    filterState: {
        taskName: string;
        coordinatorId: string;
        type: string;
    };
    createdAt: number;
}

export interface UserPreferencesState {
    boardDensity: BoardDensity;
    savedFilterPresets: SavedFilterPresetState[];
}

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
    return (
        isStringField(fs.taskName) &&
        isStringField(fs.coordinatorId) &&
        isStringField(fs.type)
    );
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
            savedFilterPresets: presets
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
        }
    }
});

export const userPreferencesActions = userPreferencesSlice.actions;
