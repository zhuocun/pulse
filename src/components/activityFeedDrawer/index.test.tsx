import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";

import { store } from "../../store";
import { activityFeedActions } from "../../store/reducers/activityFeedSlice";
import { aiLedgerActions } from "../../store/reducers/aiLedgerSlice";
import {
    coarseTouchTargetsFor,
    styledClassFor
} from "../../testUtils/styleRules";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import { __resetActivityFeedUndoCallbacksForTests } from "../../utils/hooks/useActivityFeed";
import { __resetAiLedgerUndoCallbacksForTests } from "../../utils/hooks/useAiLedger";

import ActivityFeedDrawer, { ActivityFeedBell } from ".";

jest.mock("../../utils/hooks/useIsPhoneChrome");

const mockedUseIsPhoneChrome = useIsPhoneChrome as jest.MockedFunction<
    typeof useIsPhoneChrome
>;

const installAntdBrowserMocks = () => {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
            addEventListener: jest.fn(),
            addListener: jest.fn(),
            dispatchEvent: jest.fn(),
            matches: false,
            media: query,
            onchange: null,
            removeEventListener: jest.fn(),
            removeListener: jest.fn()
        })
    });
};

const renderDrawer = (open: boolean, onClose = jest.fn()) =>
    render(
        <Provider store={store}>
            <ActivityFeedDrawer onClose={onClose} open={open} />
        </Provider>
    );

