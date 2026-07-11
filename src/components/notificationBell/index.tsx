import { Bell, Check } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Typography } from "@/components/ui/typography";

import { microcopy, microcopyString } from "../../constants/microcopy";
import { fontSize } from "../../theme/tokens";
import { formatRelativeTime } from "../../utils/formatRelativeTime";
import useNotifications from "../../utils/hooks/useNotifications";
import Sheet from "../sheet";

/**
 * Notification bell (backend Notifications feature).
 *
 * Header companion to the activity-feed bell, but backed by the server's
 * persisted notifications (`useNotifications`) rather than the session-only
 * `useActivityFeed`. The exported `<NotificationBell>` is the bell trigger
 * (an accessible button with an unread-count badge); the default export
 * `<NotificationDrawer>` is the list surface (mounted once at the header
 * level, exactly like `ActivityFeedDrawer`), rendering each notification's
 * summary + relative time, clickable to mark read, with a "Mark all as read"
 * action.
 *
 * Mirrors `ActivityFeedDrawer`'s chrome split via the shared `<Sheet>`
 * primitive — on phone a multi-detent bottom sheet, on desktop a
 * right-shelf drawer.
 */

/**
 * Localized relative-time formatter. Delegates to the shared
 * `formatRelativeTime` util, reading the copy from
 * `microcopy.notifications.relative*` (through `microcopyString`) so the
 * bell speaks the same temporal language as the activity drawer + Inbox.
 * The Proxy reads stay at the call site so a locale switch propagates.
 */
const formatRelative = (then: number, now: number): string =>
    formatRelativeTime(then, now, {
        justNow: microcopyString(microcopy.notifications.relativeJustNow),
        oneMinute: microcopyString(microcopy.notifications.relativeOneMinute),
        minutes: microcopyString(microcopy.notifications.relativeMinutes),
        oneHour: microcopyString(microcopy.notifications.relativeOneHour),
        hours: microcopyString(microcopy.notifications.relativeHours),
        oneDay: microcopyString(microcopy.notifications.relativeOneDay),
        days: microcopyString(microcopy.notifications.relativeDays)
    });

/**
 * Parse a server `createdAt` ISO string to epoch ms. Returns `null` when
 * the field is absent (the mark-read endpoint returns a string ack, not a
 * notification object) or unparseable, so the row can omit the timestamp
 * line rather than render "Invalid Date".
 */
const toEpochMs = (createdAt: string | undefined): number | null => {
    if (!createdAt) return null;
    const ms = Date.parse(createdAt);
    return Number.isNaN(ms) ? null : ms;
};

interface NotificationDrawerProps {
    open: boolean;
    onClose: () => void;
}

