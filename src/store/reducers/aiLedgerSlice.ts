import { createSlice, PayloadAction } from "@reduxjs/toolkit";

/**
 * Session-only log of AI mutations (Phase 4 A8 — Activity Ledger).
 *
 * Each entry is the *serializable* shape of an applied AI change: the
 * description shown in the list, the surface that originated it, a
 * timestamp, and an `undoable` flag. The actual `undo` callback can't
 * live in Redux (it's a closure over the previous task state, not JSON)
 * — `useAiLedger` keeps the callbacks in a module-scope Map keyed by
 * entry id and the component hides the Revert button whenever the
 * callback Map has no entry for a given id (the post-reload state where
 * Redux survives but the closures don't).
 *
 * Bounded memory: the slice caps `entries` at `MAX_ENTRIES`, dropping
 * the oldest entries when a new record arrives at the cap. The companion
 * action `pruneAiLedgerEntries` returns the evicted ids so the hook can
 * also free the matching callback Map slots on the same tick.
 *
 * Lifecycle:
 *   - `recordAiLedgerEntry({ entry })` — append; eviction handled by the
 *     reducer when `entries.length > MAX_ENTRIES`.
 *   - `removeAiLedgerEntry(id)` — used by `revert(id)` after the undo
 *     callback resolved successfully; failure leaves the entry in place.
 *   - `clearAiLedger()` — drops every entry.
 */
export type AiLedgerSurface =
    | "task-assist"
    | "task-draft"
    | "mutation-proposal"
    | (string & {});

export interface AiLedgerEntryState {
    id: string;
    timestamp: number;
    description: string;
    surface: AiLedgerSurface;
    /**
     * `true` when an undo closure is expected to live in the runtime
     * callback Map. Survives Redux serialization; the component cross-
     * checks against the Map (which is empty after a page reload) so a
     * stale `undoable: true` doesn't render a broken Revert button.
     */
    undoable: boolean;
}

export interface AiLedgerState {
    entries: AiLedgerEntryState[];
}

export const AI_LEDGER_MAX_ENTRIES = 50;

const initialState: AiLedgerState = { entries: [] };

export const aiLedgerSlice = createSlice({
    name: "aiLedger",
    initialState,
    reducers: {
        recordAiLedgerEntry(state, action: PayloadAction<AiLedgerEntryState>) {
            state.entries.push(action.payload);
            if (state.entries.length > AI_LEDGER_MAX_ENTRIES) {
                state.entries.splice(
                    0,
                    state.entries.length - AI_LEDGER_MAX_ENTRIES
                );
            }
        },
        removeAiLedgerEntry(state, action: PayloadAction<string>) {
            const idx = state.entries.findIndex(
                (entry) => entry.id === action.payload
            );
            if (idx >= 0) state.entries.splice(idx, 1);
        },
        clearAiLedger(state) {
            state.entries = [];
        }
    }
});

export const aiLedgerActions = aiLedgerSlice.actions;
