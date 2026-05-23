import {
    BellOutlined,
    CheckOutlined,
    FolderOpenOutlined,
    ProjectOutlined,
    RobotOutlined,
    UnorderedListOutlined
} from "@ant-design/icons";
import styled from "@emotion/styled";
import { Badge, Button, Drawer, Empty, Typography } from "antd";
import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from "react";

import { microcopy, microcopyString } from "../../constants/microcopy";
import { fontSize, fontWeight, radius, space } from "../../theme/tokens";
import useActivityFeed, {
    type ActivityEvent
} from "../../utils/hooks/useActivityFeed";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";

/**
 * Phase 4.3 — Activity / notifications drawer.
 *
 * Surface that pairs with the bell icon in the header. Renders the
 * `useActivityFeed` events grouped by date bucket (Today / Yesterday /
 * Earlier), with an Undo button beside any row that still has a live
 * closure AND is inside the 10-second undo window. Mark-all-read at the
 * top, empty state when the feed is empty, and the existing
 * `useIsPhoneChrome` predicate decides between a right-side desktop
 * drawer and a bottom sheet on phones (mirroring `CopilotDockShell` and
 * `aiActivityLog`'s placement choices).
 *
 * Mark-as-read semantics: closing the drawer marks ONLY the events that
 * were visible AND unread when the drawer was closed as read. We
 * intentionally do NOT mark every entry as read on close — an entry
 * recorded WHILE the drawer is open (e.g. an AI mutation accepted in
 * the same tick) stays unread so the bell badge still surfaces it after
 * the user closes the drawer. The dedicated "Mark all as read" button
 * gives the user an explicit zero-the-badge gesture independent of
 * close. (See ui-todo.md §Phase 4.3.)
 */

/**
 * 10-second undo window. Past this point the row still appears in the
 * feed (so users have an audit trail) but the Undo button is hidden so
 * the user can't accidentally revert state changes they've moved on
 * from. AI rows additionally respect `useAiLedger`'s revertable Map,
 * which has its own lifecycle.
 */
const UNDO_WINDOW_MS = 10_000;

const KIND_ICON: Record<ActivityEvent["kind"], React.ReactNode> = {
    task: <UnorderedListOutlined aria-hidden />,
    column: <FolderOpenOutlined aria-hidden />,
    project: <ProjectOutlined aria-hidden />,
    ai: <RobotOutlined aria-hidden />
};

const DrawerHeader = styled.div`
    align-items: center;
    display: flex;
    gap: ${space.xs}px;
    justify-content: space-between;
    padding-bottom: ${space.xs}px;
`;

const GroupHeading = styled(Typography.Text)`
    && {
        color: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.5));
        font-size: ${fontSize.xs}px;
        font-weight: ${fontWeight.semibold};
        letter-spacing: 0.04em;
        text-transform: uppercase;
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

const Row = styled.li<{ $unread: boolean }>`
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

/**
 * Localized relative-time formatter. Mirrors the AI activity-log helper
 * so the two surfaces speak the same temporal language; the strings are
 * scoped to `activityFeed.relative*` so future tuning is local.
 */
const formatRelative = (then: number, now: number): string => {
    const seconds = Math.max(0, Math.round((now - then) / 1000));
    if (seconds < 30)
        return microcopyString(microcopy.activityFeed.relativeJustNow);
    if (seconds < 90)
        return microcopyString(microcopy.activityFeed.relativeOneMinute);
    const minutes = Math.round(seconds / 60);
    if (minutes < 60)
        return microcopyString(microcopy.activityFeed.relativeMinutes).replace(
            "{count}",
            String(minutes)
        );
    const hours = Math.round(minutes / 60);
    if (hours < 24)
        return hours === 1
            ? microcopyString(microcopy.activityFeed.relativeOneHour)
            : microcopyString(microcopy.activityFeed.relativeHours).replace(
                  "{count}",
                  String(hours)
              );
    const days = Math.round(hours / 24);
    return days === 1
        ? microcopyString(microcopy.activityFeed.relativeOneDay)
        : microcopyString(microcopy.activityFeed.relativeDays).replace(
              "{count}",
              String(days)
          );
};

/**
 * Date bucketing helper.
 *
 * Judgment call: we collapse the spec's "Today / Yesterday / Earlier
 * this week" into "Today / Yesterday / Earlier" because the feed caps at
 * 50 entries and a session-scoped log doesn't usually span multiple
 * weeks — adding a fourth "Earlier this month" bucket would render an
 * empty heading for every session that lasts under a week. The boundary
 * is local-midnight relative to `now` so timezone changes are stable
 * across renders.
 */
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

interface ActivityFeedDrawerProps {
    open: boolean;
    onClose: () => void;
}

