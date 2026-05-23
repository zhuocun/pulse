import { InfoCircleOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Button, Popover, Tag, Typography } from "antd";
import React from "react";

import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import { fontSize, fontWeight, space } from "../../theme/tokens";
import { getAiDataScope } from "../../utils/ai/aiDataScope";
import type { AiNonRoute } from "../../utils/ai/aiDataScope";
import type { AiRoute } from "../../utils/hooks/useAi";

/**
 * "What is shared?" disclosure (PRD v3 §9.7 X-R14, P7).
 *
 * Lists every category of board data the agent receives so users can
 * calibrate trust before sending the first message in a thread. The
 * trigger renders inline as a subtle text link; the popover content is
 * static — there is no per-call computation, so a cold open is instant.
 *
 * Surfaces that need the disclosure as a one-shot acknowledgement
 * (e.g. AiTaskDraftModal first use) read the same `microcopy.ai.privacy*`
 * strings without rendering the popover, so wording stays consistent.
 */
const Trigger = styled.button`
    align-items: center;
    background: none;
    border: 0;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65));
    cursor: pointer;
    display: inline-flex;
    font-size: ${fontSize.xs}px;
    font-weight: ${fontWeight.medium};
    gap: 4px;
    padding: 0;
    text-decoration: underline;
    text-underline-offset: 2px;

    &:hover,
    &:focus-visible {
        color: var(--ant-color-text, rgba(15, 23, 42, 0.9));
    }
`;

const List = styled.ul`
    margin: 0;
    max-width: 24rem;
    padding-inline-start: ${space.lg}px;
`;

const getAiServiceOrigin = (baseUrl: string): string | null => {
    if (!baseUrl.trim()) return null;
    try {
        return new URL(baseUrl).origin;
    } catch {
        return null;
    }
};

export const getCopilotProcessingDisclosure = () => {
    if (environment.aiUseLocalEngine) {
        return microcopy.ai.localProcessingDisclosure;
    }
    const origin = getAiServiceOrigin(environment.aiBaseUrl);
    return origin
        ? microcopy.ai.remoteProcessingDisclosureWithOrigin.replace(
              "{origin}",
              origin
          )
        : microcopy.ai.remoteProcessingDisclosure;
};

interface CopilotPrivacyPopoverProps {
    /**
     * Optional override for the trigger label. Defaults to the standard
     * "What is shared?" microcopy. Pass a `ReactNode` to embed the
     * disclosure inside another UI element.
     */
    label?: React.ReactNode;
    /** AntD Popover placement — defaults to top-right. */
    placement?:
        | "top"
        | "topLeft"
        | "topRight"
        | "bottom"
        | "bottomLeft"
        | "bottomRight";
    /**
     * Route-aware scope (Optimization Plan §3 P0-1). When set, the popover
     * shows the exact data this surface sends instead of the generic global
     * scope. `chat` is treated as a route here even though it's served by a
     * different hook. Omit for global affordances like the header link.
     */
    route?: AiRoute | AiNonRoute;
}

const CopilotPrivacyPopover: React.FC<CopilotPrivacyPopoverProps> = ({
    label,
    placement = "topRight",
    route
}) => {
    const processingDisclosure = getCopilotProcessingDisclosure();
    const scope = route ? getAiDataScope(route) : null;
    const items = scope ? scope.items : microcopy.ai.privacyDataScope;
    const summary = scope ? scope.summary : microcopy.ai.privacyDisclosure;
    const content = (
        <div>
            <Typography.Title level={5} style={{ marginTop: 0 }}>
                {microcopy.ai.privacyTitle}
            </Typography.Title>
            <Typography.Paragraph
                style={{ marginBottom: space.xs, marginTop: 0 }}
                type="secondary"
            >
                {summary}
            </Typography.Paragraph>
            <List>
                {items.map((item) => (
                    <li key={item}>{item}</li>
                ))}
            </List>
            <Typography.Paragraph
                style={{
                    alignItems: "center",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    marginBottom: space.xs,
                    marginTop: space.xs
                }}
                type="secondary"
            >
                <Tag
                    color={environment.aiUseLocalEngine ? "default" : "purple"}
                    style={{ marginInlineEnd: 0 }}
                >
                    {environment.aiUseLocalEngine
                        ? microcopy.ai.processingModeLocalLabel
                        : microcopy.ai.processingModeRemoteLabel}
                </Tag>
                <span>{processingDisclosure}</span>
            </Typography.Paragraph>
            <Typography.Paragraph
                style={{ marginBottom: 0, marginTop: 0 }}
                type="secondary"
            >
                {microcopy.ai.privacyExclusions}
            </Typography.Paragraph>
        </div>
    );
    return (
        <Popover
            content={content}
            placement={placement}
            trigger={["click", "focus"]}
        >
            <Trigger aria-label={microcopy.ai.privacyLink} type="button">
                <InfoCircleOutlined aria-hidden />
                {label ?? microcopy.ai.privacyLink}
            </Trigger>
        </Popover>
    );
};

/**
 * One-shot disclosure used in modals (PRD D-R8). Reads from
 * `localStorage`; renders the inline disclosure block when not yet
 * acknowledged, with two buttons.
 *
 * Storage key is route-scoped (Review F10): each surface presents a
 * different data scope, so acknowledging "what is shared with the
 * estimator" must not silently dismiss the disclosure for "what is
 * shared with the task drafter". Callers can still pass an explicit
 * `storageKey` to override the default scoping (legacy callers, tests).
 *
 * Returns `null` once dismissed so subsequent renders skip the markup.
 */
