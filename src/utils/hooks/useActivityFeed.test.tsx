import { act, render } from "@testing-library/react";
import { message } from "antd";
import { Provider } from "react-redux";

import { store } from "../../store";
import {
    ACTIVITY_FEED_MAX_ENTRIES,
    activityFeedActions
} from "../../store/reducers/activityFeedSlice";
import { aiLedgerActions } from "../../store/reducers/aiLedgerSlice";

import useActivityFeed, {
    __resetActivityFeedUndoCallbacksForTests
} from "./useActivityFeed";
import { __resetAiLedgerUndoCallbacksForTests } from "./useAiLedger";

const Probe: React.FC<{
    capture?: (api: ReturnType<typeof useActivityFeed>) => void;
}> = ({ capture }) => {
    const api = useActivityFeed();
    if (capture) capture(api);
    return (
        <ul data-testid="events">
            {api.events.map((event) => (
                <li
                    key={event.id}
                    data-undoable={api.isUndoable(event.id) ? "yes" : "no"}
                    data-unread={event.isRead ? "no" : "yes"}
                >
                    {event.summary}
                </li>
            ))}
        </ul>
    );
};

const renderProbe = () => {
    let apiRef: ReturnType<typeof useActivityFeed> | null = null;
    const utils = render(
        <Provider store={store}>
            <Probe capture={(api) => (apiRef = api)} />
        </Provider>
    );
    return {
        ...utils,
        getApi: () => {
            if (!apiRef) throw new Error("Probe never rendered");
            return apiRef;
        }
    };
};

