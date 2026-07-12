import { createSlice, PayloadAction } from "@reduxjs/toolkit";

/**
 * Session-only log of optimistic-update events surfaced through the bell
 * icon + activity drawer (Phase 4.3 — Activity / notifications drawer).
 *
 * Where the existing `aiLedgerSlice` is AI-specific (task-assist /
 * task-draft / mutation-proposal Reverts), this slice owns the BROADER
 * feed: every optimistic create / update / delete on a task, column, or
 * project lands here, with AI mutations forwarded in via a one-way bridge
 * inside `useActivityFeed`. The two slices are peers — `aiLedgerSlice`
 * stays the authoritative source for AI Revert flows, this slice is the
 * presentation/notifications log.
 *
 * Each entry stores only the SERIALIZABLE shape (id + timestamp + kind +
 * action + summary + isRead + optional sourceSurface for AI rows + an
 * optional `aiLedgerId` so the drawer can dispatch the AI-side revert
 * through `useAiLedger` without owning a second copy of the undo closure).
 * Local undo closures (for non-AI events) live in a module-scope Map keyed
 * by entry id inside `useActivityFeed.ts`, mirroring the `useAiLedger`
 * pattern. After a reload the Redux entries survive but the closures
 * don't, so the drawer hides the Undo button unless `isUndoable(id)`
 * confirms a live closure.
 *
 * Capacity bound: at most `ACTIVITY_FEED_MAX_ENTRIES` (50). FIFO eviction
 * from the front when a record arrives at the cap — the hook mirrors the
 * eviction on the closure Map so dropped entries don't pin GC.
 */

export type ActivityEventKind = "task" | "column" | "project" | "ai";
export type ActivityEventAction =
    "create" | "update" | "delete" | "move" | "rename";

export interface ActivityEventState {
    id: string;
    timestamp: number;
    kind: ActivityEventKind;
    action: ActivityEventAction;
    /** Localized, fully-rendered description shown in the drawer row. */
    summary: string;
    /**
     * Surface that originated the event for AI rows (e.g. `"task-assist"`).
     * Undefined for non-AI events; the drawer only reads it when the row
     * was forwarded in by the AI-ledger bridge.
     */
    sourceSurface?: string;
    /**
     * `true` when an undo closure is expected to live in the runtime
     * callback Map. Survives Redux serialization; the drawer cross-checks
     * via `isUndoable(id)` so a stale `undoable: true` after a reload
     * doesn't render a broken Undo button.
     */
    undoable: boolean;
    /**
     * When the entry was forwarded from `aiLedgerSlice`, the original
     * ledger id so the drawer can call `useAiLedger().revert(aiLedgerId)`
     * — this keeps the AI-side Revert flow as the SINGLE source of truth
     * and prevents a double-revert from the activity-feed Undo button.
     */
    aiLedgerId?: string;
    isRead: boolean;
}

export interface ActivityFeedState {
    events: ActivityEventState[];
}

export const ACTIVITY_FEED_MAX_ENTRIES = 50;

const initialState: ActivityFeedState = { events: [] };

export const activityFeedSlice = createSlice({
    name: "activityFeed",
    initialState,
    reducers: {
        recordActivityEvent(state, action: PayloadAction<ActivityEventState>) {
            state.events.push(action.payload);
            if (state.events.length > ACTIVITY_FEED_MAX_ENTRIES) {
                state.events.splice(
                    0,
                    state.events.length - ACTIVITY_FEED_MAX_ENTRIES
                );
            }
        },
        removeActivityEvent(state, action: PayloadAction<string>) {
            const idx = state.events.findIndex(
                (event) => event.id === action.payload
            );
            if (idx >= 0) state.events.splice(idx, 1);
        },
        markActivityEventRead(state, action: PayloadAction<string>) {
            const event = state.events.find(
                (entry) => entry.id === action.payload
            );
            if (event) event.isRead = true;
        },
        markAllActivityRead(state) {
            state.events.forEach((event) => {
                event.isRead = true;
            });
        },
        clearActivityFeed(state) {
            state.events = [];
        }
    }
});

export const activityFeedActions = activityFeedSlice.actions;