interface CopilotPrivacyDisclosureProps {
    storageKey?: string;
    onAcknowledge?: () => void;
    /** Route-aware scope, see {@link CopilotPrivacyPopover}. */
    route?: AiRoute | AiNonRoute;
}

const LEGACY_GLOBAL_KEY = "boardCopilot:privacyShown";

const buildDefaultStorageKey = (route?: AiRoute | AiNonRoute): string =>
    route ? `boardCopilot:privacyShown:${route}` : LEGACY_GLOBAL_KEY;

/**
 * Followup C (PR #308 review): legacy-key migration for the route-scoped
 * privacy disclosure (Review F10).
 *
 * Wave 2 introduced `boardCopilot:privacyShown:{route}` so each AI
 * surface can carry its own acknowledgement state, but had no fallback
 * for users who already dismissed the previous global
 * `boardCopilot:privacyShown` key — they'd be re-prompted on every
 * route the next time they opened a Copilot surface.
 *
 * Migration semantics (chosen for simplicity + safety): the legacy
 * "dismissed" signal is treated as *global* dismissal. If the new
 * route-scoped key is unset AND the legacy global key is truthy ("1"),
 * we report the disclosure as already acknowledged for that route.
 *
 * We deliberately do NOT mutate localStorage during the read — back-
 * filling the new key for every route the user might visit would
 * silently extend the consent for routes the user has never opened. The
 * legacy key stays in place until either the user re-enables the
 * disclosure (out of scope; no UI for this today) or the user
 * acknowledges the new route-scoped key in which case both keys agree.
 * This is the least surprising path because it preserves a clean
 * "explicit acknowledgement per surface" mental model for any new
 * surface added after the legacy users have moved on.
 */
const hasLegacyGlobalAck = (): boolean => {
    if (typeof window === "undefined") return false;
    try {
        return window.localStorage.getItem(LEGACY_GLOBAL_KEY) === "1";
    } catch {
        return false;
    }
};

export const CopilotPrivacyDisclosure: React.FC<
    CopilotPrivacyDisclosureProps
> = ({ storageKey, onAcknowledge, route }) => {
    const resolvedStorageKey = storageKey ?? buildDefaultStorageKey(route);
    const [shown, setShown] = React.useState<boolean>(() => {
        if (typeof window === "undefined") return false;
        try {
            if (window.localStorage.getItem(resolvedStorageKey) === "1") {
                return true;
            }
            /*
             * If the new route-scoped key is unset but the user
             * dismissed the legacy global key before the F10 fix
             * shipped, honor that prior dismissal — re-prompting them
             * on every route would be a regression in calm-by-default.
             * Only fires when the caller used the default key (route
             * scope) so explicit callers / tests that pass their own
             * `storageKey` are unaffected.
             */
            if (
                !storageKey &&
                route &&
                resolvedStorageKey !== LEGACY_GLOBAL_KEY &&
                hasLegacyGlobalAck()
            ) {
                return true;
            }
            return false;
        } catch {
            return false;
        }
    });
    if (shown) return null;
    const processingDisclosure = getCopilotProcessingDisclosure();
    const scope = route ? getAiDataScope(route) : null;
    const summary = scope ? scope.summary : microcopy.ai.privacyDisclosure;
    const acknowledge = () => {
        try {
            window.localStorage.setItem(resolvedStorageKey, "1");
        } catch {
            /* private mode — keep state in memory only */
        }
        setShown(true);
        onAcknowledge?.();
    };
    return (
        <div
            role="status"
            style={{
                background: "var(--color-copilot-bg-subtle)",
                border: "1px solid var(--color-copilot-bg-medium, rgba(124, 92, 255, 0.18))",
                borderRadius: 8,
                marginBottom: space.sm,
                padding: space.sm
            }}
        >
            <Typography.Text strong>
                {microcopy.ai.privacyTitle}
            </Typography.Text>
            <Typography.Paragraph
                style={{ marginBottom: space.xs, marginTop: 4 }}
                type="secondary"
            >
                {summary}
            </Typography.Paragraph>
            {scope && (
                <List>
                    {scope.items.map((item) => (
                        <li key={item}>{item}</li>
                    ))}
                </List>
            )}
            <Typography.Paragraph
                style={{
                    alignItems: "center",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    marginBottom: space.xs,
                    marginTop: scope ? space.xs : 0
                }}
                type="secondary"
            >
                <Tag
                    color={environment.aiUseLocalEngine ? "default" : "purple"}
                    style={{ marginInlineEnd: 0 }}
                >
                    {environment.aiUseLocalEngine
                        ? microcopy.ai.processingModeLocalLabel
                        : microcopy.ai.processingModeRemoteLabel}
                </Tag>
                <span>{processingDisclosure}</span>
            </Typography.Paragraph>
            <Typography.Paragraph
                style={{ marginBottom: space.xs, marginTop: 0 }}
                type="secondary"
            >
                {microcopy.ai.privacyExclusions}
            </Typography.Paragraph>
            <div
                style={{
                    display: "flex",
                    gap: space.xs,
                    justifyContent: "flex-end"
                }}
            >
                <Button onClick={acknowledge} size="small" type="primary">
                    {microcopy.ai.privacyAcknowledge}
                </Button>
                <Button onClick={acknowledge} size="small" type="text">
                    {microcopy.ai.privacySuppress}
                </Button>
            </div>
        </div>
    );
};

export default CopilotPrivacyPopover;
