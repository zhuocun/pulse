import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router";

import { Typography } from "@/components/ui/typography";
import { KIND_ICON } from "../components/activityKindIcon";
import EmptyState from "../components/emptyState";
import PageContainer from "../components/pageContainer";
import SettingsSection from "../components/settingsSection";
import { microcopy, microcopyString } from "../constants/microcopy";
import { formatRelativeTime } from "../utils/formatRelativeTime";
import useActivityFeed from "../utils/hooks/useActivityFeed";
import useNotifications from "../utils/hooks/useNotifications";
import useTitle, { composeBrandedTitle } from "../utils/hooks/useTitle";

/**
 * Inbox page (Phase 6 Wave 7). The standalone Inbox surface presents an
 * iOS-26 grouped three-section layout — Triage, Mentions, Activity —
 * reusing the `SettingsSection` grouped-table primitive (uppercase
 * header + opaque rounded group + inset hairline dividers) so the page
 * speaks the same visual language as the settings surface.
 *
 * Activity carries the session-only `useActivityFeed` log (task / column
 * / project / AI changes), rendered with the same row presentation as the
 * activity drawer — a per-kind icon, the event summary, and a relative
 * timestamp. Mentions carries the server's `kind === "mention"`
 * notifications (`useNotifications`), each rendered with its summary and a
 * link to the referenced task's board. Triage stays an honest structural
 * empty-state: triage nudges surface on each board's Copilot, and no
 * board context exists on this standalone page.
 *
 * All-empty UX: a fresh inbox with no Activity events AND no mentions does
 * NOT render three sad empty sections — it falls back to the single
 * page-level `EmptyState`. Once Activity or Mentions has at least one
 * entry, the grouped sections render (with the empty sections showing
 * their quiet empty copy).
 */

/**
 * Localized relative-time formatter. Delegates to the shared
 * `formatRelativeTime` util, reading the copy from
 * `microcopy.activityFeed.relative*` (through `microcopyString`) so the
 * Inbox and the activity drawer speak the same temporal language. The
 * Proxy reads stay at this call site so a locale switch propagates.
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

const PAGE_HEADING = "mb-lg text-xxl font-semibold leading-tight";

/*
 * Event / mention rows share the activity drawer's anatomy — a leading
 * kind icon and a stacked body (summary + relative time) — sized to the
 * grouped-table rhythm. The mention row is the whole `<Link>` target, so
 * on coarse pointers it lifts to the 44px touch floor (WCAG 2.5.8).
 */
const ROW_LAYOUT = "flex w-full items-start gap-sm px-md py-sm";
const MENTION_LINK = `${ROW_LAYOUT} text-inherit no-underline hover:bg-[var(--pulse-bg-text-hover)] focus-visible:bg-[var(--pulse-bg-text-hover)] coarse:min-h-[44px]`;

