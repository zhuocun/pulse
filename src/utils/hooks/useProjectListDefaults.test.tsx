import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";

import {
    PROJECT_LIST_DEFAULTS_FALLBACK,
    type ProjectListDefaults,
    userPreferencesSlice
} from "../../store/reducers/userPreferencesSlice";

import useProjectListDefaults from "./useProjectListDefaults";

const makeStore = (saved: ProjectListDefaults | null = null) =>
    configureStore({
        reducer: { userPreferences: userPreferencesSlice.reducer },
        preloadedState: {
            userPreferences: {
                boardDensity: "comfortable" as const,
                savedFilterPresets: [],
                projectListDefaults: saved
            }
        }
    });

const wrapperFor = (store: ReturnType<typeof makeStore>) => {
    const Wrapper = ({ children }: { children: ReactNode }) => (
        <Provider store={store}>{children}</Provider>
    );
    return Wrapper;
};

describe("useProjectListDefaults", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it("falls back to PROJECT_LIST_DEFAULTS_FALLBACK when no default is saved", () => {
        const { result } = renderHook(() => useProjectListDefaults(), {
            wrapper: wrapperFor(makeStore(null))
        });
        expect(result.current.defaults).toEqual(PROJECT_LIST_DEFAULTS_FALLBACK);
        // `savedDefaults` stays null so callers can decide whether to
        // render a "Reset to default" affordance.
        expect(result.current.savedDefaults).toBeNull();
    });

    it("returns the saved default when one is persisted", () => {
        const saved: ProjectListDefaults = {
            sort: "favorited-first",
            managerId: "member-1",
            favoritedOnly: true
        };
        const { result } = renderHook(() => useProjectListDefaults(), {
            wrapper: wrapperFor(makeStore(saved))
        });
        expect(result.current.defaults).toEqual(saved);
        expect(result.current.savedDefaults).toEqual(saved);
    });

    it("saveDefaults persists the payload to the slice", () => {
        const store = makeStore(null);
        const { result } = renderHook(() => useProjectListDefaults(), {
            wrapper: wrapperFor(store)
        });
        act(() => {
            result.current.saveDefaults({
                sort: "name-desc",
                managerId: "member-2",
                favoritedOnly: false
            });
        });
        expect(store.getState().userPreferences.projectListDefaults).toEqual({
            sort: "name-desc",
            managerId: "member-2",
            favoritedOnly: false
        });
    });

    it("clearDefaults resets the slice back to null and reads through to the fallback", () => {
        const store = makeStore({
            sort: "name-desc",
            managerId: "member-2",
            favoritedOnly: true
        });
        const { result } = renderHook(() => useProjectListDefaults(), {
            wrapper: wrapperFor(store)
        });
        act(() => {
            result.current.clearDefaults();
        });
        expect(store.getState().userPreferences.projectListDefaults).toBeNull();
        // `defaults` should now read through to the fallback so the
        // first-load apply path keeps working post-clear.
        expect(result.current.savedDefaults).toBeNull();
    });
});
