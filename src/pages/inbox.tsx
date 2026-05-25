import {
    FolderOpenOutlined,
    ProjectOutlined,
    RobotOutlined,
    UnorderedListOutlined
} from "@ant-design/icons";
import styled from "@emotion/styled";
import { Typography } from "antd";
import React, { useEffect, useMemo, useRef } from "react";

import EmptyState from "../components/emptyState";
import PageContainer from "../components/pageContainer";
import SettingsSection from "../components/settingsSection";
import { microcopy, microcopyString } from "../constants/microcopy";
import { fontSize, fontWeight, lineHeight, space } from "../theme/tokens";
import useActivityFeed, {
    type ActivityEvent
} from "../utils/hooks/useActivityFeed";
import useTitle, { composeBrandedTitle } from "../utils/hooks/useTitle";

/**
 * Inbox page (Phase 6 Wave 7). The standalone Inbox surface presents an
 * iOS-26 grouped three-section layout — Triage, Mentions, Activity —
 * reusing the `SettingsSection` grouped-table primitive (uppercase
 * header + opaque rounded group + inset hairline dividers) so the page
 * speaks the same visual language as the settings surface.
 *
 * Only Activity carries real data: the session-only `useActivityFeed`
 * log (task / column / project / AI changes), rendered with the same
 * row presentation as the activity drawer — a per-kind icon, the event
 * summary, and a relative timestamp. Triage and Mentions are honest
 * structural empty-states: triage nudges surface on each board's
 * Copilot (no board context exists on this standalone page) and there
 * is no mentions data model yet.
 *
 * All-empty UX: a fresh inbox with no Activity events does NOT render
 * three sad empty sections — it falls back to the single page-level
 * `EmptyState`. Once Activity has at least one event, the grouped
 * sections render (with Triage / Mentions showing their empty copy).
 */

/*
 * Per-kind leading glyph. Mirrors the activity drawer's `KIND_ICON`
 * map (the drawer keeps it module-private, so we re-state it here rather
 * than reach across the module boundary) so the two surfaces present
 * the same event taxonomy.
 */
const KIND_ICON: Record<ActivityEvent["kind"], React.ReactNode> = {
    task: <UnorderedListOutlined aria-hidden />,
    column: <FolderOpenOutlined aria-hidden />,
    project: <ProjectOutlined aria-hidden />,
    ai: <RobotOutlined aria-hidden />
};

/**
 * Localized relative-time formatter. Mirrors the activity drawer's
 * `formatRelative` (and, transitively, the AI activity-log helper) so
 * the surfaces speak the same temporal language; the strings live under
 * `microcopy.activityFeed.relative*`.
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
     * All-empty fallback: with no Activity events (Triage / Mentions are
     * always structurally empty here) we render the single page-level
     * empty state rather than three sad empty sections.
     */
    if (sortedEvents.length === 0) {
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
                    data-testid="inbox-section-triage"
                    header={microcopy.inbox.sections.triage.title}
                >
                    <SectionEmpty data-testid="inbox-triage-empty">
                        {microcopy.inbox.sections.triage.empty}
                    </SectionEmpty>
                </SettingsSection>
                <SettingsSection
                    data-testid="inbox-section-mentions"
                    header={microcopy.inbox.sections.mentions.title}
                >
                    <SectionEmpty data-testid="inbox-mentions-empty">
                        {microcopy.inbox.sections.mentions.empty}
                    </SectionEmpty>
                </SettingsSection>
                <SettingsSection
                    data-testid="inbox-section-activity"
                    header={microcopy.inbox.sections.activity.title}
                >
                    {sortedEvents.map((event) => (
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
                    ))}
                </SettingsSection>
            </SectionStack>
        </PageContainer>
    );
};

export default InboxPage;
