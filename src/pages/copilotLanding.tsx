import styled from "@emotion/styled";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Typography } from "@/components/ui/typography";
import AiSparkleIcon from "../components/aiSparkleIcon";
import EmptyState from "../components/emptyState";
import PageContainer from "../components/pageContainer";
import { microcopy } from "../constants/microcopy";
import {
    accent,
    fontSize,
    fontWeight,
    lineHeight,
    radius,
    space
} from "../theme/tokens";
import useAiChatDrawer from "../utils/hooks/useAiChatDrawer";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useTitle, { composeBrandedTitle } from "../utils/hooks/useTitle";

/**
 * Copilot landing page (Phase 3 A3). A single composer-first surface
 * surfaces the primary Copilot entry point from outside a board context.
 * When AI is off (env or per-user toggle), the page renders an EmptyState
 * instead.
 *
 * The Ask CTA opens the chat tab through the canonical Redux hook
 * BEFORE navigating. The dock state lives in the global overlays
 * slice, so setting it here survives the route change; `CopilotDockHost`
 * bridges the legacy overlay flags into the persistent dock on the
 * board route.
 *
 * The Brief secondary action only navigates: the brief drawer is mounted
 * on the board page (not `/projects`), so setting the Redux flag here
 * would leak across routes.
 */

const PageHeading = styled(Typography.Title)`
    && {
        align-items: center;
        display: inline-flex;
        font-size: ${fontSize.xxl}px;
        font-weight: ${fontWeight.semibold};
        gap: ${space.xs}px;
        line-height: ${lineHeight.tight};
        margin-bottom: ${space.xs}px;
    }
`;

const PageSubtitle = styled(Typography.Paragraph)`
    && {
        color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
        font-size: ${fontSize.md}px;
        margin-bottom: ${space.lg}px;
    }
`;

const ComposerShell = styled.div`
    background: var(--ant-color-bg-container, #fff);
    border: 1px solid var(--ant-color-border-secondary, rgba(15, 23, 42, 0.06));
    border-radius: ${radius.lg}px;
    display: flex;
    flex-direction: column;
    gap: ${space.sm}px;
    padding: ${space.md}px;
`;

const ComposerRow = styled.div`
    align-items: stretch;
    display: flex;
    flex-direction: column;
    gap: ${space.sm}px;

    @media (min-width: 640px) {
        align-items: center;
        flex-direction: row;
    }
`;

/*
 * Prefix adornment slot. The primitive `Input` has no antd-style `prefix`,
 * so the sparkle glyph is a sibling positioned inside the field and the
 * input carries left padding to clear it.
 */
const ComposerField = styled.div`
    flex: 1 1 auto;
    min-width: 0;
    position: relative;
`;

const ComposerPrefix = styled.span`
    align-items: center;
    color: var(--ant-color-primary, #ea580c);
    display: inline-flex;
    inset-inline-start: ${space.sm}px;
    pointer-events: none;
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
`;

const BriefSecondary = styled(Button)`
    && {
        align-self: flex-start;
        color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
        height: auto;
        padding-inline: 0;
    }

    &&:hover {
        color: ${accent.border};
    }
`;

const CopilotLandingPage = () => {
    useTitle(composeBrandedTitle(microcopy.pageTitle.copilot), false);
    const navigate = useNavigate();
    const { enabled: aiEnabled } = useAiEnabled();
    const { openDrawer: openChatDrawer } = useAiChatDrawer();
    const [draft, setDraft] = useState("");

    if (!aiEnabled) {
        return (
            <PageContainer>
                <PageHeading level={1}>
                    {microcopy.copilotLanding.heading}
                </PageHeading>
                <EmptyState
                    data-testid="copilot-landing-ai-disabled"
                    description={microcopy.copilotLanding.aiDisabledDescription}
                    headingLevel={2}
                    title={microcopy.copilotLanding.aiDisabledTitle}
                    variant="tasks"
                />
            </PageContainer>
        );
    }

    const goToAsk = (prompt?: string) => {
        openChatDrawer(prompt?.trim() || undefined);
        navigate("/projects", { viewTransition: true });
    };

    const goToBrief = () => {
        navigate("/projects", { viewTransition: true });
    };

    return (
        <PageContainer>
            <PageHeading level={1}>
                <AiSparkleIcon aria-hidden size="lg" />
                <span>{microcopy.copilotLanding.heading}</span>
            </PageHeading>
            <PageSubtitle>{microcopy.copilotLanding.subtitle}</PageSubtitle>
            <ComposerShell data-testid="copilot-landing-ask">
                <ComposerRow>
                    <ComposerField>
                        <ComposerPrefix>
                            <AiSparkleIcon aria-hidden />
                        </ComposerPrefix>
                        <Input
                            aria-label={microcopy.copilotLanding.askTitle}
                            autoComplete="off"
                            className="pl-xl"
                            enterKeyHint="send"
                            inputMode="text"
                            onChange={(event) => setDraft(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") goToAsk(draft);
                            }}
                            placeholder={
                                microcopy.copilotLanding.composerPlaceholder
                            }
                            value={draft}
                        />
                    </ComposerField>
                    <Button
                        onClick={() => goToAsk(draft)}
                        size="lg"
                        variant="primary"
                    >
                        {microcopy.copilotLanding.askTitle}
                    </Button>
                </ComposerRow>
                <BriefSecondary
                    data-testid="copilot-landing-brief"
                    onClick={goToBrief}
                    variant="link"
                >
                    {microcopy.copilotLanding.briefSecondaryAction}
                    <ChevronRight aria-hidden />
                </BriefSecondary>
            </ComposerShell>
        </PageContainer>
    );
};

export default CopilotLandingPage;