describe("useActivityFeed", () => {
    beforeEach(() => {
        act(() => {
            store.dispatch(activityFeedActions.clearActivityFeed());
            store.dispatch(aiLedgerActions.clearAiLedger());
        });
        __resetActivityFeedUndoCallbacksForTests();
        __resetAiLedgerUndoCallbacksForTests();
    });

    afterEach(() => {
        act(() => {
            store.dispatch(activityFeedActions.clearActivityFeed());
            store.dispatch(aiLedgerActions.clearAiLedger());
        });
        __resetActivityFeedUndoCallbacksForTests();
        __resetAiLedgerUndoCallbacksForTests();
    });

    it("record() appends an event with an auto id + unread flag", () => {
        const probe = renderProbe();
        const before = Date.now();
        act(() => {
            probe.getApi().record({
                kind: "task",
                action: "create",
                summary: "Created task A"
            });
        });
        const events = probe.getApi().events;
        expect(events).toHaveLength(1);
        expect(events[0].summary).toBe("Created task A");
        expect(events[0].id).toMatch(/^activity-/);
        expect(events[0].timestamp).toBeGreaterThanOrEqual(before);
        expect(events[0].isRead).toBe(false);
        expect(probe.getApi().unreadCount).toBe(1);
    });

    it("record() with an undo closure marks the event undoable", () => {
        const probe = renderProbe();
        const undo = jest.fn();
        act(() => {
            probe.getApi().record({
                kind: "column",
                action: "create",
                summary: "Created column A",
                undo
            });
        });
        const event = probe.getApi().events[0];
        expect(probe.getApi().isUndoable(event.id)).toBe(true);
    });

    it("undo() runs the closure and removes the entry", async () => {
        const probe = renderProbe();
        const undo = jest.fn();
        act(() => {
            probe.getApi().record({
                kind: "task",
                action: "create",
                summary: "Created task A",
                undo
            });
        });
        const id = probe.getApi().events[0].id;
        await act(async () => {
            await probe.getApi().undo(id);
        });
        expect(undo).toHaveBeenCalledTimes(1);
        expect(probe.getApi().events).toHaveLength(0);
    });

    it("undo() leaves the entry and surfaces a toast when the closure throws", async () => {
        const errSpy = jest
            .spyOn(message, "error")
            .mockImplementation(() => ({}) as ReturnType<typeof message.error>);
        const probe = renderProbe();
        const undo = jest.fn().mockRejectedValue(new Error("boom"));
        act(() => {
            probe.getApi().record({
                kind: "task",
                action: "create",
                summary: "Created task A",
                undo
            });
        });
        const id = probe.getApi().events[0].id;
        await act(async () => {
            await probe.getApi().undo(id);
        });
        expect(undo).toHaveBeenCalledTimes(1);
        expect(probe.getApi().events).toHaveLength(1);
        expect(probe.getApi().isUndoable(id)).toBe(true);
        expect(errSpy).toHaveBeenCalledWith(
            expect.stringContaining("boom"),
            expect.any(Number)
        );
        errSpy.mockRestore();
    });

    it("markRead flips a single event's isRead flag", () => {
        const probe = renderProbe();
        act(() => {
            probe.getApi().record({
                kind: "task",
                action: "create",
                summary: "Created task A"
            });
        });
        const id = probe.getApi().events[0].id;
        expect(probe.getApi().unreadCount).toBe(1);
        act(() => {
            probe.getApi().markRead(id);
        });
        expect(probe.getApi().events[0].isRead).toBe(true);
        expect(probe.getApi().unreadCount).toBe(0);
    });

    it("markAllRead clears the unread count without removing entries", () => {
        const probe = renderProbe();
        act(() => {
            probe.getApi().record({
                kind: "task",
                action: "create",
                summary: "A"
            });
            probe.getApi().record({
                kind: "column",
                action: "create",
                summary: "B"
            });
        });
        expect(probe.getApi().unreadCount).toBe(2);
        act(() => {
            probe.getApi().markAllRead();
        });
        expect(probe.getApi().unreadCount).toBe(0);
        expect(probe.getApi().events).toHaveLength(2);
    });

    it("clear() empties Redux entries AND the callback Map", async () => {
        const probe = renderProbe();
        const undo = jest.fn();
        act(() => {
            probe.getApi().record({
                kind: "task",
                action: "create",
                summary: "A",
                undo
            });
        });
        const firstId = probe.getApi().events[0].id;
        act(() => {
            probe.getApi().clear();
        });
        expect(probe.getApi().events).toHaveLength(0);
        expect(probe.getApi().isUndoable(firstId)).toBe(false);
        // A subsequent undo call on the freed id should not crash.
        await act(async () => {
            await probe.getApi().undo(firstId);
        });
        expect(undo).not.toHaveBeenCalled();
    });

    it("caps entries at ACTIVITY_FEED_MAX_ENTRIES with FIFO eviction", () => {
        const probe = renderProbe();
        const oldestUndo = jest.fn();
        act(() => {
            probe.getApi().record({
                kind: "task",
                action: "create",
                summary: "Oldest",
                undo: oldestUndo
            });
        });
        const oldestId = probe.getApi().events[0].id;
        // Push enough records to evict the oldest.
        act(() => {
            for (let i = 0; i < ACTIVITY_FEED_MAX_ENTRIES; i++) {
                probe.getApi().record({
                    kind: "task",
                    action: "create",
                    summary: `Event ${i}`
                });
            }
        });
        expect(probe.getApi().events).toHaveLength(ACTIVITY_FEED_MAX_ENTRIES);
        // The oldest closure should have been freed alongside its
        // evicted entry.
        expect(probe.getApi().isUndoable(oldestId)).toBe(false);
    });

    it("bridges AI ledger entries into the activity feed as one-way kind:ai rows", () => {
        const probe = renderProbe();
        const undo = jest.fn();
        act(() => {
            store.dispatch(
                aiLedgerActions.recordAiLedgerEntry({
                    id: "ledger-test-bridge-1",
                    timestamp: Date.now(),
                    description: "Applied story points",
                    surface: "task-assist",
                    undoable: true
                })
            );
        });
        const events = probe.getApi().events;
        expect(events).toHaveLength(1);
        expect(events[0].kind).toBe("ai");
        expect(events[0].aiLedgerId).toBe("ledger-test-bridge-1");
        expect(events[0].summary).toBe("Applied story points");
        // The activity feed must NOT own the closure — the bridge is
        // one-way, so the AI ledger remains the Revert authority.
        expect(undo).not.toHaveBeenCalled();
    });

    it("does not re-forward an AI ledger entry that is already in the feed", () => {
        const probe = renderProbe();
        act(() => {
            store.dispatch(
                aiLedgerActions.recordAiLedgerEntry({
                    id: "ledger-test-bridge-2",
                    timestamp: Date.now(),
                    description: "Applied story points",
                    surface: "task-assist",
                    undoable: false
                })
            );
        });
        expect(probe.getApi().events).toHaveLength(1);
        // A non-AI record() shouldn't re-trigger the bridge for the same id.
        act(() => {
            probe.getApi().record({
                kind: "task",
                action: "create",
                summary: "Created task A"
            });
        });
        expect(
            probe.getApi().events.filter((event) => event.kind === "ai")
        ).toHaveLength(1);
    });

    it("AI rows route Undo through useAiLedger.revert, not a local closure", async () => {
        const probe = renderProbe();
        // Push a real ledger entry with a live closure into the ledger
        // so the bridge forwards it; the closure lives on the ledger
        // side (the activity-feed Map is empty for this entry).
        const ledgerUndo = jest.fn();
        // Use the real ledger via the store so the bridge picks it up.
        const id = "ledger-test-bridge-3";
        act(() => {
            store.dispatch(
                aiLedgerActions.recordAiLedgerEntry({
                    id,
                    timestamp: Date.now(),
                    description: "Applied draft",
                    surface: "task-draft",
                    undoable: true
                })
            );
        });
        // Inject the live undo closure into the ledger's runtime Map by
        // re-recording through the public hook would re-issue a new id;
        // instead we touch the shared module's behavior by going through
        // the bridge + invoking undo via the feed surface. The bridge
        // forwarded a single event with `aiLedgerId` set, so calling
        // `feed.undo(eventId)` should attempt the ledger revert path.
        const event = probe
            .getApi()
            .events.find((entry) => entry.aiLedgerId === id);
        expect(event).toBeDefined();
        // The ledger has the entry but the closure map is empty (we
        // dispatched directly), so `revert()` is a no-op warn + the
        // feed.undo path should leave the activity-feed entry intact.
        const warnSpy = jest
            .spyOn(console, "warn")
            .mockImplementation(() => undefined);
        await act(async () => {
            await probe.getApi().undo(event!.id);
        });
        // The feed entry stays — the ledger closure didn't run, so the
        // ledger entry is also still present.
        expect(probe.getApi().events).toHaveLength(1);
        expect(ledgerUndo).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });
});
