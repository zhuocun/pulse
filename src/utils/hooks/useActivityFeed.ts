import { useCallback, useEffect } from "react";
import { useStore } from "react-redux";

import { microcopy, microcopyString } from "../../constants/microcopy";
import type { RootState } from "../../store";
import {
    activityFeedActions,
    type ActivityEventAction,
    type ActivityEventKind,
    type ActivityEventState
} from "../../store/reducers/activityFeedSlice";

import useAiLedger from "./useAiLedger";
import useAppMessage from "./useAppMessage";
import { useReduxDispatch, useReduxSelector } from "./useRedux";

/**
 * Phase 4.3 — Activity / notifications drawer hook.
 *
 * Broader peer of `useAiLedger`: where the ledger is AI-specific, this
 * hook tracks ALL optimistic-update events surfaced through the app
 * (task / column / project create-update-delete) plus AI mutations
 * forwarded in via a one-way bridge from `aiLedgerSlice`. The bell icon
 * in the header reads `events.filter(e => !e.isRead).length` for its
 * badge count; the activity drawer renders the grouped list.
 *
 * Architecture mirrors `useAiLedger`:
 *   - Redux owns the SERIALIZABLE shape (`activityFeedSlice`). 50-entry
 *     cap with FIFO eviction; the reducer drops the oldest entry when
 *     a record arrives at the cap.
 *   - Local undo closures live in a module-scope `Map` keyed by entry id
 *     so they survive cross-component access but get dropped on reload
 *     alongside the React tree.
 *   - AI rows flow in ONE WAY: the hook subscribes to `aiLedgerSlice`
 *     entries and forwards any new id into `activityFeedSlice` with
 *     `kind: "ai"`, storing the original `aiLedgerId` on the entry. The
 *     drawer's Undo button on an AI row routes through
 *     `useAiLedger().revert(aiLedgerId)` — NOT through this hook's local
 *     undo Map — so a single Revert path is the authoritative side
 *     effect and an "Undo" press on the drawer can never run a second
 *     revert. New AI entries always originate at `useAiLedger`. The
 *     reverse direction is a passive observation: when a ledger entry
 *     disappears (the user reverted from `aiActivityLog`), the bridge
 *     removes the matching feed row so the drawer doesn't render a
 *     stale phantom. See `useAiLedgerBridge` for details.
 */

interface RecordableEvent {
    kind: ActivityEventKind;
    action: ActivityEventAction;
    summary: string;
    sourceSurface?: string;
    /**
     * Optional reversal closure. When supplied, the drawer renders an
     * Undo button while the closure is still alive in the runtime Map
     * AND the entry is within the per-component undo window (10 s by
     * default — see `activityFeedDrawer/index.tsx`). The undo invocation
     * removes the entry from Redux on success.
     */
    undo?: () => void | Promise<void>;
    /**
     * For AI-bridge forwarding only. Carries the original ledger id so
     * the drawer can dispatch the AI-side revert through `useAiLedger`
     * without owning a duplicate closure.
     */
    aiLedgerId?: string;
}

export type ActivityEvent = {
    id: string;
    timestamp: number;
    kind: ActivityEventKind;
    action: ActivityEventAction;
    summary: string;
    sourceSurface?: string;
    aiLedgerId?: string;
    isRead: boolean;
    /** Present only when a live closure exists in the runtime Map. */
    undo?: () => void | Promise<void>;
};

interface UseActivityFeed {
    events: ActivityEvent[];
    /**
     * Records a new event. Returns the new entry's auto-generated id so
     * call sites can later target `markRead(id)` / `remove(id)` directly.
     */
    record: (event: RecordableEvent) => string;
    /** Invokes the undo closure (when alive) and removes the entry on success. */
    undo: (id: string) => Promise<void>;
    /** Returns `true` when a live undo closure exists for the entry id. */
    isUndoable: (id: string) => boolean;
    markRead: (id: string) => void;
    markAllRead: () => void;
    remove: (id: string) => void;
    clear: () => void;
    /** Count of `!isRead` events — used directly by the bell badge. */
    unreadCount: number;
}

/*
 * Process-scope callback registry (mirrors `useAiLedger`'s pattern). Keyed
 * by entry id so the drawer can call `isUndoable(id)` against this Map
 * rather than Redux state to decide whether to render an Undo button.
 * After a page reload the Redux entries survive but this Map is empty, so
 * every Undo button is correctly hidden.
 */
const undoCallbacks = new Map<string, () => void | Promise<void>>();

