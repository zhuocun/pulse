import { fireEvent, render, screen, within } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { microcopy } from "../../constants/microcopy";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import useNotifications from "../../utils/hooks/useNotifications";

import NotificationDrawer, { NotificationBell } from ".";

expect.extend(toHaveNoViolations);

jest.mock("../../utils/hooks/useIsPhoneChrome");
jest.mock("../../utils/hooks/useNotifications");

const mockedUseIsPhoneChrome = useIsPhoneChrome as jest.MockedFunction<
    typeof useIsPhoneChrome
>;
const mockedUseNotifications = useNotifications as jest.MockedFunction<
    typeof useNotifications
>;

const installBrowserMocks = () => {
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

const markRead = jest.fn();
const markAllRead = jest.fn();

const buildNotification = (
    overrides: Partial<INotification> = {}
): INotification => ({
    _id: "ntf-1",
    userId: "u-1",
    kind: "mention",
    refId: "task-1",
    projectId: "proj-1",
    summary: "Alice mentioned you in “Ship inbox”",
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

describe("NotificationBell", () => {
    beforeAll(installBrowserMocks);

    beforeEach(() => {
        jest.clearAllMocks();
        mockedUseIsPhoneChrome.mockReturnValue(false);
        setNotifications([]);
    });

    it("renders a real button with the zero-unread aria-label", () => {
        render(<NotificationBell onClick={jest.fn()} unreadCount={0} />);
        const bell = screen.getByTestId("notification-bell");
        expect(bell.tagName).toBe("BUTTON");
        expect(bell).toHaveAttribute("type", "button");
        expect(bell).toHaveAccessibleName(
            microcopy.notifications.bellAriaLabelZero
        );
        expect(bell).toHaveClass("focus-visible:ring-2");
        expect(bell).toHaveClass("focus-visible:ring-ring");
        expect(bell).toHaveClass("focus-visible:ring-offset-2");
    });

    it("renders the unread count in the badge and the singular aria-label", () => {
        render(<NotificationBell onClick={jest.fn()} unreadCount={1} />);
        const bell = screen.getByTestId("notification-bell");
        expect(bell).toHaveAccessibleName(
            microcopy.notifications.bellAriaLabelOne.replace("{count}", "1")
        );
        // AntD renders the numeric badge as text inside the trigger.
        expect(within(bell).getByText("1")).toBeInTheDocument();
    });

    it("uses the plural aria-label and interpolates the count for many unread", () => {
        render(<NotificationBell onClick={jest.fn()} unreadCount={5} />);
        expect(screen.getByTestId("notification-bell")).toHaveAccessibleName(
            microcopy.notifications.bellAriaLabelOther.replace("{count}", "5")
        );
    });

    it("fires onClick when the bell is pressed", () => {
        const onClick = jest.fn();
        render(<NotificationBell onClick={onClick} unreadCount={3} />);
        fireEvent.click(screen.getByTestId("notification-bell"));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("has no axe violations", async () => {
        const { container } = render(
            <NotificationBell onClick={jest.fn()} unreadCount={2} />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});

describe("NotificationDrawer", () => {
    beforeAll(installBrowserMocks);

    beforeEach(() => {
        jest.clearAllMocks();
        mockedUseIsPhoneChrome.mockReturnValue(false);
        setNotifications([]);
    });

    it("renders the empty state when there are no notifications", () => {
        setNotifications([]);
        render(<NotificationDrawer onClose={jest.fn()} open />);
        expect(screen.getByTestId("notification-empty")).toBeInTheDocument();
        expect(
            screen.getByText(microcopy.notifications.empty)
        ).toBeInTheDocument();
    });

    it("renders a row per notification with its summary", () => {
        setNotifications([
            buildNotification({ _id: "a", summary: "Mention one" }),
            buildNotification({
                _id: "b",
                summary: "Mention two",
                isRead: true
            })
        ]);
        render(<NotificationDrawer onClose={jest.fn()} open />);

        const rows = screen.getAllByTestId("notification-row");
        expect(rows).toHaveLength(2);
        expect(screen.getByText("Mention one")).toBeInTheDocument();
        expect(screen.getByText("Mention two")).toBeInTheDocument();
    });

    it("marks an unread notification read when its row is clicked", () => {
        setNotifications([
            buildNotification({
                _id: "ntf-9",
                summary: "Tap me",
                isRead: false
            })
        ]);
        render(<NotificationDrawer onClose={jest.fn()} open />);

        fireEvent.click(screen.getByTestId("notification-row"));
        expect(markRead).toHaveBeenCalledTimes(1);
        expect(markRead).toHaveBeenCalledWith("ntf-9");
    });

    it("disables an already-read row so it cannot be re-marked", () => {
        setNotifications([
            buildNotification({ _id: "ntf-read", isRead: true })
        ]);
        render(<NotificationDrawer onClose={jest.fn()} open />);

        const row = screen.getByTestId("notification-row");
        expect(row).toBeDisabled();
        fireEvent.click(row);
        expect(markRead).not.toHaveBeenCalled();
    });

    it("exposes a per-row mark-read accessible name only while unread", () => {
        setNotifications([
            buildNotification({
                _id: "u",
                summary: "Unread row",
                isRead: false
            }),
            buildNotification({
                _id: "r",
                summary: "Read row",
                isRead: true
            })
        ]);
        render(<NotificationDrawer onClose={jest.fn()} open />);

        expect(
            screen.getByRole("button", {
                name: microcopy.notifications.markReadAriaLabel.replace(
                    "{summary}",
                    "Unread row"
                )
            })
        ).toBeInTheDocument();
    });

    it("fires markAllRead from the mark-all action and disables it when all read", () => {
        setNotifications([
            buildNotification({ _id: "a", isRead: false }),
            buildNotification({ _id: "b", isRead: false })
        ]);
        const { rerender } = render(
            <NotificationDrawer onClose={jest.fn()} open />
        );

        const markAllButton = screen.getByTestId("notification-mark-all-read");
        expect(markAllButton).toBeEnabled();
        fireEvent.click(markAllButton);
        expect(markAllRead).toHaveBeenCalledTimes(1);

        // When every notification is read, the action disables.
        setNotifications([
            buildNotification({ _id: "a", isRead: true }),
            buildNotification({ _id: "b", isRead: true })
        ]);
        rerender(<NotificationDrawer onClose={jest.fn()} open />);
        expect(screen.getByTestId("notification-mark-all-read")).toBeDisabled();
    });

    it("renders a relative timestamp for a notification with a createdAt", () => {
        setNotifications([
            buildNotification({
                _id: "ts",
                summary: "Recent mention",
                createdAt: new Date().toISOString()
            })
        ]);
        render(<NotificationDrawer onClose={jest.fn()} open />);

        const row = screen.getByTestId("notification-row");
        expect(
            within(row).getByText(microcopy.notifications.relativeJustNow)
        ).toBeInTheDocument();
    });

    it("omits the timestamp line when createdAt is absent", () => {
        setNotifications([
            buildNotification({
                _id: "no-ts",
                summary: "No timestamp",
                createdAt: undefined
            })
        ]);
        render(<NotificationDrawer onClose={jest.fn()} open />);

        const row = screen.getByTestId("notification-row");
        expect(within(row).getByText("No timestamp")).toBeInTheDocument();
        expect(
            within(row).queryByText(microcopy.notifications.relativeJustNow)
        ).not.toBeInTheDocument();
    });

    it("has no axe violations with rows rendered", async () => {
        setNotifications([
            buildNotification({ _id: "a", summary: "Unread", isRead: false }),
            buildNotification({ _id: "b", summary: "Read", isRead: true })
        ]);
        const { container } = render(
            <NotificationDrawer onClose={jest.fn()} open />
        );
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});
