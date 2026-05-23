/**
 * Analytics event names used by Board Copilot v2.1 (PRD §10 metrics M1-M15).
 *
 * The constants live in one module so a future analytics sink (Segment,
 * PostHog, in-house) only needs to map the union once. `track` is a no-op
 * stub: production code can re-implement it via a side channel without
 * changing call sites.
 */
export const ANALYTICS_EVENTS = {
    AGENT_TURN_STARTED: "agent.turn.started",
    AGENT_TURN_COMPLETED: "agent.turn.completed",
    AGENT_PROPOSAL_ACCEPTED: "agent.proposal.accepted",
    AGENT_PROPOSAL_REJECTED: "agent.proposal.rejected",
    AGENT_PROPOSAL_UNDONE: "agent.proposal.undone",
    NUDGE_VIEWED: "nudge.viewed",
    NUDGE_ACCEPTED: "nudge.accepted",
    NUDGE_DISMISSED: "nudge.dismissed",
    PALETTE_OPENED: "palette.opened",
    PALETTE_AI_MODE_TOGGLED: "palette.ai_mode_toggled",
    AGENT_HEALTH_DEGRADED: "agent.health.degraded",
    THUMBS_FEEDBACK: "agent.feedback.thumbs",
    CITATION_FLAGGED: "agent.feedback.citation_flagged",
    CITATION_CLICKED: "agent.citation.clicked",
    /* PRD v3 §9.8 (X-R15) — UX surface analytics */
    AGENT_TTFT: "agent.ttft",
    AGENT_TTFT_SLOW: "agent.ttft.slow",
    BRIEF_REFRESHED: "brief.refreshed",
    // Fires when the Brief tab refetches because the board fingerprint
    // changed while the user was on another dock tab — distinct from a
    // true open transition (COPILOT_BRIEF_OPEN).
    BRIEF_REFRESHED_BY_BOARD_CHANGE: "brief.refreshed_by_board_change",
    BREAKDOWN_AXIS_CHANGED: "breakdown.axis_changed",
    SEARCH_RESULT_RATIONALE_VIEWED: "search.result_rationale_viewed",
    UNDO_APPLIED: "undo.applied",
    COPILOT_CHAT_SEND: "copilot.chat.send",
    COPILOT_CHAT_REGENERATE: "copilot.chat.regenerate",
    COPILOT_ESTIMATE_APPLY: "copilot.estimate.apply",
    COPILOT_BRIEF_OPEN: "copilot.brief.open",
    /*
     * Phase 4 A8 — fires when the dock's Inbox tab becomes the active
     * surface (open dock + Inbox tab selected). Used as the proxy for
     * "user read their inbox" — clears the unread-nudge badge in Redux
     * via the dock host. Mirrors COPILOT_BRIEF_OPEN's open-rate model.
     */
    COPILOT_INBOX_OPEN: "copilot.inbox.open",
    COPILOT_DRAFT_SUBMIT: "copilot.draft.submit",
    COPILOT_PALETTE_INVOKE: "copilot.palette.invoke",
    COPILOT_REWRITE_ACCEPT: "copilot.rewrite.accept",
    COPILOT_ONBOARDING_CTA: "copilot.onboarding.cta"
} as const;

export type AnalyticsEvent =
    (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

/**
 * Adapter contract for the analytics sink (Optimization Plan §3 P2-5).
 *
 * Production builds wire a concrete sink (Segment, PostHog, in-house) by
 * calling {@link setAnalyticsSink} during bootstrap. Until then we route
 * events through a dev-only `console.debug` so QA can verify the call
 * sites without standing up a real backend, and tests stay deterministic
 * because the default sink is a no-op in non-development environments.
 *
 * The contract intentionally takes only `event` + `payload`; sinks must
 * not mutate the payload and must not throw — the wrapper {@link track}
 * isolates failures so a misconfigured sink can never break product UX.
 */
export type AnalyticsSink = (
    event: AnalyticsEvent,
    payload?: Record<string, unknown>
) => void;

const isDevelopmentBuild = (): boolean => {
    try {
        return (
            typeof process !== "undefined" &&
            process.env?.NODE_ENV !== "production"
        );
    } catch {
        return false;
    }
};

const devConsoleSink: AnalyticsSink = (event, payload) => {
    if (!isDevelopmentBuild()) return;
    // eslint-disable-next-line no-console -- intentional dev-only sink
    if (typeof console === "undefined" || !console.debug) return;
    // eslint-disable-next-line no-console -- intentional dev-only sink
    console.debug("[analytics]", event, payload ?? {});
};

let activeSink: AnalyticsSink = devConsoleSink;

/**
 * Replace the active sink. Returns the previous sink so callers (or
 * tests) can restore it. Passing `null` resets to the default dev sink.
 */
export const setAnalyticsSink = (next: AnalyticsSink | null): AnalyticsSink => {
    const previous = activeSink;
    activeSink = next ?? devConsoleSink;
    return previous;
};

export const track = (
    event: AnalyticsEvent,
    payload?: Record<string, unknown>
): void => {
    try {
        activeSink(event, payload);
    } catch {
        /*
         * A failing sink must never break product UX. Swallow the error
         * here so the caller (which is usually wrapping a user-visible
         * action) can continue. Sinks that need to know about their own
         * failures should handle it internally before reaching this layer.
         */
    }
};
