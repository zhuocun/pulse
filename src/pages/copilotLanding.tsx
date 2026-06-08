import { RightOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Button, Input, Typography } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

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
 * The Ask CTA opens the chat drawer through the canonical Redux hook
 * BEFORE navigating. The drawer state lives in the global overlays
 * slice, so setting it here survives the route change; the project
 * page mounts an `<AiChatDrawer />` keyed off `useAiChatDrawer().open`
 * and opens automatically on first paint.
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

const BriefSecondary = styled(Button)`
    && {
        align-self: flex-start;
        color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
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
                    <Input
                        aria-label={microcopy.copilotLanding.askTitle}
                        autoComplete="off"
                        enterKeyHint="send"
                        onChange={(event) => setDraft(event.target.value)}
                        onPressEnter={() => goToAsk(draft)}
                        placeholder={
                            microcopy.copilotLanding.composerPlaceholder
                        }
                        prefix={
                            <AiSparkleIcon
                                aria-hidden
                                style={{
                                    color: "var(--ant-color-primary, #EA580C)"
                                }}
                            />
                        }
                        size="large"
                        value={draft}
                    />
                    <Button
                        onClick={() => goToAsk(draft)}
                        size="large"
                        type="primary"
                    >
                        {microcopy.copilotLanding.askTitle}
                    </Button>
                </ComposerRow>
                <BriefSecondary
                    data-testid="copilot-landing-brief"
                    icon={<RightOutlined aria-hidden />}
                    iconPlacement="end"
                    onClick={goToBrief}
                    type="link"
                >
                    {microcopy.copilotLanding.briefSecondaryAction}
                </BriefSecondary>
            </ComposerShell>
        </PageContainer>
    );
};

export default CopilotLandingPage;
