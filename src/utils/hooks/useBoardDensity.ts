import { useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";

import type { ReduxDispatch, RootState } from "../../store";
import {
    type BoardDensity,
    userPreferencesActions
} from "../../store/reducers/userPreferencesSlice";

/**
 * Phase 4.2 — read/write the user's preferred board density.
 *
 * The hook is a thin wrapper around the Redux `userPreferences` slice;
 * the slice itself is hydrated from `localStorage` on app boot (see
 * `src/store/index.ts`) so the value the hook surfaces on first render
 * already reflects the user's last choice. Updates round-trip through
 * the slice's persistence middleware so a `setDensity("compact")` write
 * lands in `localStorage` on the same dispatch tick.
 */
const useBoardDensity = (): {
    density: BoardDensity;
    setDensity: (next: BoardDensity) => void;
} => {
    const dispatch = useDispatch<ReduxDispatch>();
    const density = useSelector<RootState, BoardDensity>(
        (state) => state.userPreferences.boardDensity
    );
    const setDensity = useCallback(
        (next: BoardDensity) => {
            dispatch(userPreferencesActions.setBoardDensity(next));
        },
        [dispatch]
    );
    return { density, setDensity };
};

export default useBoardDensity;
