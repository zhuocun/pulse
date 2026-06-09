import styled from "@emotion/styled";
import { Typography } from "antd";
import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router";

import { KIND_ICON } from "../components/activityKindIcon";
import EmptyState from "../components/emptyState";
import PageContainer from "../components/pageContainer";
import SettingsSection from "../components/settingsSection";
import { microcopy, microcopyString } from "../constants/microcopy";
import { fontSize, fontWeight, lineHeight, space } from "../theme/tokens";
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

const PageHeading = styled(Typography.Title)`
    && {
        font-size: ${fontSize.xxl}px;
        font-weight: ${fontWeight.semibold};
        line-height: ${lineHeight.tight};
        margin-bottom: ${space.lg}px;
    }
`;

/*
 * Single event row, presented inside a `SettingsSection` slot. Matches
 * the activity drawer's row anatomy — a leading kind icon, a stacked
 * body (summary + relative time) — sized to the grouped-table rhythm.
 */
const EventRow = styled.div`
    align-items: flex-start;
    display: flex;
    gap: ${space.sm}px;
    padding: ${space.sm}px ${space.md}px;
    width: 100%;
`;

const EventIcon = styled.span`
    align-items: center;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
    display: inline-flex;
    flex: 0 0 auto;
    font-size: ${fontSize.md}px;
    height: 24px;
    justify-content: center;
    width: 24px;
`;

const EventBody = styled.div`
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
`;

const EventSummary = styled(Typography.Text)`
    && {
        font-size: ${fontSize.sm}px;
        word-break: break-word;
    }
`;

const EventMeta = styled(Typography.Text)`
    && {
        color: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.45));
        font-size: ${fontSize.xs}px;
    }
`;

/*
 * Empty-section body. Triage and Mentions render a single quiet line of
 * copy inside the same rounded group as a real row, so a structurally
 * empty section still reads as a deliberate grouped surface rather than
 * a broken/blank one.
 */
const SectionEmpty = styled.div`
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
    font-size: ${fontSize.sm}px;
    line-height: ${lineHeight.normal};
    padding: ${space.sm}px ${space.md}px;
    width: 100%;
`;

/*
 * A single mention row. When the mention carries a `projectId` the whole
 * row is a router `<Link>` to that project's board (the always-valid task
 * landing — the routed task-panel deep link is flag-gated, the board is
 * not); without one it degrades to a plain row. Reuses the activity row's
 * body anatomy (summary + a quiet sub-line) so the two sections share a
 * visual rhythm.
 */
const mentionRowStyles = `
    align-items: flex-start;
    display: flex;
    gap: ${space.sm}px;
    padding: ${space.sm}px ${space.md}px;
    text-decoration: none;
    width: 100%;
`;

const MentionRow = styled.div`
    ${mentionRowStyles}
`;

const MentionLink = styled(Link)`
    ${mentionRowStyles}
    color: inherit;

    &:hover,
    &:focus-visible {
        background: var(--ant-color-bg-text-hover, rgba(15, 23, 42, 0.05));
    }
`;

const MentionAction = styled.span`
    color: var(--ant-color-link, #1677ff);
    flex: 0 0 auto;
    font-size: ${fontSize.sm}px;
`;

/*
 * The grouped sections cap their width and centre on desktop so the
 * rows don't sprawl across an ultra-wide monitor — the route is
 * reachable everywhere even though the bottom tab bar that links it is
 * phone-only. `PageContainer` already supplies the page gutters.
 */
const SectionStack = styled.div`
    display: flex;
    flex-direction: column;
    margin-inline: auto;
    max-width: 40rem;
`;

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
                <PageHeading level={1}>{microcopy.inbox.heading}</PageHeading>
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
            <PageHeading level={1}>{microcopy.inbox.heading}</PageHeading>
            <SectionStack>
                <SettingsSection
                    data-testid="inbox-section-mentions"
                    header={microcopy.inbox.sections.mentions.title}
                >
                    {mentions.length === 0 ? (
                        <SectionEmpty data-testid="inbox-mentions-empty">
                            {microcopy.inbox.sections.mentions.empty}
                        </SectionEmpty>
                    ) : (
                        mentions.map((mention) => {
                            const summary =
                                mention.summary?.trim() ||
                                microcopyString(
                                    microcopy.inbox.sections.mentions.empty
                                );
                            const body = (
                                <>
                                    <EventBody>
                                        <EventSummary>{summary}</EventSummary>
                                    </EventBody>
                                    {mention.projectId && (
                                        <MentionAction aria-hidden>
                                            {
                                                microcopy.inbox.sections
                                                    .mentions.viewTask
                                            }
                                        </MentionAction>
                                    )}
                                </>
                            );
                            return mention.projectId ? (
                                <MentionLink
                                    key={mention._id}
                                    aria-label={microcopyString(
                                        microcopy.inbox.sections.mentions
                                            .itemAriaLabel
                                    ).replace("{summary}", summary)}
                                    data-mention-id={mention._id}
                                    data-ref-id={mention.refId}
                                    data-testid="inbox-mention-row"
                                    to={`/projects/${mention.projectId}/board`}
                                >
                                    {body}
                                </MentionLink>
                            ) : (
                                <MentionRow
                                    key={mention._id}
                                    data-mention-id={mention._id}
                                    data-ref-id={mention.refId}
                                    data-testid="inbox-mention-row"
                                >
                                    {body}
                                </MentionRow>
                            );
                        })
                    )}
                </SettingsSection>
                <SettingsSection
                    data-testid="inbox-section-activity"
                    header={microcopy.inbox.sections.activity.title}
                >
                    {sortedEvents.length === 0 ? (
                        <SectionEmpty data-testid="inbox-activity-empty">
                            {microcopy.activityFeed.empty}
                        </SectionEmpty>
                    ) : (
                        sortedEvents.map((event) => (
                        <EventRow
                            key={event.id}
                            data-event-id={event.id}
                            data-kind={event.kind}
                            data-testid="inbox-activity-row"
                        >
                            <EventIcon
                                data-testid={`inbox-activity-icon-${event.kind}`}
                            >
                                {KIND_ICON[event.kind]}
                            </EventIcon>
                            <EventBody>
                                <EventSummary>{event.summary}</EventSummary>
                                <EventMeta>
                                    {formatRelative(event.timestamp, now)}
                                </EventMeta>
                            </EventBody>
                        </EventRow>
                        ))
                    )}
                </SettingsSection>
            </SectionStack>
        </PageContainer>
    );
};

export default InboxPage;
