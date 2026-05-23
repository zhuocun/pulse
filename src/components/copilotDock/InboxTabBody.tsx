import { Button, Space, Typography } from "antd";
import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import { microcopy, microcopyString } from "../../constants/microcopy";
import { fontSize, space } from "../../theme/tokens";
import type { TriageNudge } from "../../interfaces/agent";
import EmptyState from "../emptyState";
import NudgeCard from "../nudgeCard";

/**
 * Phase 4 A8 — Inbox tab body for the Copilot dock.
 *
 * Renders the most-recent triage-agent nudges (capped at
 * {@link MAX_VISIBLE_NUDGES}) plus a footer link to the full `/inbox`
 * page when there are more entries to triage. The visible cap mirrors
 * the PRD AC-V14 limit on the inbox itself (5) so the dock and the page
 * agree on what counts as "actionable now".
 *
 * The nudges array is fed in from `CopilotDockHost` so the source of
 * truth is the same as the in-chat NudgeCard list (`useAgent`'s
 * `nudges` field, which wraps `useNudgeInbox` internally). No
 * duplication, no separate fetch loop.
 *
 * Per-project isolation: this body is keyed on `projectId` via its
 * parent (`CopilotDockBody key={projectId}` in `CopilotDockHost`) so a
 * project switch remounts it and the new project's nudges populate
 * from the fresh `useAgent` instance — see the Lane A caveat fix and
 * the dock's `key={projectId}` history in `copilotDockHost.tsx`.
 */

const MAX_VISIBLE_NUDGES = 5;

export interface InboxTabBodyProps {
    /**
     * Whether the host dock is currently open. Inbox body has no async
     * teardown of its own (the nudges array is owned by `useAgent`),
     * but the open prop is plumbed through for symmetry with the chat
     * / brief bodies and to gate the analytics open event.
     */
    dockOpen: boolean;
    /**
     * Whether this body is the currently-active dock surface. Drives
     * the COPILOT_INBOX_OPEN analytics event and the "mark as read"
     * Redux dispatch in the host (the host owns the dispatch; this
     * body only owns the analytics).
     */
    tabActive?: boolean;
    nudges: TriageNudge[];
    onActionNudge?: (nudge: TriageNudge) => void;
    onDismissNudge?: (nudge: TriageNudge) => void;
}

const InboxTabBody: React.FC<InboxTabBodyProps> = ({
    dockOpen,
    tabActive = true,
    nudges,
    onActionNudge,
    onDismissNudge
}) => {
    const navigate = useNavigate();
    const surfaceVisible = dockOpen && tabActive;

    /*
     * Fire an analytics event the FIRST time the user opens the Inbox
     * surface in this session, plus on every subsequent open transition.
     * Matches COPILOT_BRIEF_OPEN's "true open transition" model — a
     * tab-flip Chat → Inbox → Chat → Inbox should count as one open,
     * not two; we use a ref-less effect because the dock surface
     * itself drives the surfaceVisible flip and that's already a true
     * transition (false → true once per open).
     */
    // Capture the latest nudges count in a ref so the effect can read
    // it without subscribing — the dep array deliberately excludes
    // `nudges` so a fresh nudge arriving mid-session doesn't re-emit
    // the open event (mirrors COPILOT_BRIEF_OPEN's true-open-transition
    // model).
    const nudgesCountRef = useRef(nudges.length);
    nudgesCountRef.current = nudges.length;

    useEffect(() => {
        if (!surfaceVisible) return;
        track(ANALYTICS_EVENTS.COPILOT_INBOX_OPEN, {
            unreadCount: nudgesCountRef.current
        });
    }, [surfaceVisible]);

    const visibleNudges = nudges.slice(0, MAX_VISIBLE_NUDGES);
    const overflowCount = Math.max(0, nudges.length - MAX_VISIBLE_NUDGES);

    const handleSeeAll = useCallback(() => {
        navigate("/inbox");
    }, [navigate]);

    if (visibleNudges.length === 0) {
        return (
            <div
                data-testid="copilot-dock-inbox-empty"
                style={{
                    display: "flex",
                    flex: "1 1 auto",
                    flexDirection: "column",
                    minHeight: 0
                }}
            >
                <EmptyState
                    description={
                        microcopy.copilotDock.inboxTab.emptyDescription
                    }
                    headingLevel={3}
                    title={microcopy.copilotDock.inboxTab.emptyTitle}
                    variant="tasks"
                />
            </div>
        );
    }

    return (
        <div
            data-testid="copilot-dock-inbox-list"
            style={{
                display: "flex",
                flex: "1 1 auto",
                flexDirection: "column",
                minHeight: 0
            }}
        >
            <Typography.Text
                style={{
                    display: "block",
                    fontSize: fontSize.xs,
                    marginBottom: space.xs
                }}
                type="secondary"
            >
                {microcopy.copilotDock.inboxTab.sectionLabel}
            </Typography.Text>
            <Space
                direction="vertical"
                size={space.xxs}
                style={{ width: "100%" }}
            >
                {visibleNudges.map((nudge) => (
                    <NudgeCard
                        actionLabel={microcopyString(
                            microcopy.copilotDock.inboxTab.actionLabel
                        )}
                        key={nudge.nudge_id}
                        nudge={nudge}
                        onAction={onActionNudge}
                        onDismiss={onDismissNudge}
                    />
                ))}
            </Space>
            <div style={{ marginTop: "auto", paddingTop: space.sm }}>
                <Button
                    aria-label={microcopyString(
                        microcopy.copilotDock.inboxTab.seeAll
                    )}
                    block
                    data-testid="copilot-dock-inbox-see-all"
                    onClick={handleSeeAll}
                    size="small"
                    type="link"
                >
                    {overflowCount > 0
                        ? `${microcopyString(microcopy.copilotDock.inboxTab.seeAll)} (+${overflowCount})`
                        : microcopyString(
                              microcopy.copilotDock.inboxTab.seeAll
                          )}
                </Button>
            </div>
        </div>
    );
};

export default InboxTabBody;
