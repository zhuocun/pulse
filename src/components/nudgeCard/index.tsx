import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import { microcopy } from "../../constants/microcopy";
import type { TriageNudge } from "../../interfaces/agent";
import { fontSize, fontWeight } from "../../theme/tokens";

/**
 * Compact nudge card (PRD v3 §10.3, C-R8, §7.2). Renders an inline
 * recommendation produced by the triage-agent: severity icon, one-line
 * title, optional CTA, dismiss link. Sized to slot inside the chat
 * transcript without forcing a layout shift.
 */
type Severity = TriageNudge["severity"];

const WRAP_TONE: Record<Severity, string> = {
    critical: "border-error bg-errorBg",
    warn: "border-warning bg-warningBg",
    info: "border-[var(--color-copilot-bg-medium)] bg-[var(--color-copilot-bg-subtle)]"
};

const ICON_TONE: Record<Severity, string> = {
    critical: "text-error",
    warn: "text-warning",
    info: "text-[var(--color-copilot-badge)]"
};

const SeverityIcon: React.FC<{ severity: Severity }> = ({ severity }) => {
    if (severity === "critical")
        return <AlertCircle aria-hidden className="size-4" />;
    if (severity === "warn")
        return <AlertTriangle aria-hidden className="size-4" />;
    return <Info aria-hidden className="size-4" />;
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
        <div
            className={cn(
                "my-xxs flex items-start gap-xs rounded-md border px-sm py-xs",
                WRAP_TONE[nudge.severity]
            )}
            role="alert"
        >
            <div
                className={cn(
                    "flex-none pt-[2px] leading-none",
                    ICON_TONE[nudge.severity]
                )}
            >
                <SeverityIcon severity={nudge.severity} />
            </div>
            <div className="min-w-0 flex-1">
                <span
                    className="block"
                    style={{
                        fontSize: fontSize.sm,
                        fontWeight: fontWeight.semibold,
                        overflowWrap: "anywhere"
                    }}
                >
                    {nudge.summary}
                </span>
                <div
                    className="mt-xxs flex flex-wrap gap-xs"
                    data-testid="nudge-card-action-row"
                >
                    {onAction && (
                        <Button
                            onClick={handleAction}
                            size="sm"
                            variant="primary"
                        >
                            {ctaLabel}
                        </Button>
                    )}
                    {onDismiss && (
                        <Button
                            aria-label={microcopy.ai.dismissNudge}
                            onClick={handleDismiss}
                            size="sm"
                            variant="link"
                        >
                            {microcopy.ai.dismissNudge}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default NudgeCard;