const ActivityFeedDrawer: React.FC<ActivityFeedDrawerProps> = ({
    open,
    onClose
}) => {
    const { events, undo, isUndoable, markAllRead, markRead } =
        useActivityFeed();
    const isPhone = useIsPhoneChrome();
    /*
     * `now` ticks every 30 s while the drawer is open so the relative
     * timestamps stay fresh and the per-row undo-window expiration
     * re-renders when the 10 s elapses. The interval only runs while
     * the drawer is open to avoid background work in the header chrome.
     */
    const [now, setNow] = useState<number>(() => Date.now());
    useEffect(() => {
        if (!open) return;
        const id = window.setInterval(() => setNow(Date.now()), 30_000);
        return () => window.clearInterval(id);
    }, [open]);
    // Bump `now` on each open so the first render after a re-open
    // reflects the live wall clock without waiting 30 s.
    useEffect(() => {
        if (open) setNow(Date.now());
    }, [open]);

    /*
     * Mark-as-read on close. Capture the unread ids visible at close-
     * time only — events that arrive AFTER close stay unread so the
     * bell badge surfaces them on the next session. This preserves the
     * "open the drawer ≈ read what was there" semantics without
     * silently dismissing entries arriving in parallel.
     */
    /*
     * Keep the latest events snapshot in a ref so the close-transition
     * effect can read it WITHOUT subscribing to it (the effect must run
     * once per close, not on every events change while closed).
     */
    const eventsRef = useRef(events);
    eventsRef.current = events;
    /*
     * `prevOpenRef` tracks the previous `open` value across renders so
     * we can detect the transition (open → closed) and only fire the
     * mark-as-read sweep on that edge. A naive `useEffect` deps array
     * with `[open]` would also fire on mount when the drawer renders
     * in its initial-closed state, which would silently mark every
     * pre-existing entry as read.
     */
    const prevOpenRef = useRef(open);
    useEffect(() => {
        const wasOpen = prevOpenRef.current;
        prevOpenRef.current = open;
        if (!wasOpen || open) return;
        // Open → closed transition. Snapshot the events at this tick
        // and mark every unread row whose timestamp is at or before
        // now as read. Events arriving AFTER this tick stay unread.
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

    const drawerTitle = microcopyString(microcopy.activityFeed.drawerTitle);

    const body = (
        <div data-testid="activity-feed-drawer-body">
            <DrawerHeader>
                <Typography.Text strong style={{ fontSize: fontSize.sm }}>
                    {drawerTitle}
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
            </DrawerHeader>
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
                                        <Row
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
                                                    {formatRelative(
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
                                        </Row>
                                    );
                                })}
                            </GroupList>
                        </GroupSection>
                    );
                })
            )}
        </div>
    );

    return (
        <Drawer
            closable
            data-testid="activity-feed-drawer"
            onClose={onClose}
            open={open}
            placement={isPhone ? "bottom" : "right"}
            /*
             * AntD's `size="default"` resolves to ~378 px on right
             * placement and a sensible vh-bounded sheet on bottom
             * placement; that's the right baseline for the activity
             * feed so we lean on the size token rather than emitting a
             * separate `width=` (AntD now warns when both are present).
             */
            size="default"
            title={
                <span>
                    <BellOutlined aria-hidden style={{ marginInlineEnd: 8 }} />
                    {drawerTitle}
                </span>
            }
        >
            {body}
        </Drawer>
    );
};

interface BellTriggerProps {
    /**
     * Imperative wrapper for the bell icon. The header renders this and
     * wires the open/close state itself so the drawer body can mount
     * once at the layout level (matching `CopilotDock` host pattern).
     */
    unreadCount: number;
    onClick: () => void;
}

/**
 * Bell-icon button used by the header. The accessible name follows the
 * one/other plural pattern documented in `aiActivityLog`: pick the right
 * microcopy key off the count and `.replace("{count}", String(count))` —
 * we deliberately avoid literal ICU plural syntax because the codebase
 * has no formatter and the literal would read out to screen readers.
 */
export const ActivityFeedBell: React.FC<BellTriggerProps> = ({
    unreadCount,
    onClick
}) => {
    const ariaLabel =
        unreadCount === 0
            ? microcopyString(microcopy.activityFeed.bellAriaLabelZero)
            : microcopyString(
                  unreadCount === 1
                      ? microcopy.activityFeed.bellAriaLabelOne
                      : microcopy.activityFeed.bellAriaLabelOther
              ).replace("{count}", String(unreadCount));
    return (
        <button
            aria-label={ariaLabel}
            data-testid="activity-feed-bell"
            onClick={onClick}
            type="button"
            style={{
                alignItems: "center",
                background: "transparent",
                border: "none",
                borderRadius: radius.md,
                color: "var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65))",
                cursor: "pointer",
                display: "inline-flex",
                height: 36,
                justifyContent: "center",
                padding: 0,
                width: 36
            }}
        >
            <Badge
                count={unreadCount}
                data-testid="activity-feed-bell-badge"
                offset={[-2, 2]}
                size="small"
            >
                <BellOutlined aria-hidden style={{ fontSize: fontSize.md }} />
            </Badge>
        </button>
    );
};

export default ActivityFeedDrawer;
