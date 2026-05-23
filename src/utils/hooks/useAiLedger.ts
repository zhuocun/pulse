import { message } from "antd";
import { useCallback } from "react";
import { useStore } from "react-redux";

import { microcopy, microcopyString } from "../../constants/microcopy";
import type { RootState } from "../../store";
import {
    aiLedgerActions,
    type AiLedgerEntryState,
    type AiLedgerSurface
} from "../../store/reducers/aiLedgerSlice";

import { useReduxDispatch, useReduxSelector } from "./useRedux";

/**
 * AI Activity Ledger (Phase 4 A8) — session-only log of AI mutations
 * with one-click revert.
 *
 * The hook returns a `record()` helper for AI surfaces to log their
 * accept-flow side effects, a `revert(id)` helper for the activity-log
 * UI, a `remove(id)` helper for synchronized surface-level undos, plus
 * the live `entries` list and a `clear()` reset. Redux owns the
 * serializable shape; this module owns a process-scope `Map` for the
 * `undo` callbacks that can't be serialized.
 *
 *   - `record({ description, surface, undo? })` appends a new entry with
 *     an auto-generated id + `Date.now()` timestamp AND returns the new
 *     entry's id so callers can later call `revert(id)` or `remove(id)`
 *     to keep the surface's local undo state in sync with the ledger.
 *     When `undo` is supplied the callback is stashed in `undoCallbacks`
 *     and the Redux entry is flagged `undoable: true` so the UI can
 *     render a Revert button. Without `undo` the entry still logs but
 *     the button is hidden (`mutation-proposal` surface uses this for
 *     non-reversible mutations).
 *
 *   - `revert(id)` looks the callback up in `undoCallbacks`, awaits it,
 *     and on success dispatches `removeAiLedgerEntry(id)`. A throw is
 *     surfaced as a toast (`microcopy.aiActivityLog.undoFailedToast`)
 *     and the entry is left in place so the user can retry or dismiss.
 *
 *   - `remove(id)` drops the entry from Redux + the callback Map without
 *     invoking the undo. Surfaces use this when they've already performed
 *     the undo via a local affordance (in-card Undo, toast Undo) so the
 *     ledger entry doesn't get out of sync. This keeps the "activity log
 *     is the authoritative session record; any successful undo path
 *     removes the entry" contract — see issues #2 / #3 in the A8 review.
 *
 *   - `clear()` empties the Redux list AND drops every entry in the
 *     callback Map so the next `record()` cycle starts with an empty
 *     correlation set. The reducer also evicts the oldest entry when the
 *     50-entry cap is breached — we mirror that eviction here so the Map
 *     doesn't pin GC for the dropped closure.
 *
 *   - `entries` is the snapshot used by the activity-log component. It
 *     comes from Redux so reload-survived entries still render; the UI
 *     consults `undoCallbacks` (via `isRevertable(id)`) to gate the
 *     Revert button on whether the closure is still alive in this
 *     process.
 */

interface RecordableEntry {
    description: string;
    surface: AiLedgerSurface;
    undo?: () => void | Promise<void>;
}

export type LedgerEntry = {
    id: string;
    timestamp: number;
    description: string;
    surface: AiLedgerSurface;
    /** `undefined` after a reload (closure was lost) or when the surface intentionally logged without a revert. */
    undo?: () => void | Promise<void>;
};

interface UseAiLedger {
    entries: LedgerEntry[];
    /**
     * Records a new ledger entry. Returns the entry's auto-generated id
     * so callers can keep their surface's local undo state synchronized
     * (via `revert(id)` or `remove(id)`).
     */
    record: (entry: RecordableEntry) => string;
    revert: (id: string) => Promise<void>;
    /**
     * Drops the entry from Redux + the callback Map WITHOUT invoking the
     * undo. Surfaces use this after running their own local undo (toast,
     * in-card button) to keep the ledger in sync with the live state.
     */
    remove: (id: string) => void;
    clear: () => void;
    /** Returns `true` when a live undo closure is in the callback Map. */
    isRevertable: (id: string) => boolean;
}

/*
 * Process-scope callback registry. Keyed by entry id (the same id the
 * reducer stores in the serializable entry shape) so:
 *
 *   - Selecting `entries` from Redux returns the rendering snapshot.
 *   - For each entry, the UI calls `isRevertable(entry.id)` which
 *     touches this Map (NOT Redux state) to decide whether to enable
 *     the Revert button. After a reload Redux still has the entries but
 *     the Map is empty, so every revert button is correctly hidden.
 *
 *   - On revert success / `clear()` / max-cap eviction the matching key
 *     is `.delete()`d so the closure can be garbage-collected alongside
 *     the entry that referenced it.
 */
const undoCallbacks = new Map<string, () => void | Promise<void>>();

