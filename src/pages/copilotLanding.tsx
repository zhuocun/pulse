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
import useAiChatDrawer from "../utils/hooks/useAiChatDrawer";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useBoardBriefDrawer from "../utils/hooks/useBoardBriefDrawer";
import useTitle, { composeBrandedTitle } from "../utils/hooks/useTitle";

/**
 * Copilot landing page (Phase 3 A3). Two large CTAs surface the
 * primary Copilot entry points from outside a board context. When AI
 * is off (env or per-user toggle), the page renders an EmptyState
 * instead.
 *
 * Each CTA opens its drawer through the canonical Redux hook BEFORE
 * navigating. The drawer state lives in the global overlays slice, so
 * setting it here survives the route change; the project page mounts
 * an `<AiChatDrawer />` keyed off `useAiChatDrawer().open` and opens
 * automatically on first paint. The previous `dispatchEvent` +
 * `navigate` sequence raced the project page's mount and fired the
 * event before any listener had subscribed (cold load) — the chat
 * never opened. Reading from Redux state on mount is race-proof.
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

const CopilotLandingPage = () => {
    useTitle(composeBrandedTitle(microcopy.pageTitle.copilot), false);
    const navigate = useNavigate();
    const { enabled: aiEnabled } = useAiEnabled();
    const { openDrawer: openChatDrawer } = useAiChatDrawer();
    const { openDrawer: openBriefDrawer } = useBoardBriefDrawer();

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
        /*
         * Open the chat drawer via Redux BEFORE navigating so the
         * project page's `useAiChatDrawer()` reads the open=true
         * snapshot on mount. The custom-event bridge raced the
         * navigation on cold loads (event fired, no subscriber yet).
         */
        openChatDrawer();
        navigate("/projects", { viewTransition: true });
    };

    const goToBrief = () => {
        /*
         * The brief drawer is project-scoped (mounted on the board
         * page). We set the Redux open flag here so that when the user
         * picks a project + board, the board page opens the drawer on
         * mount. Without the Redux bridge, a cold dispatchEvent fired
         * before the board even rendered and the click was a no-op.
         */
        openBriefDrawer();
        navigate("/projects", { viewTransition: true });
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