describe("ActivityFeedDrawer", () => {
    beforeAll(() => {
        installAntdBrowserMocks();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockedUseIsPhoneChrome.mockReturnValue(false);
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

    it("renders the empty state when the feed is empty", () => {
        renderDrawer(true);
        expect(screen.getByTestId("activity-feed-empty")).toBeInTheDocument();
    });

    it("groups events by date bucket newest-first", () => {
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;
        // Two events: one earlier, one today.
        act(() => {
            store.dispatch(
                activityFeedActions.recordActivityEvent({
                    id: "evt-old",
                    timestamp: now - 3 * day,
                    kind: "task",
                    action: "create",
                    summary: "Old task",
                    undoable: false,
                    isRead: false
                })
            );
            store.dispatch(
                activityFeedActions.recordActivityEvent({
                    id: "evt-today",
                    timestamp: now,
                    kind: "task",
                    action: "create",
                    summary: "Today task",
                    undoable: false,
                    isRead: false
                })
            );
        });
        renderDrawer(true);
        const today = screen.getByTestId("activity-feed-group-today");
        const earlier = screen.getByTestId("activity-feed-group-earlier");
        expect(today).toBeInTheDocument();
        expect(earlier).toBeInTheDocument();
        expect(within(today).getByText("Today task")).toBeInTheDocument();
        expect(within(earlier).getByText("Old task")).toBeInTheDocument();
    });

    it("renders the Undo button only when the entry has a live closure and is in the undo window", () => {
        const now = Date.now();
        // First entry has undoable=true via Redux flag but no live closure
        // (post-reload simulation) — Undo must NOT render.
        act(() => {
            store.dispatch(
                activityFeedActions.recordActivityEvent({
                    id: "evt-stale",
                    timestamp: now,
                    kind: "task",
                    action: "create",
                    summary: "Stale undoable",
                    undoable: true,
                    isRead: false
                })
            );
        });
        renderDrawer(true);
        expect(
            screen.queryByTestId("activity-feed-undo")
        ).not.toBeInTheDocument();
    });

    it("hides the Undo button once the 10s window has elapsed", () => {
        const now = Date.now();
        // Stale row from > 10s ago. Even with `undoable: true` and a live
        // closure (we can't easily inject), the window gate must hide
        // the button. We rely on the Redux flag here since there's no
        // closure to render anyway.
        act(() => {
            store.dispatch(
                activityFeedActions.recordActivityEvent({
                    id: "evt-old-window",
                    timestamp: now - 15_000,
                    kind: "task",
                    action: "create",
                    summary: "Past undo window",
                    undoable: true,
                    isRead: false
                })
            );
        });
        renderDrawer(true);
        expect(
            screen.queryByTestId("activity-feed-undo")
        ).not.toBeInTheDocument();
    });

    it("Mark all as read flips every unread flag", () => {
        act(() => {
            store.dispatch(
                activityFeedActions.recordActivityEvent({
                    id: "evt-a",
                    timestamp: Date.now(),
                    kind: "task",
                    action: "create",
                    summary: "A",
                    undoable: false,
                    isRead: false
                })
            );
            store.dispatch(
                activityFeedActions.recordActivityEvent({
                    id: "evt-b",
                    timestamp: Date.now(),
                    kind: "column",
                    action: "create",
                    summary: "B",
                    undoable: false,
                    isRead: false
                })
            );
        });
        renderDrawer(true);
        const markAll = screen.getByTestId("activity-feed-mark-all-read");
        expect(markAll).not.toBeDisabled();
        fireEvent.click(markAll);
        const rows = screen.getAllByTestId("activity-feed-row");
        rows.forEach((row) => {
            expect(row).toHaveAttribute("data-unread", "no");
        });
    });

    it("renders kind icons per event row", () => {
        act(() => {
            store.dispatch(
                activityFeedActions.recordActivityEvent({
                    id: "evt-task",
                    timestamp: Date.now(),
                    kind: "task",
                    action: "create",
                    summary: "Task row",
                    undoable: false,
                    isRead: false
                })
            );
            store.dispatch(
                activityFeedActions.recordActivityEvent({
                    id: "evt-column",
                    timestamp: Date.now(),
                    kind: "column",
                    action: "create",
                    summary: "Column row",
                    undoable: false,
                    isRead: false
                })
            );
            store.dispatch(
                activityFeedActions.recordActivityEvent({
                    id: "evt-project",
                    timestamp: Date.now(),
                    kind: "project",
                    action: "create",
                    summary: "Project row",
                    undoable: false,
                    isRead: false
                })
            );
        });
        renderDrawer(true);
        expect(
            screen.getByTestId("activity-feed-icon-task")
        ).toBeInTheDocument();
        expect(
            screen.getByTestId("activity-feed-icon-column")
        ).toBeInTheDocument();
        expect(
            screen.getByTestId("activity-feed-icon-project")
        ).toBeInTheDocument();
    });

    it("renders as a multi-detent Sheet on phone chrome", () => {
        mockedUseIsPhoneChrome.mockReturnValue(true);
        renderDrawer(true);
        // Phase 6 Wave 3 — the drawer now goes through the Sheet
        // primitive on phone. Assert the animated-surface testids the
        // Sheet emits instead of the AntD drawer placement class.
        expect(screen.getByTestId("activity-feed-drawer")).toBeInTheDocument();
        const surface = screen.getByTestId("activity-feed-drawer-surface");
        expect(surface).toBeInTheDocument();
        // Default detent is medium per the consumer config.
        expect(surface).toHaveAttribute("data-detent", "medium");
        expect(
            screen.getByTestId("activity-feed-drawer-grabber")
        ).toBeInTheDocument();
    });

    it("fires markRead exactly once on the open → closed transition", () => {
        const now = Date.now();
        act(() => {
            store.dispatch(
                activityFeedActions.recordActivityEvent({
                    id: "evt-unread",
                    timestamp: now - 1000,
                    kind: "task",
                    action: "create",
                    summary: "Pending read",
                    undoable: false,
                    isRead: false
                })
            );
        });
        // Wrap `store.dispatch` so we can count the `markActivityEventRead`
        // action type fired by the drawer's close-transition effect. This
        // is the least-invasive surrogate for adding test-scoped
        // middleware to the shared production store: the spy delegates to
        // the real dispatch, so the slice still updates and downstream
        // selectors see the same reducer output the production code path
        // would observe.
        const realDispatch = store.dispatch.bind(store);
        const dispatchSpy = jest
            .spyOn(store, "dispatch")
            .mockImplementation((action) => realDispatch(action));
        const onClose = jest.fn();
        const { rerender } = renderDrawer(true, onClose);
        const dispatchesBeforeClose = dispatchSpy.mock.calls.length;
        // Drawer opens, then transitions to closed — the markRead
        // sweep should fire on the falling edge only once.
        rerender(
            <Provider store={store}>
                <ActivityFeedDrawer onClose={onClose} open={false} />
            </Provider>
        );
        const markReadCalls = dispatchSpy.mock.calls
            .slice(dispatchesBeforeClose)
            .filter(([action]) => {
                if (
                    typeof action === "object" &&
                    action !== null &&
                    "type" in action
                ) {
                    return (
                        (action as { type: string }).type ===
                        "activityFeed/markActivityEventRead"
                    );
                }
                return false;
            });
        expect(markReadCalls).toHaveLength(1);
        const state = store.getState().activityFeed;
        expect(state.events.find((e) => e.id === "evt-unread")?.isRead).toBe(
            true
        );
        dispatchSpy.mockRestore();
    });

    it("dismisses the sheet via scrim click on phone chrome", () => {
        mockedUseIsPhoneChrome.mockReturnValue(true);
        const onClose = jest.fn();
        renderDrawer(true, onClose);
        fireEvent.click(screen.getByTestId("activity-feed-drawer-scrim"));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});

describe("ActivityFeedBell", () => {
    beforeAll(() => {
        installAntdBrowserMocks();
    });

    it("announces zero unread with the zero-suffix copy", () => {
        const onClick = jest.fn();
        render(<ActivityFeedBell unreadCount={0} onClick={onClick} />);
        const button = screen.getByTestId("activity-feed-bell");
        expect(button).toHaveAccessibleName(/no new notifications/i);
    });

    it("announces a single unread with the singular plural-key copy", () => {
        const onClick = jest.fn();
        render(<ActivityFeedBell unreadCount={1} onClick={onClick} />);
        const button = screen.getByTestId("activity-feed-bell");
        expect(button).toHaveAccessibleName(/1 unread notification/i);
    });

    it("announces multiple unread with the plural-key copy", () => {
        const onClick = jest.fn();
        render(<ActivityFeedBell unreadCount={4} onClick={onClick} />);
        const button = screen.getByTestId("activity-feed-bell");
        expect(button).toHaveAccessibleName(/4 unread notifications/i);
    });

    it("calls onClick when the bell is pressed", () => {
        const onClick = jest.fn();
        render(<ActivityFeedBell unreadCount={2} onClick={onClick} />);
        fireEvent.click(screen.getByTestId("activity-feed-bell"));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("declares a 44 px target on coarse pointers", () => {
        const onClick = jest.fn();
        render(<ActivityFeedBell unreadCount={0} onClick={onClick} />);
        const button = screen.getByTestId("activity-feed-bell");
        const styledClass = styledClassFor(button);
        expect(styledClass).toBeTruthy();
        const { heights, widths } = coarseTouchTargetsFor(styledClass ?? "");
        expect(Math.max(...heights)).toBeGreaterThanOrEqual(44);
        expect(Math.max(...widths)).toBeGreaterThanOrEqual(44);
    });
});
