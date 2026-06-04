import { BellOutlined, CheckOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Badge, Button, Empty, Typography } from "antd";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { microcopy, microcopyString } from "../../constants/microcopy";
import { fontSize, radius, space, touchTargetCoarse } from "../../theme/tokens";
import { formatRelativeTime } from "../../utils/formatRelativeTime";
import useNotifications from "../../utils/hooks/useNotifications";
import Sheet from "../sheet";

/**
 * Notification bell (backend Notifications feature).
 *
 * Header companion to the activity-feed bell, but backed by the server's
 * persisted notifications (`useNotifications`) rather than the session-only
 * `useActivityFeed`. The exported `<NotificationBell>` is the bell trigger
 * (an accessible button with an unread-count `<Badge>`); the default export
 * `<NotificationDrawer>` is the list surface (mounted once at the header
 * level, exactly like `ActivityFeedDrawer`), rendering each notification's
 * summary + relative time, clickable to mark read, with a "Mark all as read"
 * action.
 *
 * Mirrors `ActivityFeedDrawer`'s chrome split via the shared `<Sheet>`
 * primitive — on phone a multi-detent bottom sheet, on desktop the AntD
 * right-shelf `<Drawer>`.
 */

const DrawerHeader = styled.div`
    align-items: center;
    display: flex;
    gap: ${space.xs}px;
    justify-content: space-between;
    padding-bottom: ${space.xs}px;
`;

const List = styled.ul`
    display: flex;
    flex-direction: column;
    gap: ${space.xxs}px;
    list-style: none;
    margin: 0;
    padding: 0;
`;

/*
 * A notification row is itself the mark-read affordance — a full-width
 * borderless button so the whole row is one accessible target (the
 * jsx-a11y gate wants a real <button>, not a click handler on a <div>).
 * Unread rows carry the same faint brand-tinted background the activity
 * drawer uses so the two surfaces read consistently.
 */
const Row = styled.li`
    margin: 0;
    padding: 0;
`;

const RowButton = styled.button<{ $unread: boolean }>`
    align-items: flex-start;
    background: ${({ $unread }) =>
        $unread
            ? "var(--ant-color-primary-bg, rgba(234, 88, 12, 0.06))"
            : "transparent"};
    border: none;
    border-radius: ${radius.md}px;
    cursor: pointer;
    display: flex;
    font: inherit;
    gap: ${space.xs}px;
    padding: ${space.xs}px ${space.sm}px;
    text-align: start;
    width: 100%;

    &:hover,
    &:focus-visible {
        background: var(--ant-color-bg-text-hover, rgba(15, 23, 42, 0.05));
    }

    &:disabled {
        cursor: default;
    }

    @media (pointer: coarse) {
        min-height: ${touchTargetCoarse}px;
    }
`;

const RowBody = styled.span`
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
`;

const RowSummary = styled(Typography.Text)`
    && {
        font-size: ${fontSize.sm}px;
        word-break: break-word;
    }
`;

const RowMeta = styled(Typography.Text)`
    && {
        color: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.45));
        font-size: ${fontSize.xs}px;
    }
`;

/*
 * Unread dot — a small leading marker so unread rows are distinguishable
 * without relying on background colour alone (forced-colors / colour-blind
 * users). `aria-hidden` because the row's accessible name already carries
 * the "Mark as read" intent, which only renders while unread.
 */
const UnreadDot = styled.span`
    background: var(--ant-color-primary, #ea580c);
    border-radius: 50%;
    flex: 0 0 auto;
    height: 8px;
    margin-top: 6px;
    width: 8px;
`;

const ReadSpacer = styled.span`
    flex: 0 0 auto;
    width: 8px;
`;

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
            <DrawerHeader>
                <Typography.Text strong style={{ fontSize: fontSize.sm }}>
                    {drawerTitle}
                </Typography.Text>
                <Button
                    aria-label={microcopyString(
                        microcopy.notifications.markAllReadAriaLabel
                    )}
                    data-testid="notification-mark-all-read"
                    disabled={allRead}
                    icon={<CheckOutlined aria-hidden />}
                    onClick={markAllRead}
                    size="small"
                    type="text"
                >
                    {microcopyString(microcopy.notifications.markAllRead)}
                </Button>
            </DrawerHeader>
            {list.length === 0 ? (
                <Empty
                    data-testid="notification-empty"
                    description={microcopyString(microcopy.notifications.empty)}
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
            ) : (
                <List>
                    {list.map((notification) => {
                        const ms = toEpochMs(notification.createdAt);
                        return (
                            <Row key={notification._id}>
                                <RowButton
                                    $unread={!notification.isRead}
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
                                        <ReadSpacer aria-hidden />
                                    ) : (
                                        <UnreadDot aria-hidden />
                                    )}
                                    <RowBody>
                                        <RowSummary>
                                            {notification.summary}
                                        </RowSummary>
                                        {ms !== null && (
                                            <RowMeta>
                                                {formatRelative(ms, now)}
                                            </RowMeta>
                                        )}
                                    </RowBody>
                                </RowButton>
                            </Row>
                        );
                    })}
                </List>
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
            onClose={onClose}
            open={open}
            title={
                <span>
                    <BellOutlined aria-hidden style={{ marginInlineEnd: 8 }} />
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

const BellButton = styled.button`
    align-items: center;
    background: transparent;
    border: none;
    border-radius: ${radius.md}px;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65));
    cursor: pointer;
    display: inline-flex;
    height: 36px;
    justify-content: center;
    padding: 0;
    width: 36px;

    &:hover,
    &:focus-visible {
        background: var(--ant-color-bg-text-hover, rgba(15, 23, 42, 0.05));
        color: var(--ant-color-text, rgba(15, 23, 42, 0.9));
    }

    @media (pointer: coarse) {
        height: ${touchTargetCoarse}px;
        width: ${touchTargetCoarse}px;
    }
`;

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
        <BellButton
            aria-label={ariaLabel}
            data-testid="notification-bell"
            onClick={onClick}
            type="button"
        >
            <Badge
                count={unreadCount}
                data-testid="notification-bell-badge"
                offset={[-2, 2]}
                size="small"
            >
                <BellOutlined aria-hidden style={{ fontSize: fontSize.md }} />
            </Badge>
        </BellButton>
    );
};

export default NotificationDrawer;
