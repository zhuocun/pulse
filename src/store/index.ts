import { configureStore, type Middleware } from "@reduxjs/toolkit";

import { aiLedgerSlice } from "./reducers/aiLedgerSlice";
import { overlaysSlice } from "./reducers/overlaysSlice";
import { projectModalSlice } from "./reducers/projectModalSlice";
import {
    loadPersistedUserPreferences,
    persistUserPreferences,
    userPreferencesSlice,
    type UserPreferencesState
} from "./reducers/userPreferencesSlice";

export const rootReducer = {
    projectModal: projectModalSlice.reducer,
    overlays: overlaysSlice.reducer,
    aiLedger: aiLedgerSlice.reducer,
    userPreferences: userPreferencesSlice.reducer
};

/**
 * Phase 4.2 — middleware that mirrors the `userPreferences` slice back
 * into `localStorage` after every action. We compare by reference on the
 * sub-tree because Redux Toolkit's Immer reducers guarantee a new
 * reference only when the slice's state actually changed, so we never
 * write on no-op dispatches. Persistence failures (Safari private
 * browsing, quota exceeded) are swallowed in `persistUserPreferences`
 * itself — the in-memory slice stays authoritative for the session.
 */
const userPreferencesPersistence: Middleware<
    Record<string, never>,
    { userPreferences: UserPreferencesState }
> = (storeApi) => (next) => (action) => {
    const before = storeApi.getState().userPreferences;
    const result = next(action);
    const after = storeApi.getState().userPreferences;
    if (before !== after) persistUserPreferences(after);
    return result;
};

export const store = configureStore({
    reducer: rootReducer,
    preloadedState: {
        userPreferences: loadPersistedUserPreferences()
    },
    middleware: (getDefault) => getDefault().concat(userPreferencesPersistence)
});

export type ReduxDispatch = typeof store.dispatch;
export type RootState = ReturnType<typeof store.getState>;
