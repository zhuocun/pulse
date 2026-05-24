import { useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";

import type { ReduxDispatch, RootState } from "../../store";
import {
    PROJECT_LIST_DEFAULTS_FALLBACK,
    type ProjectListDefaults,
    userPreferencesActions
} from "../../store/reducers/userPreferencesSlice";

/**
 * Phase 4.2 — read/write the user's preferred project-list defaults.
 *
 * The hook returns:
 * - `defaults` — the user's saved defaults, or the
 *   `PROJECT_LIST_DEFAULTS_FALLBACK` (`createdAt-desc`, no manager,
 *   unfavorited) when no preference has been saved.
 * - `savedDefaults` — `null` when the user has not clicked "Save as
 *   default" yet, the saved object otherwise. Exposed separately from
 *   `defaults` so the UI can hide / disable "Reset to default" when
 *   nothing is saved.
 * - `saveDefaults` — persists a snapshot of the current filter / sort
 *   state to the slice (which mirrors to localStorage via the
 *   middleware).
 * - `clearDefaults` — removes the saved defaults (the list falls back
 *   to the fallback constant on the next first-load).
 *
 * Saving is always an explicit user action — the project page does NOT
 * auto-persist filter changes. Ad-hoc filter use should never silently
 * mutate the saved default (the user can lean on URL sharing for
 * one-off bookmarks).
 */
const useProjectListDefaults = (): {
    defaults: ProjectListDefaults;
    savedDefaults: ProjectListDefaults | null;
    saveDefaults: (next: ProjectListDefaults) => void;
    clearDefaults: () => void;
} => {
    const dispatch = useDispatch<ReduxDispatch>();
    const savedDefaults = useSelector<RootState, ProjectListDefaults | null>(
        (state) => state.userPreferences.projectListDefaults
    );
    const saveDefaults = useCallback(
        (next: ProjectListDefaults) => {
            dispatch(userPreferencesActions.setProjectListDefaults(next));
        },
        [dispatch]
    );
    const clearDefaults = useCallback(() => {
        dispatch(userPreferencesActions.setProjectListDefaults(null));
    }, [dispatch]);
    return {
        defaults: savedDefaults ?? PROJECT_LIST_DEFAULTS_FALLBACK,
        savedDefaults,
        saveDefaults,
        clearDefaults
    };
};

export default useProjectListDefaults;
