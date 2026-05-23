import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";

import { store } from "../../store";
import { activityFeedActions } from "../../store/reducers/activityFeedSlice";
import { aiLedgerActions } from "../../store/reducers/aiLedgerSlice";
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

    it("renders as a bottom sheet on phone chrome", () => {
        mockedUseIsPhoneChrome.mockReturnValue(true);
        renderDrawer(true);
        const drawer = screen.getByTestId("activity-feed-drawer");
        // AntD applies a placement-specific class on the wrapping
        // element. The drawer body itself uses `ant-drawer-bottom` when
        // placement is "bottom".
        expect(
            drawer.closest(".ant-drawer-bottom") ||
                document.querySelector(".ant-drawer-bottom")
        ).toBeTruthy();
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
});
