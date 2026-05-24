import { CloseOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Button, Space, Typography } from "antd";
import React from "react";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import { microcopy } from "../../constants/microcopy";
import { fontSize, fontWeight, radius, space } from "../../theme/tokens";
import AiSparkleIcon from "../aiSparkleIcon";
import GlassPanel from "../glassPanel";

/**
 * First-time AI welcome banner (PRD v3 §8.1). Renders once per browser
 * (`localStorage` flag) and dismisses forever — both the CTA and the
 * close button mark the banner as seen so the next reload skips it.
 *
 * The banner intentionally lives in the page chrome, not as a modal: we
 * never block the user from doing real work on the board.
 *
 * Wave 1 T2 (Liquid Glass): the frosted surface, accent wash, and
 * inset shine now come from the shared `<GlassPanel>` so all banner
 * polish (specular rim in Wave 2, gel-flex motion in Wave 2 T3) flows
 * from a single source of truth. The banner only owns layout — the
 * flex row + padding + margin + overflow clipping that the body, CTA
 * cluster, and dismiss button sit inside.
 */
const Wrap = styled(GlassPanel)`
    align-items: flex-start;
    position: relative;
    overflow: hidden;
    border-radius: ${radius.md}px;
    display: flex;
    /* Prevent flex-column parents (BoardShell has min-height: 0) from
     * squishing this banner — without this, overflow: hidden above
     * clips the body text and CTA buttons on short viewports. */
    flex-shrink: 0;
    gap: ${space.sm}px;
    margin-bottom: ${space.md}px;
    padding: ${space.sm}px ${space.md}px;
`;

const Body = styled.div`
    flex: 1 1 auto;
    min-width: 0;
`;

interface CopilotWelcomeBannerProps {
    /** Override the storage key for tests / multi-tenant boards. */
    storageKey?: string;
    /**
     * Called when the user clicks the primary CTA. When omitted the
     * banner dispatches a `window` event `boardCopilot:openChat` with
     * the canonical "Summarize this board" prompt; the board/projects
     * pages already listen for that event to open the chat drawer with
     * the pre-filled prompt. Pass a callback to override the default
     * (e.g. routing the click through a host-specific opener).
     */
    onCta?: () => void;
}

const CopilotWelcomeBanner: React.FC<CopilotWelcomeBannerProps> = ({
    storageKey = "boardCopilot:onboarded",
    onCta
}) => {
    const [shown, setShown] = React.useState<boolean>(() => {
        if (typeof window === "undefined") return false;
        try {
            return window.localStorage.getItem(storageKey) === "1";
        } catch {
            return false;
        }
    });
    const dismiss = React.useCallback(() => {
        try {
            window.localStorage.setItem(storageKey, "1");
        } catch {
            /* private mode — no persistence, but the user still can't see it */
        }
        setShown(true);
    }, [storageKey]);
    if (shown) return null;
    const handleCta = () => {
        track(ANALYTICS_EVENTS.COPILOT_ONBOARDING_CTA);
        dismiss();
        if (onCta) {
            onCta();
            return;
        }
        /*
         * Default CTA path. Earlier the banner opened the brief drawer,
         * which conflicted with the CTA's literal text ("Try: Summarize
         * this board"). Dispatching the same custom event the command
         * palette uses keeps a single chat-open hook on the page and
         * pre-fills the composer with the prompt; users land in chat
         * already mid-conversation about the board.
         */
        if (typeof window !== "undefined") {
            window.dispatchEvent(
                new CustomEvent<{ prompt: string }>("boardCopilot:openChat", {
                    detail: {
                        prompt: microcopy.ai.welcomeBannerCtaPrompt as string
                    }
                })
            );
        }
    };
    return (
        <Wrap
            aria-label={microcopy.a11y.boardCopilotWelcome}
            intensity="strong"
            role="region"
            tone="accent"
        >
            <AiSparkleIcon size="lg" aria-hidden style={{ marginTop: 2 }} />
            <Body>
                <Typography.Text
                    style={{
                        display: "block",
                        fontSize: fontSize.md,
                        fontWeight: fontWeight.semibold
                    }}
                >
                    {microcopy.ai.welcomeBannerTitle}
                </Typography.Text>
                <Typography.Paragraph
                    style={{ marginBottom: space.xs, marginTop: 4 }}
                    type="secondary"
                >
                    {microcopy.ai.welcomeBannerBody}
                </Typography.Paragraph>
                <Space size={space.xs}>
                    <Button onClick={handleCta} size="small" type="primary">
                        {microcopy.ai.welcomeBannerCta}
                    </Button>
                    <Button onClick={dismiss} size="small" type="text">
                        {microcopy.ai.welcomeBannerDismiss}
                    </Button>
                </Space>
            </Body>
            <Button
                aria-label={microcopy.ai.welcomeBannerDismiss}
                icon={<CloseOutlined />}
                onClick={dismiss}
                size="small"
                type="text"
            />
        </Wrap>
    );
};

export default CopilotWelcomeBanner;
