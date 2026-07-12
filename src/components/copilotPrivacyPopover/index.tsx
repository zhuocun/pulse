import { Info } from "lucide-react";
import React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@/components/ui/popover";
import { Typography } from "@/components/ui/typography";

import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import { space } from "../../theme/tokens";
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
const LIST_CLASS = "m-0 max-w-[24rem] ps-lg list-disc";

/**
 * Public placement API is preserved from the AntD surface; each value maps
 * to the Radix `side` + `align` pair the primitive consumes.
 */
export type CopilotPrivacyPlacement =
    | "top"
    | "topLeft"
    | "topRight"
    | "bottom"
    | "bottomLeft"
    | "bottomRight";

const PLACEMENT_MAP: Record<
    CopilotPrivacyPlacement,
    { side: "top" | "bottom"; align: "start" | "center" | "end" }
> = {
    top: { side: "top", align: "center" },
    topLeft: { side: "top", align: "start" },
    topRight: { side: "top", align: "end" },
    bottom: { side: "bottom", align: "center" },
    bottomLeft: { side: "bottom", align: "start" },
    bottomRight: { side: "bottom", align: "end" }
};

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
    /** Popover placement — defaults to top-right. */
    placement?: CopilotPrivacyPlacement;
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
    const { side, align } = PLACEMENT_MAP[placement];
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    aria-label={microcopy.ai.privacyLink}
                    className="h-auto gap-xxs px-xs py-0 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    variant="link"
                >
                    <Info aria-hidden />
                    {label ?? microcopy.ai.privacyLink}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align={align}
                aria-label={microcopy.ai.privacyTitle}
                className="w-auto max-w-[calc(100vw-2rem)]"
                side={side}
            >
                <Typography.Title level={5} style={{ marginTop: 0 }}>
                    {microcopy.ai.privacyTitle}
                </Typography.Title>
                <Typography.Paragraph
                    style={{ marginBottom: space.xs, marginTop: 0 }}
                    type="secondary"
                >
                    {summary}
                </Typography.Paragraph>
                <ul className={LIST_CLASS}>
                    {items.map((item) => (
                        <li key={item}>{item}</li>
                    ))}
                </ul>
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
                    <Badge
                        variant={
                            environment.aiUseLocalEngine
                                ? "secondary"
                                : "default"
                        }
                    >
                        {environment.aiUseLocalEngine
                            ? microcopy.ai.processingModeLocalLabel
                            : microcopy.ai.processingModeRemoteLabel}
                    </Badge>
                    <span>{processingDisclosure}</span>
                </Typography.Paragraph>
                <Typography.Paragraph
                    style={{ marginBottom: 0, marginTop: 0 }}
                    type="secondary"
                >
                    {microcopy.ai.privacyExclusions}
                </Typography.Paragraph>
            </PopoverContent>
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
                <ul className={LIST_CLASS}>
                    {scope.items.map((item) => (
                        <li key={item}>{item}</li>
                    ))}
                </ul>
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
                <Badge
                    variant={
                        environment.aiUseLocalEngine ? "secondary" : "default"
                    }
                >
                    {environment.aiUseLocalEngine
                        ? microcopy.ai.processingModeLocalLabel
                        : microcopy.ai.processingModeRemoteLabel}
                </Badge>
                <span>{processingDisclosure}</span>
            </Typography.Paragraph>
            <Typography.Paragraph
                style={{ marginBottom: space.xs, marginTop: 0 }}
                type="secondary"
            >
                {microcopy.ai.privacyExclusions}
            </Typography.Paragraph>
            <div className="flex justify-end gap-xs">
                <Button onClick={acknowledge} size="sm" variant="primary">
                    {microcopy.ai.privacyAcknowledge}
                </Button>
                <Button onClick={acknowledge} size="sm" variant="ghost">
                    {microcopy.ai.privacySuppress}
                </Button>
            </div>
        </div>
    );
};

export default CopilotPrivacyPopover;
