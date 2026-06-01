import {
    AlertOutlined,
    InfoCircleOutlined,
    WarningOutlined
} from "@ant-design/icons";
import styled from "@emotion/styled";
import { Button, Typography } from "antd";
import React from "react";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import { microcopy } from "../../constants/microcopy";
import type { TriageNudge } from "../../interfaces/agent";
import {
    fontSize,
    fontWeight,
    radius,
    space,
    touchTargetCoarse
} from "../../theme/tokens";

/**
 * Compact nudge card (PRD v3 §10.3, C-R8, §7.2). Renders an inline
 * recommendation produced by the triage-agent: severity icon, one-line
 * title, optional CTA, dismiss link. Sized to slot inside the chat
 * transcript without forcing a layout shift.
 */
const Wrap = styled.div<{ severity: TriageNudge["severity"] }>`
    align-items: flex-start;
    background: ${(props) =>
        props.severity === "critical"
            ? "var(--ant-color-error-bg, #FEF2F2)"
            : props.severity === "warn"
              ? "var(--ant-color-warning-bg, #FFFBEB)"
              : "var(--color-copilot-bg-subtle)"};
    border: 1px solid
        ${(props) =>
            props.severity === "critical"
                ? "var(--ant-color-error-border, rgba(239, 68, 68, 0.4))"
                : props.severity === "warn"
                  ? "var(--ant-color-warning-border, rgba(245, 158, 11, 0.4))"
                  : "var(--color-copilot-bg-medium)"};
    border-radius: ${radius.md}px;
    display: flex;
    gap: ${space.xs}px;
    margin: ${space.xxs}px 0;
    padding: ${space.xs}px ${space.sm}px;
`;

const IconCol = styled.div<{ severity: TriageNudge["severity"] }>`
    color: ${(props) =>
        props.severity === "critical"
            ? "var(--ant-color-error, #EF4444)"
            : props.severity === "warn"
              ? "var(--ant-color-warning, #F59E0B)"
              : "var(--color-copilot-badge)"};
    flex: 0 0 auto;
    line-height: 1;
    padding-top: 2px;
`;

const Body = styled.div`
    flex: 1 1 auto;
    min-width: 0;
`;

const ActionRow = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: ${space.xs}px;
    margin-top: ${space.xxs}px;

    @media (pointer: coarse) {
        && .ant-btn {
            min-height: ${touchTargetCoarse}px;
            min-width: ${touchTargetCoarse}px;
        }
    }
`;

const SeverityIcon: React.FC<{ severity: TriageNudge["severity"] }> = ({
    severity
}) => {
    if (severity === "critical") return <AlertOutlined aria-hidden />;
    if (severity === "warn") return <WarningOutlined aria-hidden />;
    return <InfoCircleOutlined aria-hidden />;
};

interface NudgeCardProps {
    nudge: TriageNudge;
    /** Primary CTA label. Defaults to a generic "Open" if none provided. */
    actionLabel?: string;
    /**
     * Called when the user clicks the primary CTA. The card reports the
     * NUDGE_ACCEPTED event automatically.
     */
    onAction?: (nudge: TriageNudge) => void;
    /** Called on dismiss (× link). Reports NUDGE_DISMISSED automatically. */
    onDismiss?: (nudge: TriageNudge) => void;
}

const defaultActionLabel = (nudge: TriageNudge): string => {
    switch (nudge.kind) {
        case "load_imbalance":
            return "Reassign";
        case "wip_overflow":
            return "Move task";
        case "unowned_bug":
            return "Assign owner";
        case "stale_task":
            return "Open task";
        default:
            return "Open";
    }
};

const NudgeCard: React.FC<NudgeCardProps> = ({
    nudge,
    actionLabel,
    onAction,
    onDismiss
}) => {
    const ctaLabel = actionLabel ?? defaultActionLabel(nudge);
    const handleAction = () => {
        track(ANALYTICS_EVENTS.NUDGE_ACCEPTED, {
            kind: nudge.kind,
            id: nudge.nudge_id
        });
        onAction?.(nudge);
    };
    const handleDismiss = () => {
        track(ANALYTICS_EVENTS.NUDGE_DISMISSED, {
            kind: nudge.kind,
            id: nudge.nudge_id
        });
        onDismiss?.(nudge);
    };
    React.useEffect(() => {
        track(ANALYTICS_EVENTS.NUDGE_VIEWED, {
            kind: nudge.kind,
            id: nudge.nudge_id
        });
    }, [nudge.kind, nudge.nudge_id]);
    return (
        <Wrap role="alert" severity={nudge.severity}>
            <IconCol severity={nudge.severity}>
                <SeverityIcon severity={nudge.severity} />
            </IconCol>
            <Body>
                <Typography.Text
                    style={{
                        display: "block",
                        fontSize: fontSize.sm,
                        fontWeight: fontWeight.semibold
                    }}
                >
                    {nudge.summary}
                </Typography.Text>
                <ActionRow data-testid="nudge-card-action-row">
                    {onAction && (
                        <Button
                            onClick={handleAction}
                            size="small"
                            type="primary"
                        >
                            {ctaLabel}
                        </Button>
                    )}
                    {onDismiss && (
                        <Button
                            aria-label={microcopy.ai.dismissNudge}
                            onClick={handleDismiss}
                            size="small"
                            type="link"
                        >
                            {microcopy.ai.dismissNudge}
                        </Button>
                    )}
                </ActionRow>
            </Body>
        </Wrap>
    );
};

export default NudgeCard;
