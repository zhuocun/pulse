import styled from "@emotion/styled";
import { Button, Card, Space, Typography } from "antd";
import { useNavigate } from "react-router-dom";

import AiSparkleIcon from "../components/aiSparkleIcon";
import EmptyState from "../components/emptyState";
import PageContainer from "../components/pageContainer";
import { microcopy } from "../constants/microcopy";
import {
    accent,
    breakpoints,
    fontSize,
    fontWeight,
    lineHeight,
    radius,
    space
} from "../theme/tokens";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useTitle, { composeBrandedTitle } from "../utils/hooks/useTitle";

/**
 * Copilot landing page (Phase 3 A3). Two large CTAs surface the
 * primary Copilot entry points from outside a board context. When AI
 * is off (env or per-user toggle), the page renders an EmptyState
 * instead.
 *
 * Each CTA dispatches a `window` CustomEvent that the board / project
 * pages already listen for (`boardCopilot:openChat`) or will be
 * extended to listen for (`boardCopilot:openBrief`). To make the CTAs
 * useful from /copilot (no board in scope), we also navigate to
 * /projects on click — the existing project page mounts an
 * AiChatDrawer that picks up the event.
 */

const PageHeading = styled(Typography.Title)`
    && {
        font-size: ${fontSize.xxl}px;
        font-weight: ${fontWeight.semibold};
        line-height: ${lineHeight.tight};
        margin-bottom: ${space.xs}px;
    }
`;

const PageSubtitle = styled(Typography.Paragraph)`
    && {
        color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
        font-size: ${fontSize.md}px;
        margin-bottom: ${space.xl}px;
    }
`;

const CtaGrid = styled.div`
    display: grid;
    gap: ${space.md}px;
    grid-template-columns: 1fr;

    @media (min-width: ${breakpoints.md}px) {
        grid-template-columns: 1fr 1fr;
    }
`;

const CtaCard = styled(Card)`
    && {
        border-radius: ${radius.lg}px;
        cursor: pointer;
        transition: border-color 160ms ease-out;
    }

    && .ant-card-body {
        padding: ${space.lg}px;
    }

    &&:hover,
    &&:focus-visible {
        border-color: ${accent.border};
    }

    @media (prefers-reduced-motion: reduce) {
        && {
            transition: none;
        }
    }
`;

const CtaTitle = styled(Typography.Text)`
    && {
        display: block;
        font-size: ${fontSize.lg}px;
        font-weight: ${fontWeight.semibold};
        margin-bottom: ${space.xxs}px;
    }
`;

const CtaDescription = styled(Typography.Text)`
    && {
        color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
        display: block;
        font-size: ${fontSize.base}px;
    }
`;

const dispatchOpenChat = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
        new CustomEvent<{ prompt: string }>("boardCopilot:openChat", {
            detail: { prompt: "" }
        })
    );
};

const dispatchOpenBrief = () => {
    if (typeof window === "undefined") return;
    /*
     * The brief drawer is project-scoped and is opened directly via
     * useBoardBriefDrawer inside the board page. We dispatch a forward-
     * looking event the board page will pick up once it's listening; the
     * navigate-then-event sequence below means the user lands on the
     * project list where they can pick a board to actually generate the
     * brief from.
     */
    window.dispatchEvent(
        new CustomEvent("boardCopilot:openBrief", { detail: {} })
    );
};

const CopilotLandingPage = () => {
    useTitle(composeBrandedTitle(microcopy.pageTitle.copilot), false);
    const navigate = useNavigate();
    const { enabled: aiEnabled } = useAiEnabled();

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

    const goToAsk = () => {
        navigate("/projects", { viewTransition: true });
        dispatchOpenChat();
    };

    const goToBrief = () => {
        navigate("/projects", { viewTransition: true });
        dispatchOpenBrief();
    };

    return (
        <PageContainer>
            <PageHeading level={1}>
                <Space size={space.xs}>
                    <AiSparkleIcon aria-hidden size="lg" />
                    {microcopy.copilotLanding.heading}
                </Space>
            </PageHeading>
            <PageSubtitle>{microcopy.copilotLanding.subtitle}</PageSubtitle>
            <CtaGrid>
                <CtaCard
                    data-testid="copilot-landing-ask"
                    hoverable
                    onClick={goToAsk}
                >
                    <CtaTitle>{microcopy.copilotLanding.askTitle}</CtaTitle>
                    <CtaDescription>
                        {microcopy.copilotLanding.askDescription}
                    </CtaDescription>
                    <Button
                        block
                        onClick={(event) => {
                            event.stopPropagation();
                            goToAsk();
                        }}
                        size="large"
                        style={{ marginTop: space.md }}
                        type="primary"
                    >
                        {microcopy.copilotLanding.askTitle}
                    </Button>
                </CtaCard>
                <CtaCard
                    data-testid="copilot-landing-brief"
                    hoverable
                    onClick={goToBrief}
                >
                    <CtaTitle>{microcopy.copilotLanding.briefTitle}</CtaTitle>
                    <CtaDescription>
                        {microcopy.copilotLanding.briefDescription}
                    </CtaDescription>
                    <Button
                        block
                        onClick={(event) => {
                            event.stopPropagation();
                            goToBrief();
                        }}
                        size="large"
                        style={{ marginTop: space.md }}
                    >
                        {microcopy.copilotLanding.briefTitle}
                    </Button>
                </CtaCard>
            </CtaGrid>
        </PageContainer>
    );
};

export default CopilotLandingPage;
