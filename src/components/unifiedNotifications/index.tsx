import { BellOutlined, CheckOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Badge, Button, Empty, Segmented, Typography } from "antd";
import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from "react";

import { microcopy, microcopyString } from "../../constants/microcopy";
import {
    fontSize,
    fontWeight,
    radius,
    space,
    touchTargetCoarse
} from "../../theme/tokens";
import { formatRelativeTime } from "../../utils/formatRelativeTime";
import useActivityFeed, {
    type ActivityEvent
} from "../../utils/hooks/useActivityFeed";
import useNotifications from "../../utils/hooks/useNotifications";
import { KIND_ICON } from "../activityKindIcon";
import Sheet from "../sheet";

type UnifiedTab = "activity" | "alerts";

const UNDO_WINDOW_MS = 10_000;

/* ── Shared styled surfaces ────────────────────────────────────────── */

const TabBar = styled.div`
    padding: ${space.xs}px ${space.sm}px 0;
`;

const PanelBody = styled.div`
    padding: ${space.xs}px 0;
`;

const SectionHeader = styled.div`
    align-items: center;
    display: flex;
    gap: ${space.xs}px;
    justify-content: space-between;
    padding: 0 ${space.sm}px ${space.xs}px;
`;

/* ── Activity tab styled surfaces (mirroring ActivityFeedDrawer) ───── */

const GroupHeading = styled(Typography.Text)`
    && {
        color: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.5));
        font-size: ${fontSize.xs}px;
        font-weight: ${fontWeight.semibold};
    }
`;

const GroupList = styled.ul`
    display: flex;
    flex-direction: column;
    gap: ${space.xxs}px;
    list-style: none;
    margin: 0;
    padding: 0;
`;

const GroupSection = styled.section`
    display: flex;
    flex-direction: column;
    gap: ${space.xs}px;
    margin-top: ${space.md}px;

    &:first-of-type {
        margin-top: 0;
    }
`;

const ActivityRow = styled.li<{ $unread: boolean }>`
    align-items: flex-start;
    background: ${({ $unread }) =>
        $unread
            ? "var(--ant-color-primary-bg, rgba(234, 88, 12, 0.06))"
            : "transparent"};
    border-radius: ${radius.md}px;
    display: flex;
    gap: ${space.xs}px;
    padding: ${space.xs}px ${space.sm}px;
`;

const RowIcon = styled.span`
    align-items: center;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
    display: inline-flex;
    flex: 0 0 auto;
    font-size: ${fontSize.md}px;
    height: 24px;
    justify-content: center;
    width: 24px;
`;

const RowBody = styled.div`
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

/* ── Alerts tab styled surfaces (mirroring NotificationDrawer) ─────── */

const AlertList = styled.ul`
    display: flex;
    flex-direction: column;
    gap: ${space.xxs}px;
    list-style: none;
    margin: 0;
    padding: 0;
`;

const AlertRowLi = styled.li`
    margin: 0;
    padding: 0;
`;

const AlertRowButton = styled.button<{ $unread: boolean }>`
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

const AlertRowBody = styled.span`
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
`;

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

/* ── Relative-time formatters ──────────────────────────────────────── */

const formatActivityRelative = (then: number, now: number): string =>
    formatRelativeTime(then, now, {
        justNow: microcopyString(microcopy.activityFeed.relativeJustNow),
        oneMinute: microcopyString(microcopy.activityFeed.relativeOneMinute),
        minutes: microcopyString(microcopy.activityFeed.relativeMinutes),
        oneHour: microcopyString(microcopy.activityFeed.relativeOneHour),
        hours: microcopyString(microcopy.activityFeed.relativeHours),
        oneDay: microcopyString(microcopy.activityFeed.relativeOneDay),
        days: microcopyString(microcopy.activityFeed.relativeDays)
    });

const formatAlertRelative = (then: number, now: number): string =>
    formatRelativeTime(then, now, {
        justNow: microcopyString(microcopy.notifications.relativeJustNow),
        oneMinute: microcopyString(microcopy.notifications.relativeOneMinute),
        minutes: microcopyString(microcopy.notifications.relativeMinutes),
        oneHour: microcopyString(microcopy.notifications.relativeOneHour),
        hours: microcopyString(microcopy.notifications.relativeHours),
        oneDay: microcopyString(microcopy.notifications.relativeOneDay),
        days: microcopyString(microcopy.notifications.relativeDays)
    });

/* ── Date bucketing (from ActivityFeedDrawer) ──────────────────────── */

type DateBucket = "today" | "yesterday" | "earlier";

const bucketFor = (timestamp: number, now: number): DateBucket => {
    const nowDate = new Date(now);
    const startOfNowDay = new Date(
        nowDate.getFullYear(),
        nowDate.getMonth(),
        nowDate.getDate()
    ).getTime();
    if (timestamp >= startOfNowDay) return "today";
    const startOfYesterday = startOfNowDay - 24 * 60 * 60 * 1000;
    if (timestamp >= startOfYesterday) return "yesterday";
    return "earlier";
};