const NotificationDrawer: React.FC<NotificationDrawerProps> = ({
    open,
    onClose
}) => {
    const { notifications, markRead, markAllRead } = useNotifications();
    const list = useMemo(() => notifications ?? [], [notifications]);

    /*
     * `now` ticks every 30 s while the drawer is open so the relative
     * timestamps stay fresh; the interval only runs while open to avoid
     * background work in the header chrome (mirrors `ActivityFeedDrawer`).
     */
    const [now, setNow] = useState<number>(() => Date.now());
    useEffect(() => {
        if (!open) return;
        const id = window.setInterval(() => setNow(Date.now()), 30_000);
        return () => window.clearInterval(id);
    }, [open]);
    useEffect(() => {
        if (open) setNow(Date.now());
    }, [open]);

    const allRead = list.every((notification) => notification.isRead);

    const handleRowClick = useCallback(
        (notification: INotification) => {
            if (notification.isRead) return;
            markRead(notification._id);
        },
        [markRead]
    );

    const drawerTitle = microcopyString(microcopy.notifications.drawerTitle);

    const body = (
        <div data-testid="notification-drawer-body">
            <div className="flex items-center justify-between gap-xs pb-xs">
                <Typography.Text strong style={{ fontSize: fontSize.sm }}>
                    {drawerTitle}
                </Typography.Text>
                <Button
                    aria-label={microcopyString(
                        microcopy.notifications.markAllReadAriaLabel
                    )}
                    data-testid="notification-mark-all-read"
                    disabled={allRead}
                    onClick={markAllRead}
                    size="sm"
                    variant="ghost"
                >
                    <Check aria-hidden />
                    {microcopyString(microcopy.notifications.markAllRead)}
                </Button>
            </div>
            {list.length === 0 ? (
                <Empty
                    data-testid="notification-empty"
                    description={microcopyString(microcopy.notifications.empty)}
                />
            ) : (
                <ul className="m-0 flex list-none flex-col gap-xxs p-0">
                    {list.map((notification) => {
                        const ms = toEpochMs(notification.createdAt);
                        return (
                            <li className="m-0 p-0" key={notification._id}>
                                <button
                                    aria-label={
                                        notification.isRead
                                            ? undefined
                                            : microcopyString(
                                                  microcopy.notifications
                                                      .markReadAriaLabel
                                              ).replace(
                                                  "{summary}",
                                                  notification.summary
                                              )
                                    }
                                    className={
                                        "flex w-full items-start gap-xs rounded-md px-sm py-xs text-start transition-colors " +
                                        "hover:bg-muted focus-visible:bg-muted focus-visible:outline-none " +
                                        "disabled:cursor-default coarse:min-h-[44px] " +
                                        (notification.isRead
                                            ? "bg-transparent"
                                            : "bg-primary/10")
                                    }
                                    data-testid="notification-row"
                                    data-kind={notification.kind}
                                    data-notification-id={notification._id}
                                    data-unread={
                                        notification.isRead ? "no" : "yes"
                                    }
                                    disabled={notification.isRead}
                                    onClick={() => handleRowClick(notification)}
                                    type="button"
                                >
                                    {notification.isRead ? (
                                        <span
                                            aria-hidden
                                            className="w-2 flex-none"
                                        />
                                    ) : (
                                        <span
                                            aria-hidden
                                            className="mt-[6px] h-2 w-2 flex-none rounded-full bg-primary"
                                        />
                                    )}
                                    <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                                        <Typography.Text className="break-words">
                                            {notification.summary}
                                        </Typography.Text>
                                        {ms !== null && (
                                            <Typography.Text
                                                className="text-xs"
                                                type="secondary"
                                            >
                                                {formatRelative(ms, now)}
                                            </Typography.Text>
                                        )}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );

    return (
        <Sheet
            closable
            data-testid="notification-drawer"
            defaultDetent="medium"
            detents={["medium", "large"]}
            desktopPlacement="right"
            desktopSize="default"
            closeAriaLabel={microcopyString(
                microcopy.notifications.drawerCloseLabel
            )}
            onClose={onClose}
            open={open}
            title={
                <span className="inline-flex items-center gap-xs">
                    <Bell aria-hidden className="size-4" />
                    {drawerTitle}
                </span>
            }
        >
            {body}
        </Sheet>
    );
};

interface NotificationBellProps {
    /**
     * Imperative bell trigger. The header renders this and owns the
     * open/close state so the drawer body mounts once at the layout
     * level (matching `ActivityFeedBell`).
     */
    unreadCount: number;
    onClick: () => void;
}

/**
 * Bell-icon button used by the header. The accessible name follows the same
 * one/other plural pattern as `ActivityFeedBell`: pick the microcopy key off
 * the count and `.replace("{count}", String(count))`. We deliberately avoid
 * literal ICU plural syntax because the codebase has no formatter and the
 * literal would read out to screen readers.
 */
export const NotificationBell: React.FC<NotificationBellProps> = ({
    unreadCount,
    onClick
}) => {
    const ariaLabel =
        unreadCount === 0
            ? microcopyString(microcopy.notifications.bellAriaLabelZero)
            : microcopyString(
                  unreadCount === 1
                      ? microcopy.notifications.bellAriaLabelOne
                      : microcopy.notifications.bellAriaLabelOther
              ).replace("{count}", String(unreadCount));
    return (
        <button
            aria-label={ariaLabel}
            className="inline-flex size-9 items-center justify-center rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:outline-none coarse:size-[44px]"
            data-testid="notification-bell"
            onClick={onClick}
            type="button"
        >
            <span
                className="relative inline-flex"
                data-testid="notification-bell-badge"
            >
                <Bell aria-hidden className="size-4" />
                {unreadCount > 0 ? (
                    <span
                        aria-hidden
                        className="pointer-events-none absolute -right-[6px] -top-[6px] inline-flex min-w-4 items-center justify-center rounded-pill bg-destructive px-[4px] text-[10px] font-semibold leading-4 text-destructive-foreground"
                    >
                        {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                ) : null}
            </span>
        </button>
    );
};

export default NotificationDrawer;