const InboxPage = () => {
    useTitle(composeBrandedTitle(microcopy.pageTitle.inbox), false);

    const { events, markAllRead, unreadCount } = useActivityFeed();
    const { notifications } = useNotifications();

    /*
     * Mentions section data — the server's `kind === "mention"`
     * notifications, newest first. The backend already returns the
     * caller's notifications newest-first, so no re-sort is needed; we
     * filter defensively in a memo so the list identity is stable across
     * renders that don't change the underlying notifications.
     */
    const mentions = useMemo(
        () =>
            (notifications ?? []).filter(
                (notification) => notification.kind === "mention"
            ),
        [notifications]
    );

    /*
     * Mark-as-read on view (mirrors the drawer's mark-read-on-close):
     * viewing the inbox clears the unread badge for whatever was already
     * in the feed. We fire a one-shot sweep on mount when there are
     * unread rows — `markAllRead()` is an idempotent Redux dispatch, and
     * gating on `unreadCount` avoids a no-op dispatch on a feed that's
     * already all-read. We deliberately keep this simple (no per-row
     * undo UI, no close-time snapshot): the page is a session-scoped
     * read surface, not the authoritative undo surface.
     */
    const didSweep = useRef(false);
    useEffect(() => {
        if (didSweep.current) return;
        if (unreadCount > 0) {
            didSweep.current = true;
            markAllRead();
        }
    }, [markAllRead, unreadCount]);

    /*
     * Stable wall-clock for the relative timestamps. The inbox is a
     * static read surface (no live ticker like the drawer), so a single
     * read at render time is enough — we don't re-tick the relative
     * strings while the page sits open.
     */
    const now = useMemo(() => Date.now(), []);

    const sortedEvents = useMemo(
        () => [...events].sort((a, b) => b.timestamp - a.timestamp),
        [events]
    );

    /*
     * All-empty fallback: with no Activity events AND no mentions (Triage
     * is always structurally empty here) we render the single page-level
     * empty state rather than three sad empty sections.
     */
    if (sortedEvents.length === 0 && mentions.length === 0) {
        return (
            <PageContainer>
                <Typography.Title className={PAGE_HEADING} level={1}>
                    {microcopy.inbox.heading}
                </Typography.Title>
                <EmptyState
                    data-testid="inbox-empty-state"
                    description={microcopy.inbox.emptyDescription}
                    headingLevel={2}
                    title={microcopy.inbox.emptyTitle}
                    variant="tasks"
                />
            </PageContainer>
        );
    }

    return (
        <PageContainer>
            <Typography.Title className={PAGE_HEADING} level={1}>
                {microcopy.inbox.heading}
            </Typography.Title>
            {/*
             * The grouped sections cap their width and centre on desktop so
             * the rows don't sprawl across an ultra-wide monitor — the route
             * is reachable everywhere even though the bottom tab bar that
             * links it is phone-only. `PageContainer` supplies the gutters.
             */}
            <div className="mx-auto flex max-w-[40rem] flex-col">
                <SettingsSection
                    data-testid="inbox-section-mentions"
                    header={microcopy.inbox.sections.mentions.title}
                >
                    {mentions.length === 0 ? (
                        <div
                            className="w-full px-md py-sm text-sm leading-normal text-[color:var(--pulse-text-secondary)]"
                            data-testid="inbox-mentions-empty"
                        >
                            {microcopy.inbox.sections.mentions.empty}
                        </div>
                    ) : (
                        mentions.map((mention) => {
                            const summary =
                                mention.summary?.trim() ||
                                microcopyString(
                                    microcopy.inbox.sections.mentions.empty
                                );
                            const body = (
                                <>
                                    <div className="flex min-w-0 flex-auto flex-col gap-0.5">
                                        <Typography.Text className="text-sm break-words">
                                            {summary}
                                        </Typography.Text>
                                    </div>
                                    {mention.projectId && (
                                        <span
                                            aria-hidden
                                            className="flex-none text-sm text-[color:var(--pulse-link)]"
                                        >
                                            {
                                                microcopy.inbox.sections
                                                    .mentions.viewTask
                                            }
                                        </span>
                                    )}
                                </>
                            );
                            return mention.projectId ? (
                                <Link
                                    key={mention._id}
                                    aria-label={microcopyString(
                                        microcopy.inbox.sections.mentions
                                            .itemAriaLabel
                                    ).replace("{summary}", summary)}
                                    className={MENTION_LINK}
                                    data-mention-id={mention._id}
                                    data-ref-id={mention.refId}
                                    data-testid="inbox-mention-row"
                                    to={`/projects/${mention.projectId}/board`}
                                >
                                    {body}
                                </Link>
                            ) : (
                                <div
                                    key={mention._id}
                                    className={ROW_LAYOUT}
                                    data-mention-id={mention._id}
                                    data-ref-id={mention.refId}
                                    data-testid="inbox-mention-row"
                                >
                                    {body}
                                </div>
                            );
                        })
                    )}
                </SettingsSection>
                <SettingsSection
                    data-testid="inbox-section-activity"
                    header={microcopy.inbox.sections.activity.title}
                >
                    {sortedEvents.length === 0 ? (
                        <div
                            className="w-full px-md py-sm text-sm leading-normal text-[color:var(--pulse-text-secondary)]"
                            data-testid="inbox-activity-empty"
                        >
                            {microcopy.activityFeed.empty}
                        </div>
                    ) : (
                        sortedEvents.map((event) => (
                            <div
                                key={event.id}
                                className={ROW_LAYOUT}
                                data-event-id={event.id}
                                data-kind={event.kind}
                                data-testid="inbox-activity-row"
                            >
                                <span
                                    className="inline-flex h-6 w-6 flex-none items-center justify-center text-md text-[color:var(--pulse-text-secondary)]"
                                    data-testid={`inbox-activity-icon-${event.kind}`}
                                >
                                    {KIND_ICON[event.kind]}
                                </span>
                                <div className="flex min-w-0 flex-auto flex-col gap-0.5">
                                    <Typography.Text className="text-sm break-words">
                                        {event.summary}
                                    </Typography.Text>
                                    <Typography.Text className="text-xs text-[color:var(--pulse-text-tertiary)]">
                                        {formatRelative(event.timestamp, now)}
                                    </Typography.Text>
                                </div>
                            </div>
                        ))
                    )}
                </SettingsSection>
            </div>
        </PageContainer>
    );
};

export default InboxPage;
