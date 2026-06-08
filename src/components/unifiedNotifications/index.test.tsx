import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";

import { microcopy } from "../../constants/microcopy";
import { store } from "../../store";
import { activityFeedActions } from "../../store/reducers/activityFeedSlice";
import { aiLedgerActions } from "../../store/reducers/aiLedgerSlice";
import {
    coarseTouchTargetsFor,
    styledClassFor
} from "../../testUtils/styleRules";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import useNotifications from "../../utils/hooks/useNotifications";
import { __resetActivityFeedUndoCallbacksForTests } from "../../utils/hooks/useActivityFeed";
import { __resetAiLedgerUndoCallbacksForTests } from "../../utils/hooks/useAiLedger";

import UnifiedNotificationsDrawer, { UnifiedNotificationsBell } from ".";

jest.mock("../../utils/hooks/useIsPhoneChrome");
jest.mock("../../utils/hooks/useNotifications");

const mockedUseIsPhoneChrome = useIsPhoneChrome as jest.MockedFunction<
    typeof useIsPhoneChrome
>;
const mockedUseNotifications = useNotifications as jest.MockedFunction<
    typeof useNotifications
>;

const markRead = jest.fn();
const markAllRead = jest.fn();

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

const buildNotification = (
    overrides: Partial<INotification> = {}
): INotification => ({
    _id: "ntf-1",
    userId: "u-1",
    kind: "mention",
    refId: "task-1",
    projectId: "proj-1",
    summary: "Alice mentioned you in \u201CShip inbox\u201D",
    isRead: false,
    createdAt: new Date().toISOString(),
    ...overrides
});

const setNotifications = (notifications: INotification[] | undefined) => {
    mockedUseNotifications.mockReturnValue({
        notifications,
        unreadCount: (notifications ?? []).filter((n) => !n.isRead).length,
        isLoading: false,
        markRead,
        markAllRead,
        isMutating: false
    });
};

const renderDrawer = (open: boolean, onClose = jest.fn()) =>
    render(
        <Provider store={store}>
            <UnifiedNotificationsDrawer onClose={onClose} open={open} />
        </Provider>
    );

describe("UnifiedNotificationsBell", () => {
    beforeAll(installAntdBrowserMocks);

    it("renders a button with zero-unread aria-label", () => {
        render(
            <UnifiedNotificationsBell onClick={jest.fn()} unreadCount={0} />
        );
        const bell = screen.getByTestId("unified-notifications-bell");
        expect(bell.tagName).toBe("BUTTON");
        expect(bell).toHaveAccessibleName(
            microcopy.unifiedNotifications.bellAriaLabelZero
        );
    });

    it("renders singular aria-label for 1 unread", () => {
        render(
            <UnifiedNotificationsBell onClick={jest.fn()} unreadCount={1} />
        );
        expect(
            screen.getByTestId("unified-notifications-bell")
        ).toHaveAccessibleName(
            (microcopy.unifiedNotifications.bellAriaLabelOne as string).replace(
                "{count}",
                "1"
            )
        );
    });

    it("renders plural aria-label for many unread", () => {
        render(
            <UnifiedNotificationsBell onClick={jest.fn()} unreadCount={7} />
        );
        expect(
            screen.getByTestId("unified-notifications-bell")
        ).toHaveAccessibleName(
            (
                microcopy.unifiedNotifications.bellAriaLabelOther as string
            ).replace("{count}", "7")
        );
    });

    it("fires onClick when pressed", () => {
        const onClick = jest.fn();
        render(
            <UnifiedNotificationsBell onClick={onClick} unreadCount={0} />
        );
        fireEvent.click(screen.getByTestId("unified-notifications-bell"));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("declares a 44 px target on coarse pointers", () => {
        render(
            <UnifiedNotificationsBell onClick={jest.fn()} unreadCount={0} />
        );
        const button = screen.getByTestId("unified-notifications-bell");
        const styledClass = styledClassFor(button);
        expect(styledClass).toBeTruthy();
        const { heights, widths } = coarseTouchTargetsFor(styledClass ?? "");
        expect(Math.max(...heights)).toBeGreaterThanOrEqual(44);
        expect(Math.max(...widths)).toBeGreaterThanOrEqual(44);
    });
});

describe("UnifiedNotificationsDrawer", () => {
    beforeAll(installAntdBrowserMocks);

    beforeEach(() => {
        jest.clearAllMocks();
        mockedUseIsPhoneChrome.mockReturnValue(false);
        setNotifications([]);
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

    it("renders Segmented tabs with Activity and Alerts", () => {
        renderDrawer(true);
        const tabs = screen.getByTestId("unified-notifications-tabs");
        expect(tabs).toBeInTheDocument();
        expect(
            within(tabs).getByText(
                microcopy.unifiedNotifications.tabActivity
            )
        ).toBeInTheDocument();
        expect(
            within(tabs).getByText(
                microcopy.unifiedNotifications.tabAlerts
            )
        ).toBeInTheDocument();
    });

    it("defaults to Activity tab with feed content", () => {
        renderDrawer(true);
        expect(
            screen.getByTestId("unified-activity-panel")
        ).toBeInTheDocument();
        expect(
            screen.getByTestId("activity-feed-empty")
        ).toBeInTheDocument();
    });

    it("shows activity feed events in the Activity tab", () => {
        const now = Date.now();
        act(() => {
            store.dispatch(
                activityFeedActions.recordActivityEvent({
                    id: "evt-1",
                    timestamp: now,
                    kind: "task",
                    action: "create",
                    summary: "Created task X",
                    undoable: false,
                    isRead: false
                })
            );
        });
        renderDrawer(true);
        expect(screen.getByText("Created task X")).toBeInTheDocument();
    });

    it("switches to Alerts tab and shows notifications", () => {
        setNotifications([
            buildNotification({ _id: "a", summary: "Mention A" })
        ]);
        renderDrawer(true);
        const alertsLabel = screen.getByText(
            microcopy.unifiedNotifications.tabAlerts
        );
        fireEvent.click(alertsLabel);
        expect(
            screen.getByTestId("unified-alerts-panel")
        ).toBeInTheDocument();
        expect(screen.getByText("Mention A")).toBeInTheDocument();
    });

    it("shows notification empty state on Alerts tab when empty", () => {
        setNotifications([]);
        renderDrawer(true);
        const alertsLabel = screen.getByText(
            microcopy.unifiedNotifications.tabAlerts
        );
        fireEvent.click(alertsLabel);
        expect(screen.getByTestId("notification-empty")).toBeInTheDocument();
    });

    it("renders the drawer body testid", () => {
        renderDrawer(true);
        expect(
            screen.getByTestId("unified-notifications-drawer-body")
        ).toBeInTheDocument();
    });
});