const generateLedgerEntryId = (): string => {
    if (
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
    )
        return `ledger-${crypto.randomUUID()}`;
    return `ledger-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
};

/**
 * Test-only helper: drops every cached undo closure so a clean per-test
 * shell starts with the same empty Map shape it would have after a real
 * page reload. Not exported from the package index — call sites in
 * production code go through `clear()` instead, which also empties
 * Redux on the same tick.
 */
// eslint-disable-next-line no-underscore-dangle
export const __resetAiLedgerUndoCallbacksForTests = (): void => {
    undoCallbacks.clear();
};

const useAiLedger = (): UseAiLedger => {
    const dispatch = useReduxDispatch();
    const store = useStore<RootState>();
    const stateEntries = useReduxSelector((s) => s.aiLedger.entries);

    /*
     * Map the Redux snapshot through the live callback registry. We
     * intentionally re-derive `entries` on every render (not memoize
     * against `stateEntries`) so a `record()` call that adds a callback
     * AFTER the Redux dispatch — the only safe order, since the Redux
     * dispatch is what produces the id we key on — is visible on the
     * next render without a stale `undefined` undo prop.
     */
    const entries: LedgerEntry[] = stateEntries.map((entry) => {
        const undo = undoCallbacks.get(entry.id);
        return undo
            ? {
                  id: entry.id,
                  timestamp: entry.timestamp,
                  description: entry.description,
                  surface: entry.surface,
                  undo
              }
            : {
                  id: entry.id,
                  timestamp: entry.timestamp,
                  description: entry.description,
                  surface: entry.surface
              };
    });

    const record = useCallback(
        (entry: RecordableEntry): string => {
            const id = generateLedgerEntryId();
            const reduxEntry: AiLedgerEntryState = {
                id,
                timestamp: Date.now(),
                description: entry.description,
                surface: entry.surface,
                undoable: typeof entry.undo === "function"
            };
            if (entry.undo) undoCallbacks.set(id, entry.undo);
            dispatch(aiLedgerActions.recordAiLedgerEntry(reduxEntry));
            /*
             * Eviction parity: when the reducer drops the oldest entry to
             * honour the 50-cap, we must drop the matching closure(s)
             * too. We use `store.getState()` rather than the selector
             * snapshot because multiple `record()` calls can fire in the
             * same React render tick (e.g. a surface that logs two
             * entries inside one click handler) — the selector value is
             * frozen at render time, while `getState()` always reflects
             * the post-dispatch truth.
             *
             * The reducer evicts from the start, so the live entries[]
             * holds the survivors in order. We unconditionally diff the
             * live id set against the Map keys and drop any callback
             * whose id is no longer present. This is O(n) in the live
             * entries plus the Map size, both bounded by 50.
             *
             * Issue #1 (A8 review): the previous double-conditional
             * skipped the sweep when the just-recorded entry had no undo
             * callback — Map.size never grew so neither branch fired, and
             * the evicted oldest entry's closure leaked. The
             * unconditional pass costs the same and closes the leak.
             */
            const liveIds = new Set(
                store.getState().aiLedger.entries.map((live) => live.id)
            );
            undoCallbacks.forEach((_, key) => {
                if (!liveIds.has(key)) undoCallbacks.delete(key);
            });
            return id;
        },
        [dispatch, store]
    );

    const revert = useCallback(
        async (id: string) => {
            /*
             * Atomic claim: capture the undo reference AND remove the
             * Map slot in the same tick before awaiting anything. This
             * makes `revert(id)` re-entrant — a second concurrent call
             * with the same id sees `undefined` and bails out instead
             * of double-invoking the closure. Issue #6 in the A8 review.
             *
             * If the undo throws we restore the Map slot below so the
             * Revert button comes back; the Redux entry is never removed
             * on the failure path.
             */
            const undo = undoCallbacks.get(id);
            if (!undo) {
                /*
                 * No live closure (post-reload state, already-reverted,
                 * or duplicate concurrent call). The Revert button should
                 * already have been disabled by `isRevertable`, but a
                 * rapid click or test can still land here — issue #9 in
                 * the A8 review asked for observability so the silent
                 * no-op is debuggable in production telemetry.
                 */
                // eslint-disable-next-line no-console
                console.warn(
                    `[aiLedger] revert(${id}) called with no live closure ` +
                        `(post-reload, already reverted, or duplicate click)`
                );
                return;
            }
            undoCallbacks.delete(id);
            try {
                await undo();
                dispatch(aiLedgerActions.removeAiLedgerEntry(id));
            } catch (error) {
                /*
                 * Surface the failure to the user but leave the entry
                 * in place so they can retry. The description string
                 * accepts a `{error}` token because the prior step's
                 * error is the most useful diagnostic for "why didn't my
                 * undo land?" — a network 5xx, a 409 stale-version
                 * reject, etc. Restore the closure so the next click of
                 * Revert can try again.
                 */
                undoCallbacks.set(id, undo);
                const reason =
                    error instanceof Error ? error.message : String(error);
                message.error(
                    microcopyString(
                        microcopy.aiActivityLog.undoFailedToast
                    ).replace("{error}", reason),
                    3
                );
            }
        },
        [dispatch]
    );

    /*
     * Synchronized-removal path for surface-level undos. When a toast or
     * in-card Undo button has already performed the reversal, the
     * surface calls `remove(id)` so the ledger entry is dropped without
     * the closure firing a second time. See contract decision in the A8
     * review (issues #2 / #3): "the activity log is the authoritative
     * session record; any successful undo path removes the entry."
     */
    const remove = useCallback(
        (id: string) => {
            undoCallbacks.delete(id);
            dispatch(aiLedgerActions.removeAiLedgerEntry(id));
        },
        [dispatch]
    );

    const clear = useCallback(() => {
        undoCallbacks.clear();
        dispatch(aiLedgerActions.clearAiLedger());
    }, [dispatch]);

    const isRevertable = useCallback((id: string) => undoCallbacks.has(id), []);

    return { entries, record, revert, remove, clear, isRevertable };
};

export default useAiLedger;