const BUCKET_ORDER: DateBucket[] = ["today", "yesterday", "earlier"];

const BUCKET_LABEL: Record<DateBucket, string> = {
    today: microcopyString(microcopy.activityFeed.groupToday),
    yesterday: microcopyString(microcopy.activityFeed.groupYesterday),
    earlier: microcopyString(microcopy.activityFeed.groupEarlier)
};

const toEpochMs = (createdAt: string | undefined): number | null => {
    if (!createdAt) return null;
    const ms = Date.parse(createdAt);
    return Number.isNaN(ms) ? null : ms;
};

/* ── Bell trigger ──────────────────────────────────────────────────── */

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

interface UnifiedNotificationsBellProps {
    unreadCount: number;
    onClick: () => void;
}

export const UnifiedNotificationsBell: React.FC<
    UnifiedNotificationsBellProps
> = ({ unreadCount, onClick }) => {
    const ariaLabel =
        unreadCount === 0
            ? microcopyString(microcopy.unifiedNotifications.bellAriaLabelZero)
            : microcopyString(
                  unreadCount === 1
                      ? microcopy.unifiedNotifications.bellAriaLabelOne
                      : microcopy.unifiedNotifications.bellAriaLabelOther
              ).replace("{count}", String(unreadCount));
    return (
        <BellButton
            aria-label={ariaLabel}
            data-testid="unified-notifications-bell"
            onClick={onClick}
            type="button"
        >
            <Badge
                count={unreadCount}
                data-testid="unified-notifications-bell-badge"
                offset={[-2, 2]}
                size="small"
            >
                <BellOutlined aria-hidden style={{ fontSize: fontSize.md }} />
            </Badge>
        </BellButton>
    );
};

/* ── Drawer ────────────────────────────────────────────────────────── */

interface UnifiedNotificationsDrawerProps {
    open: boolean;
    onClose: () => void;
}

