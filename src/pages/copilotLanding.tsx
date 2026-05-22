import styled from "@emotion/styled";
import { Button, Card, Typography } from "antd";
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
import useTitle, { composeBrandedTitle } from "../utils/hooks/useTitle";

/**
 * Copilot landing page (Phase 3 A3). Two large CTAs surface the
 * primary Copilot entry points from outside a board context. When AI
 * is off (env or per-user toggle), the page renders an EmptyState
 * instead.
 *
 * The Ask CTA opens the chat drawer through the canonical Redux hook
 * BEFORE navigating. The drawer state lives in the global overlays
 * slice, so setting it here survives the route change; the project
 * page mounts an `<AiChatDrawer />` keyed off `useAiChatDrawer().open`
 * and opens automatically on first paint. The previous `dispatchEvent`
 * + `navigate` sequence raced the project page's mount and fired the
 * event before any listener had subscribed (cold load) — the chat
 * never opened. Reading from Redux state on mount is race-proof.
 *
 * The Brief CTA only navigates: the brief drawer is mounted on the
 * board page (not `/projects`), so setting the Redux flag here would
 * leak across routes and pop the drawer the next time the user opened
 * any board. The user picks a board from `/projects` and opens the
 * brief from its header.
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
        transition: border-color 160ms ease-out;
    }

    && .ant-card-body {
        padding: ${space.lg}px;
    }

    /*
     * Hover highlights the card boundary as a visual cue that there's
     * an interactive control inside; the inner Button is the actual
     * click target. The cursor stays default (no pointer lie) since
     * the bare card surface is no longer clickable.
     */
    &&:hover {
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
         * The brief drawer is mounted only on the board page, never on
         * `/projects`. Dispatching `openBriefDrawer()` here leaked the
         * Redux flag across routes and ambushed the user with an
         * uninvited drawer the next time they opened ANY board. The
         * brief is a per-board concept, so the landing CTA just routes
         * to the project list where the user picks a board.
         */
        navigate("/projects", { viewTransition: true });
    };

    return (
        <PageContainer>
            <PageHeading level={1}>
                {/*
                 * `<Space>` renders a `<div>`, which is flow content
                 * and invalid inside the phrasing-only `<h1>`. The
                 * styled PageHeading sets `display: inline-flex`
                 * directly so the icon + label sit on the same line
                 * without dropping a forbidden div inside the heading.
                 */}
                <AiSparkleIcon aria-hidden size="lg" />
                <span>{microcopy.copilotLanding.heading}</span>
            </PageHeading>
            <PageSubtitle>{microcopy.copilotLanding.subtitle}</PageSubtitle>
            <CtaGrid>
                {/*
                 * The CTA cards' inner `<Button>` is the canonical
                 * click target so the action is keyboard-reachable
                 * (Enter / Space) and announced by AT. The previous
                 * implementation also wired `onClick` to the outer
                 * Card, which only fired on mouse — keyboard users
                 * could focus the Button but the outer mouse-only
                 * target meant the visual "hoverable" affordance
                 * lied about its accessibility. Drop the outer
                 * onClick and rely on the Button alone.
                 */}
                <CtaCard data-testid="copilot-landing-ask" hoverable>
                    <CtaTitle>{microcopy.copilotLanding.askTitle}</CtaTitle>
                    <CtaDescription>
                        {microcopy.copilotLanding.askDescription}
                    </CtaDescription>
                    <Button
                        block
                        onClick={goToAsk}
                        size="large"
                        style={{ marginTop: space.md }}
                        type="primary"
                    >
                        {microcopy.copilotLanding.askTitle}
                    </Button>
                </CtaCard>
                <CtaCard data-testid="copilot-landing-brief" hoverable>
                    <CtaTitle>{microcopy.copilotLanding.briefTitle}</CtaTitle>
                    <CtaDescription>
                        {microcopy.copilotLanding.briefDescription}
                    </CtaDescription>
                    <Button
                        block
                        onClick={goToBrief}
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
