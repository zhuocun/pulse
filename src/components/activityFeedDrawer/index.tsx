import { Check, History } from "lucide-react";
import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from "react";

import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import { microcopy, microcopyString } from "../../constants/microcopy";
import { space } from "../../theme/tokens";
import { formatRelativeTime } from "../../utils/formatRelativeTime";
import useActivityFeed, {
    type ActivityEvent
} from "../../utils/hooks/useActivityFeed";
import { KIND_ICON } from "../activityKindIcon";
import Sheet from "../sheet";

/**
 * Phase 4.3 — Activity / notifications drawer.
 *
 * Surface that pairs with the bell icon in the header. Renders the
 * `useActivityFeed` events grouped by date bucket (Today / Yesterday /
 * Earlier), with an Undo button beside any row that still has a live
 * closure AND is inside the 10-second undo window. Mark-all-read at
 * the top, empty state when the feed is empty. Phase 6 Wave 3 migrated
 * the placement / chrome split off the local `useIsPhoneChrome` call
 * onto the shared `<Sheet>` primitive — on phone the sheet animates
 * between medium / large detents, on desktop / tablet it renders the
 * existing right-shelf AntD `<Drawer>` (mirroring `CopilotDockShell`
 * and `aiActivityLog`'s placement choices).
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

/**
 * Localized relative-time formatter. Delegates to the shared
 * `formatRelativeTime` util, reading the copy from
 * `microcopy.activityFeed.relative*` (through `microcopyString`) so the
 * drawer and the Inbox speak the same temporal language. The Proxy reads
 * stay at this call site so a locale switch propagates on the next tick.
 */
const formatRelative = (then: number, now: number): string =>
    formatRelativeTime(then, now, {
        justNow: microcopyString(microcopy.activityFeed.relativeJustNow),
        oneMinute: microcopyString(microcopy.activityFeed.relativeOneMinute),
        minutes: microcopyString(microcopy.activityFeed.relativeMinutes),
        oneHour: microcopyString(microcopy.activityFeed.relativeOneHour),
        hours: microcopyString(microcopy.activityFeed.relativeHours),
        oneDay: microcopyString(microcopy.activityFeed.relativeOneDay),
        days: microcopyString(microcopy.activityFeed.relativeDays)
    });

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
            <div className="flex items-center justify-between gap-xs pb-xs">
                <Typography.Text className="text-sm" strong>
                    {drawerTitle}
                </Typography.Text>
                <Button
                    aria-label={microcopyString(
                        microcopy.activityFeed.markAllReadAriaLabel
                    )}
                    data-testid="activity-feed-mark-all-read"
                    disabled={events.every((event) => event.isRead)}
                    onClick={markAllRead}
                    size="sm"
                    variant="ghost"
                >
                    <Check aria-hidden />
                    {microcopyString(microcopy.activityFeed.markAllRead)}
                </Button>
            </div>
            {events.length === 0 ? (
                <Empty
                    data-testid="activity-feed-empty"
                    description={microcopyString(microcopy.activityFeed.empty)}
                />
            ) : (
                BUCKET_ORDER.map((bucket) => {
                    const list = buckets.get(bucket);
                    if (!list || list.length === 0) return null;
                    return (
                        <section
                            className="mt-md flex flex-col gap-xs first-of-type:mt-0"
                            key={bucket}
                            data-testid={`activity-feed-group-${bucket}`}
                        >
                            <Typography.Text className="text-xs font-semibold [color:var(--ant-color-text-tertiary,rgba(15,23,42,0.5))]">
                                {BUCKET_LABEL[bucket]}
                            </Typography.Text>
                            <ul className="m-0 flex list-none flex-col gap-xxs p-0">
                                {list.map((event) => {
                                    const inUndoWindow =
                                        now - event.timestamp <= UNDO_WINDOW_MS;
                                    const showUndo =
                                        isUndoable(event.id) && inUndoWindow;
                                    return (
                                        <li
                                            className={cn(
                                                "flex items-start gap-xs rounded-md px-sm py-xs",
                                                event.isRead
                                                    ? "bg-transparent"
                                                    : "[background:var(--ant-color-primary-bg,rgba(234,88,12,0.06))]"
                                            )}
                                            key={event.id}
                                            data-testid="activity-feed-row"
                                            data-event-id={event.id}
                                            data-kind={event.kind}
                                            data-unread={
                                                event.isRead ? "no" : "yes"
                                            }
                                        >
                                            <span
                                                className="inline-flex size-6 flex-none items-center justify-center text-md [color:var(--ant-color-text-secondary,rgba(15,23,42,0.6))]"
                                                data-testid={`activity-feed-icon-${event.kind}`}
                                            >
                                                {KIND_ICON[event.kind]}
                                            </span>
                                            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                                                <Typography.Text className="text-sm break-words">
                                                    {event.summary}
                                                </Typography.Text>
                                                <Typography.Text className="text-xs [color:var(--ant-color-text-tertiary,rgba(15,23,42,0.45))]">
                                                    {formatRelative(
                                                        event.timestamp,
                                                        now
                                                    )}
                                                </Typography.Text>
                                            </div>
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
                                                    size="sm"
                                                    variant="ghost"
                                                >
                                                    {microcopyString(
                                                        microcopy.activityFeed
                                                            .undo
                                                    )}
                                                </Button>
                                            ) : null}
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    );
                })
            )}
        </div>
    );

    return (
        <Sheet
            closable
            data-testid="activity-feed-drawer"
            defaultDetent="medium"
            detents={["medium", "large"]}
            /*
             * The Sheet primitive handles the phone vs desktop split
             * internally via useIsPhoneChrome (Phase 6 Wave 3). On
             * phone it ships a multi-detent animated surface; on
             * desktop it renders an AntD Drawer at `desktopPlacement`.
             * `desktopSize="default"` mirrors the previous Drawer
             * sizing (~378 px right shelf).
             */
            desktopPlacement="right"
            desktopSize="default"
            closeAriaLabel={microcopyString(
                microcopy.activityFeed.drawerCloseLabel
            )}
            onClose={onClose}
            open={open}
            styles={{
                body: {
                    paddingBottom: `max(${space.lg}px, env(safe-area-inset-bottom))`
                }
            }}
            title={
                <span className="inline-flex items-center gap-xs">
                    <History aria-hidden className="size-4" />
                    {drawerTitle}
                </span>
            }
        >
            {body}
        </Sheet>
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
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border-none bg-transparent p-0 cursor-pointer [color:var(--ant-color-text-secondary,rgba(15,23,42,0.65))] coarse:h-[44px] coarse:w-[44px]"
            data-testid="activity-feed-bell"
            onClick={onClick}
            type="button"
        >
            <span className="relative inline-flex">
                <History aria-hidden className="size-[18px]" />
                {unreadCount > 0 ? (
                    <span
                        aria-hidden
                        className="pointer-events-none absolute -right-[6px] -top-[6px] inline-flex min-w-4 items-center justify-center rounded-pill bg-destructive px-[4px] text-[10px] font-semibold leading-4 text-destructive-foreground"
                        data-testid="activity-feed-bell-badge"
                    >
                        {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                ) : null}
            </span>
        </button>
    );
};

export default ActivityFeedDrawer;
