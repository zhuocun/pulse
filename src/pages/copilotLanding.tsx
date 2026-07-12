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

const PAGE_HEADING =
    "mb-xs inline-flex items-center gap-xs text-xxl font-semibold leading-tight";

const CopilotLandingPage = () => {
    useTitle(composeBrandedTitle(microcopy.pageTitle.copilot), false);
    const navigate = useNavigate();
    const { enabled: aiEnabled } = useAiEnabled();
    const { openDrawer: openChatDrawer } = useAiChatDrawer();
    const [draft, setDraft] = useState("");

    if (!aiEnabled) {
        return (
            <PageContainer>
                <Typography.Title className={PAGE_HEADING} level={1}>
                    {microcopy.copilotLanding.heading}
                </Typography.Title>
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
            <Typography.Title className={PAGE_HEADING} level={1}>
                <AiSparkleIcon aria-hidden size="lg" />
                <span>{microcopy.copilotLanding.heading}</span>
            </Typography.Title>
            <Typography.Paragraph className="mb-lg text-md text-[color:var(--pulse-text-secondary)]">
                {microcopy.copilotLanding.subtitle}
            </Typography.Paragraph>
            <div
                className="flex flex-col gap-sm rounded-lg border border-[var(--pulse-border-secondary)] bg-[var(--pulse-bg-container)] p-md"
                data-testid="copilot-landing-ask"
            >
                <div className="flex flex-col items-stretch gap-sm sm:flex-row sm:items-center">
                    {/*
                     * Prefix adornment slot. The primitive `Input` has no
                     * antd-style `prefix`, so the sparkle glyph is a sibling
                     * positioned inside the field and the input carries left
                     * padding to clear it.
                     */}
                    <div className="relative min-w-0 flex-auto">
                        <span className="pointer-events-none absolute start-sm top-1/2 inline-flex -translate-y-1/2 items-center text-brand">
                            <AiSparkleIcon aria-hidden />
                        </span>
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
                    </div>
                    <Button
                        onClick={() => goToAsk(draft)}
                        size="lg"
                        variant="primary"
                    >
                        {microcopy.copilotLanding.askTitle}
                    </Button>
                </div>
                <Button
                    className="h-auto self-start px-0 text-[color:var(--pulse-text-secondary)] hover:text-[color:var(--pulse-accent-border)]"
                    data-testid="copilot-landing-brief"
                    onClick={goToBrief}
                    variant="link"
                >
                    {microcopy.copilotLanding.briefSecondaryAction}
                    <ChevronRight aria-hidden />
                </Button>
            </div>
        </PageContainer>
    );
};

export default CopilotLandingPage;