const generateActivityEventId = (): string => {
    if (
        typeof crypto !== "undefined" &&
        typeof crypto.randomUUID === "function"
    )
        return `activity-${crypto.randomUUID()}`;
    return `activity-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
};

/**
 * Test-only helper: drops every cached undo closure so a clean per-test
 * shell starts with the same empty Map shape it would have after a real
 * reload. Not exported from a package entry point — production code goes
 * through `clear()` which also empties Redux on the same tick.
 */
// eslint-disable-next-line no-underscore-dangle
export const __resetActivityFeedUndoCallbacksForTests = (): void => {
    undoCallbacks.clear();
};

/**
 * AI <-> activity-feed bridge.
 *
 * Subscribes to `aiLedgerSlice.entries` and synchronises the feed in
 * both directions:
 *
 *   • Forward: any new ledger entry is forwarded into
 *     `activityFeedSlice` with `kind: "ai"`. The forwarded entry's
 *     `aiLedgerId` carries the original id so the drawer's Undo button
 *     on an AI row dispatches through `useAiLedger().revert(aiLedgerId)`
 *     — new AI events always originate at `useAiLedger`, never here.
 *
 *   • Reverse: when an AI feed row's backing ledger entry has been
 *     removed (the user clicked Revert inside `aiActivityLog`, which
 *     removes the ledger entry directly), the bridge drops the now-
 *     stale feed row via `removeActivityEvent`. Without this sweep the
 *     drawer would render a row that visually presents as valid but
 *     whose Undo is hidden because the closure was already consumed —
 *     a confusing dead state. We chose hard remove over a soft
 *     "(reverted)" suffix because the activity feed is presentation
 *     and the user has already seen the Revert confirmation toast
 *     inside aiActivityLog; preserving a phantom row adds no audit
 *     value the ledger doesn't already own.
 *
 * Idempotency: the effect compares the bridged ledger-id set against
 * the already-forwarded set (derived from the current activity-feed
 * events) so a slice-only render (e.g. another reducer dispatched in
 * the same tick) doesn't re-forward already-recorded rows. The reverse
 * sweep is symmetric: it only acts on rows whose ledger id is missing
 * from the live set.
 */
const useAiLedgerBridge = (): void => {
    const dispatch = useReduxDispatch();
    const store = useStore<RootState>();
    const ledgerEntries = useReduxSelector((s) => s.aiLedger.entries);

    useEffect(() => {
        const liveLedgerIds = new Set(
            ledgerEntries.map((ledgerEntry) => ledgerEntry.id)
        );
        const feedAiRows = store
            .getState()
            .activityFeed.events.filter((event) => event.kind === "ai");
        const feedAiIds = new Set(
            feedAiRows
                .map((event) => event.aiLedgerId)
                .filter((id): id is string => typeof id === "string")
        );
        // Forward direction: any ledger entry not yet in the feed → push
        // a new kind:"ai" row.
        for (const ledgerEntry of ledgerEntries) {
            if (feedAiIds.has(ledgerEntry.id)) continue;
            const reduxEntry: ActivityEventState = {
                id: generateActivityEventId(),
                timestamp: ledgerEntry.timestamp,
                kind: "ai",
                action: "update",
                summary: ledgerEntry.description,
                sourceSurface: ledgerEntry.surface,
                undoable: ledgerEntry.undoable,
                aiLedgerId: ledgerEntry.id,
                isRead: false
            };
            dispatch(activityFeedActions.recordActivityEvent(reduxEntry));
        }
        // Reverse direction: any kind:"ai" feed row whose backing
        // ledger entry has disappeared → remove the stale row. This
        // path fires when the user clicks Revert inside `aiActivityLog`
        // (which removes the ledger entry directly) and prevents the
        // activity drawer from rendering a ghost row that visually
        // looks valid but whose Undo button is hidden because the
        // closure is gone. Picked option A (hard remove) over option B
        // (soft "(reverted)" suffix) per the reviewer's note: the
        // activity feed is presentation; ledger Revert is the
        // authoritative side effect and the user has already seen the
        // confirmation toast inside aiActivityLog.
        for (const feedRow of feedAiRows) {
            if (!feedRow.aiLedgerId) continue;
            if (liveLedgerIds.has(feedRow.aiLedgerId)) continue;
            dispatch(activityFeedActions.removeActivityEvent(feedRow.id));
        }
    }, [dispatch, ledgerEntries, store]);
};

const useActivityFeed = (): UseActivityFeed => {
    // AntD v6: the static `message` import warns it can't read dynamic
    // theme. `useAppMessage()` returns a theme-aware instance (with a
    // static fallback for tests that render without `<App>`).
    const message = useAppMessage();
    const dispatch = useReduxDispatch();
    const store = useStore<RootState>();
    const stateEvents = useReduxSelector((s) => s.activityFeed.events);

    // One-way bridge — runs as a side effect of the hook so any
    // consumer that pulls in `useActivityFeed` automatically gets the
    // forwarded AI rows. Effect dependencies inside the bridge guard
    // against re-forwarding.
    useAiLedgerBridge();

    /*
     * Re-derive the rendering snapshot from the Redux state PLUS the
     * live callback Map. Like `useAiLedger`, we don't memoize because a
     * `record()` that adds a closure AFTER the dispatch (the only safe
     * order, since the dispatch produces the id we key on) must show
     * the closure on the next render.
     */
    const events: ActivityEvent[] = stateEvents.map((event) => {
        const undo = undoCallbacks.get(event.id);
        const base: ActivityEvent = {
            id: event.id,
            timestamp: event.timestamp,
            kind: event.kind,
            action: event.action,
            summary: event.summary,
            sourceSurface: event.sourceSurface,
            aiLedgerId: event.aiLedgerId,
            isRead: event.isRead
        };
        if (undo) return { ...base, undo };
        return base;
    });

    const unreadCount = events.filter((event) => !event.isRead).length;

    const record = useCallback(
        (input: RecordableEvent): string => {
            const id = generateActivityEventId();
            const reduxEntry: ActivityEventState = {
                id,
                timestamp: Date.now(),
                kind: input.kind,
                action: input.action,
                summary: input.summary,
                sourceSurface: input.sourceSurface,
                undoable: typeof input.undo === "function",
                aiLedgerId: input.aiLedgerId,
                isRead: false
            };
            if (input.undo) undoCallbacks.set(id, input.undo);
            dispatch(activityFeedActions.recordActivityEvent(reduxEntry));
            /*
             * Eviction parity with `useAiLedger`: when the reducer drops
             * the oldest entry to honour the 50-cap, drop the matching
             * closure too. Reading from `store.getState()` (rather than
             * the selector snapshot) is required because multiple
             * `record()` calls can fire inside one React render tick and
             * the selector value is frozen at render time — `getState()`
             * always reflects the post-dispatch truth.
             */
            const liveIds = new Set(
                store.getState().activityFeed.events.map((live) => live.id)
            );
            undoCallbacks.forEach((_, key) => {
                if (!liveIds.has(key)) undoCallbacks.delete(key);
            });
            return id;
        },
        [dispatch, store]
    );

    const aiLedger = useAiLedger();

    const undo = useCallback(
        async (id: string) => {
            /*
             * Look the event up first; for AI rows we route through the
             * existing `useAiLedger().revert(aiLedgerId)` path rather
             * than a local closure, so the AI ledger remains the single
             * authoritative Revert surface — this is the "no double
             * revert" guarantee.
             */
            const event = store
                .getState()
                .activityFeed.events.find((entry) => entry.id === id);
            if (!event) return;
            if (event.kind === "ai" && event.aiLedgerId) {
                /*
                 * Only drop the activity-feed row when the AI revert
                 * actually succeeded — i.e. the ledger removed its own
                 * entry. The ledger's `revert()` is a no-op warn when
                 * no closure exists (post-reload, already reverted),
                 * and a throw-and-toast when the closure rejects; in
                 * both cases the ledger entry stays put and our row
                 * should mirror it.
                 */
                await aiLedger.revert(event.aiLedgerId);
                const ledgerStillHasIt = store
                    .getState()
                    .aiLedger.entries.some(
                        (entry) => entry.id === event.aiLedgerId
                    );
                if (!ledgerStillHasIt) {
                    dispatch(activityFeedActions.removeActivityEvent(id));
                }
                return;
            }
            /*
             * Local-closure path (atomic claim mirrors `useAiLedger`):
             * read + delete from the Map in the same tick before
             * awaiting, so a second concurrent call gets `undefined`
             * and bails out instead of double-invoking.
             */
            const closure = undoCallbacks.get(id);
            if (!closure) return;
            undoCallbacks.delete(id);
            try {
                await closure();
                dispatch(activityFeedActions.removeActivityEvent(id));
            } catch (error) {
                undoCallbacks.set(id, closure);
                const reason =
                    error instanceof Error ? error.message : String(error);
                message.error(
                    microcopyString(
                        microcopy.activityFeed.undoFailedToast
                    ).replace("{error}", reason),
                    3
                );
            }
        },
        [aiLedger, dispatch, message, store]
    );

    const isUndoable = useCallback(
        (id: string) => {
            if (undoCallbacks.has(id)) return true;
            // AI rows: route through the ledger's `isRevertable`, which
            // checks its own closure Map. The bell badge does not depend
            // on this path so it's safe to read from `aiLedger` lazily.
            const event = store
                .getState()
                .activityFeed.events.find((entry) => entry.id === id);
            if (event?.kind === "ai" && event.aiLedgerId) {
                return aiLedger.isRevertable(event.aiLedgerId);
            }
            return false;
        },
        [aiLedger, store]
    );

    const markRead = useCallback(
        (id: string) => {
            dispatch(activityFeedActions.markActivityEventRead(id));
        },
        [dispatch]
    );

    const markAllRead = useCallback(() => {
        dispatch(activityFeedActions.markAllActivityRead());
    }, [dispatch]);

    const remove = useCallback(
        (id: string) => {
            undoCallbacks.delete(id);
            dispatch(activityFeedActions.removeActivityEvent(id));
        },
        [dispatch]
    );

    const clear = useCallback(() => {
        undoCallbacks.clear();
        dispatch(activityFeedActions.clearActivityFeed());
    }, [dispatch]);

    return {
        events,
        record,
        undo,
        isUndoable,
        markRead,
        markAllRead,
        remove,
        clear,
        unreadCount
    };
};

export default useActivityFeed;
