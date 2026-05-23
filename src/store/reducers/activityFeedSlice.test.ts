import {
    ACTIVITY_FEED_MAX_ENTRIES,
    activityFeedActions,
    activityFeedSlice,
    type ActivityEventState
} from "./activityFeedSlice";

const initialState = activityFeedSlice.getInitialState();

const makeEvent = (
    id: string,
    overrides: Partial<ActivityEventState> = {}
): ActivityEventState => ({
    id,
    timestamp: 1_700_000_000_000 + Number(id.replace(/[^0-9]/g, "") || 0),
    kind: "task",
    action: "create",
    summary: `Event ${id}`,
    undoable: true,
    isRead: false,
    ...overrides
});

describe("activityFeedSlice", () => {
    it("seeds with an empty events list", () => {
        expect(
            activityFeedSlice.reducer(undefined, { type: "@@INIT" })
        ).toEqual({ events: [] });
    });

    it("recordActivityEvent appends in order", () => {
        const next = activityFeedSlice.reducer(
            initialState,
            activityFeedActions.recordActivityEvent(makeEvent("a1"))
        );
        const after = activityFeedSlice.reducer(
            next,
            activityFeedActions.recordActivityEvent(
                makeEvent("a2", { kind: "column" })
            )
        );
        expect(after.events.map((event) => event.id)).toEqual(["a1", "a2"]);
        expect(after.events[1].kind).toBe("column");
    });

    it("removeActivityEvent drops the matching id and leaves the rest", () => {
        let state = initialState;
        ["a1", "a2", "a3"].forEach((id) => {
            state = activityFeedSlice.reducer(
                state,
                activityFeedActions.recordActivityEvent(makeEvent(id))
            );
        });
        const next = activityFeedSlice.reducer(
            state,
            activityFeedActions.removeActivityEvent("a2")
        );
        expect(next.events.map((event) => event.id)).toEqual(["a1", "a3"]);
    });

    it("removeActivityEvent no-ops for an unknown id", () => {
        const state = activityFeedSlice.reducer(
            initialState,
            activityFeedActions.recordActivityEvent(makeEvent("a1"))
        );
        const next = activityFeedSlice.reducer(
            state,
            activityFeedActions.removeActivityEvent("nope")
        );
        expect(next.events.map((event) => event.id)).toEqual(["a1"]);
    });

    it("markActivityEventRead flips the matching event's isRead flag", () => {
        const state = activityFeedSlice.reducer(
            initialState,
            activityFeedActions.recordActivityEvent(makeEvent("a1"))
        );
        const next = activityFeedSlice.reducer(
            state,
            activityFeedActions.markActivityEventRead("a1")
        );
        expect(next.events[0].isRead).toBe(true);
    });

    it("markAllActivityRead flips every event's isRead flag", () => {
        let state = initialState;
        ["a1", "a2", "a3"].forEach((id) => {
            state = activityFeedSlice.reducer(
                state,
                activityFeedActions.recordActivityEvent(makeEvent(id))
            );
        });
        const next = activityFeedSlice.reducer(
            state,
            activityFeedActions.markAllActivityRead()
        );
        expect(next.events.every((event) => event.isRead)).toBe(true);
    });

    it("clearActivityFeed empties the event list", () => {
        let state = initialState;
        ["a1", "a2"].forEach((id) => {
            state = activityFeedSlice.reducer(
                state,
                activityFeedActions.recordActivityEvent(makeEvent(id))
            );
        });
        const cleared = activityFeedSlice.reducer(
            state,
            activityFeedActions.clearActivityFeed()
        );
        expect(cleared.events).toEqual([]);
    });

    it("caps the list at ACTIVITY_FEED_MAX_ENTRIES with FIFO eviction", () => {
        let state = initialState;
        for (let i = 0; i < ACTIVITY_FEED_MAX_ENTRIES + 5; i++) {
            state = activityFeedSlice.reducer(
                state,
                activityFeedActions.recordActivityEvent(makeEvent(`a${i}`))
            );
        }
        expect(state.events.length).toBe(ACTIVITY_FEED_MAX_ENTRIES);
        // The first 5 entries (oldest) should have been evicted.
        expect(state.events[0].id).toBe("a5");
        expect(state.events[state.events.length - 1].id).toBe(
            `a${ACTIVITY_FEED_MAX_ENTRIES + 4}`
        );
    });
});