const UnifiedNotificationsDrawer: React.FC<UnifiedNotificationsDrawerProps> = ({
    open,
    onClose
}) => {
    const [activeTab, setActiveTab] = useState<UnifiedTab>("activity");

    /* ── Activity feed data ─────────────────────────────────────── */
    const { events, undo, isUndoable, markAllRead, markRead } =
        useActivityFeed();

    const [now, setNow] = useState<number>(() => Date.now());
    useEffect(() => {
        if (!open) return;
        const id = window.setInterval(() => setNow(Date.now()), 30_000);
        return () => window.clearInterval(id);
    }, [open]);
    useEffect(() => {
        if (open) setNow(Date.now());
    }, [open]);

    const eventsRef = useRef(events);
    eventsRef.current = events;
    const prevOpenRef = useRef(open);
    useEffect(() => {
        const wasOpen = prevOpenRef.current;
        prevOpenRef.current = open;
        if (!wasOpen || open) return;
        const ts = Date.now();
        eventsRef.current
            .filter((event) => !event.isRead && event.timestamp <= ts)
            .forEach((event) => markRead(event.id));
    }, [open, markRead]);

    const sortedEvents = useMemo(
        () => [...events].sort((a, b) => b.timestamp - a.timestamp),
        [events]
    );

    const buckets = useMemo(() => {
        const map = new Map<DateBucket, ActivityEvent[]>();
        for (const event of sortedEvents) {
            const bucket = bucketFor(event.timestamp, now);
            const list = map.get(bucket) ?? [];
            list.push(event);
            map.set(bucket, list);
        }
        return map;
    }, [sortedEvents, now]);

    const handleUndo = useCallback(
        async (id: string) => {
            await undo(id);
        },
        [undo]
    );

    /* ── Notifications data ─────────────────────────────────────── */
    const {
        notifications,
        markRead: markNotifRead,
        markAllRead: markAllNotifRead
    } = useNotifications();
    const notifList = useMemo(() => notifications ?? [], [notifications]);
    const allNotifRead = notifList.every((n) => n.isRead);

    const handleAlertRowClick = useCallback(
        (notification: INotification) => {
            if (notification.isRead) return;
            markNotifRead(notification._id);
        },
        [markNotifRead]
    );

    /* ── Tab options ────────────────────────────────────────────── */
    const tabOptions = useMemo(
        () => [
            {
                label: microcopyString(
                    microcopy.unifiedNotifications.tabActivity
                ),
                value: "activity" as UnifiedTab
            },
            {
                label: microcopyString(
                    microcopy.unifiedNotifications.tabAlerts
                ),
                value: "alerts" as UnifiedTab
            }
        ],
        []
    );

    const drawerTitle = microcopyString(
        microcopy.unifiedNotifications.drawerTitle
    );

    /* ── Activity tab body ──────────────────────────────────────── */
    const activityBody = (
        <PanelBody data-testid="unified-activity-panel">
            <SectionHeader>
                <Typography.Text strong style={{ fontSize: fontSize.sm }}>
                    {microcopyString(microcopy.activityFeed.drawerTitle)}
                </Typography.Text>
                <Button
                    aria-label={microcopyString(
                        microcopy.activityFeed.markAllReadAriaLabel
                    )}
                    data-testid="activity-feed-mark-all-read"
                    disabled={events.every((event) => event.isRead)}
                    icon={<CheckOutlined aria-hidden />}
                    onClick={markAllRead}
                    size="small"
                    type="text"
                >
                    {microcopyString(microcopy.activityFeed.markAllRead)}
                </Button>
            </SectionHeader>
            {events.length === 0 ? (
                <Empty
                    data-testid="activity-feed-empty"
                    description={microcopyString(microcopy.activityFeed.empty)}
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
            ) : (
                BUCKET_ORDER.map((bucket) => {
                    const list = buckets.get(bucket);
                    if (!list || list.length === 0) return null;
                    return (
                        <GroupSection
                            key={bucket}
                            data-testid={`activity-feed-group-${bucket}`}
                        >
                            <GroupHeading>{BUCKET_LABEL[bucket]}</GroupHeading>
                            <GroupList>
                                {list.map((event) => {
                                    const inUndoWindow =
                                        now - event.timestamp <= UNDO_WINDOW_MS;
                                    const showUndo =
                                        isUndoable(event.id) && inUndoWindow;
                                    return (
                                        <ActivityRow
                                            key={event.id}
                                            $unread={!event.isRead}
                                            data-testid="activity-feed-row"
                                            data-event-id={event.id}
                                            data-kind={event.kind}
                                            data-unread={
                                                event.isRead ? "no" : "yes"
                                            }
                                        >
                                            <RowIcon
                                                data-testid={`activity-feed-icon-${event.kind}`}
                                            >
                                                {KIND_ICON[event.kind]}
                                            </RowIcon>
                                            <RowBody>
                                                <RowSummary>
                                                    {event.summary}
                                                </RowSummary>
                                                <RowMeta>
                                                    {formatActivityRelative(
                                                        event.timestamp,
                                                        now
                                                    )}
                                                </RowMeta>
                                            </RowBody>
                                            {showUndo ? (
                                                <Button
                                                    aria-label={microcopyString(
                                                        microcopy.activityFeed
                                                            .undoAriaLabel
                                                    ).replace(
                                                        "{summary}",
                                                        event.summary
                                                    )}
                                                    data-testid="activity-feed-undo"
                                                    onClick={() =>
                                                        void handleUndo(
                                                            event.id
                                                        )
                                                    }
                                                    size="small"
                                                    type="text"
                                                >
                                                    {microcopyString(
                                                        microcopy.activityFeed
                                                            .undo
                                                    )}
                                                </Button>
                                            ) : null}
                                        </ActivityRow>
                                    );
                                })}
                            </GroupList>
                        </GroupSection>
                    );
                })
            )}
        </PanelBody>
    );

    /* ── Alerts tab body ────────────────────────────────────────── */
    const alertsBody = (
        <PanelBody data-testid="unified-alerts-panel">
            <SectionHeader>
                <Typography.Text strong style={{ fontSize: fontSize.sm }}>
                    {microcopyString(microcopy.notifications.drawerTitle)}
                </Typography.Text>
                <Button
                    aria-label={microcopyString(
                        microcopy.notifications.markAllReadAriaLabel
                    )}
                    data-testid="notification-mark-all-read"
                    disabled={allNotifRead}
                    icon={<CheckOutlined aria-hidden />}
                    onClick={markAllNotifRead}
                    size="small"
                    type="text"
                >
                    {microcopyString(microcopy.notifications.markAllRead)}
                </Button>
            </SectionHeader>
            {notifList.length === 0 ? (
                <Empty
                    data-testid="notification-empty"
                    description={microcopyString(microcopy.notifications.empty)}
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
            ) : (
                <AlertList>
                    {notifList.map((notification) => {
                        const ms = toEpochMs(notification.createdAt);
                        return (
                            <AlertRowLi key={notification._id}>
                                <AlertRowButton
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
                                    onClick={() =>
                                        handleAlertRowClick(notification)
                                    }
                                    type="button"
                                >
                                    {notification.isRead ? (
                                        <ReadSpacer aria-hidden />
                                    ) : (
                                        <UnreadDot aria-hidden />
                                    )}
                                    <AlertRowBody>
                                        <RowSummary>
                                            {notification.summary}
                                        </RowSummary>
                                        {ms !== null && (
                                            <RowMeta>
                                                {formatAlertRelative(ms, now)}
                                            </RowMeta>
                                        )}
                                    </AlertRowBody>
                                </AlertRowButton>
                            </AlertRowLi>
                        );
                    })}
                </AlertList>
            )}
        </PanelBody>
    );

    return (
        <Sheet
            closable
            data-testid="unified-notifications-drawer"
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
            <div data-testid="unified-notifications-drawer-body">
                <TabBar>
                    <Segmented
                        block
                        data-testid="unified-notifications-tabs"
                        options={tabOptions}
                        value={activeTab}
                        onChange={(val) => setActiveTab(val as UnifiedTab)}
                    />
                </TabBar>
                {activeTab === "activity" ? activityBody : alertsBody}
            </div>
        </Sheet>
    );
};

export default UnifiedNotificationsDrawer;
