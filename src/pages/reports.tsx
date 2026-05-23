import styled from "@emotion/styled";
import { Button, Typography } from "antd";
import { useParams } from "react-router-dom";

import AiSparkleIcon from "../components/aiSparkleIcon";
import EmptyState from "../components/emptyState";
import PageContainer from "../components/pageContainer";
import { microcopy } from "../constants/microcopy";
import { fontSize, fontWeight, lineHeight, space } from "../theme/tokens";
import useReactQuery from "../utils/hooks/useReactQuery";
import useTitle from "../utils/hooks/useTitle";

/**
 * Project reports placeholder (Phase 4.7). The metrics engine (velocity,
 * burndown, cycle time) is still in design; this surface establishes
 * the URL + nav slot so the "Reports" link can light up in the project
 * detail nav without 404ing, and so users who come looking for metrics
 * land on a "we hear you" page instead of a missing route.
 *
 * Design choices:
 *
 *   - Reuse `EmptyState` for the bulk of the surface so the visual
 *     rhythm matches the inbox / not-found surfaces — same illustration
 *     frame, same heading typography, same description max-width.
 *     Future replacement (the real reports dashboard) drops in below
 *     the heading without needing to redesign the chrome.
 *
 *   - The accent sparkle next to the page heading marks this as a
 *     "coming soon, AI-adjacent" surface so the future iteration can
 *     ship sparkle-tagged AI-derived charts without an aesthetic
 *     break.
 *
 *   - The CTA is a `mailto:` link rather than an in-app feedback
 *     popover. The popover (`<AiFeedbackPopover>`) is built for
 *     per-message AI thumbs-down feedback and pulling it in here
 *     would mis-attribute structured-feedback categories to a "what
 *     do you want in Reports?" channel. A mailto keeps the request
 *     freeform until product wires a dedicated feedback channel.
 *
 *   - `useTitle` follows the "{Page} · {Project}" composition used
 *     elsewhere — the inbox page brand-suffixes to "Inbox · Pulse",
 *     and the board page uses the project name directly. Reports
 *     splits the difference: project name first so the tab title is
 *     scannable from a stack of tabs, "Reports" qualifier second.
 */

const ProjectQuery = "projects" as const;

const PageHeading = styled(Typography.Title)`
    && {
        align-items: center;
        display: inline-flex;
        font-size: ${fontSize.xxl}px;
        font-weight: ${fontWeight.semibold};
        gap: ${space.xs}px;
        line-height: ${lineHeight.tight};
        margin-bottom: ${space.sm}px;
    }
`;

const ReportsPage = () => {
    const { projectId } = useParams<{ projectId: string }>();
    const { data: project } = useReactQuery<IProject>(ProjectQuery, {
        projectId
    });

    /*
     * Title resolves to "Reports · {project}" once the query lands;
     * the bare "Reports" form covers the brief window before the
     * project query resolves so the tab doesn't flash a generic
     * title. The `keepOnMount=false` flag restores the previous title
     * on unmount so navigating Reports → Board doesn't strand a
     * stale title.
     */
    const titleText = project?.projectName
        ? microcopy.pageTitle.reportsWithProject.replace(
              "{project}",
              project.projectName
          )
        : microcopy.pageTitle.reports;
    useTitle(titleText, false);

    return (
        <PageContainer data-testid="reports-page">
            <PageHeading level={1}>
                <AiSparkleIcon aria-hidden size="md" />
                {microcopy.reports.heading}
            </PageHeading>
            <EmptyState
                data-testid="reports-empty-state"
                description={microcopy.reports.emptyDescription}
                headingLevel={2}
                title={microcopy.reports.emptyTitle}
                tone="notice"
                variant="search"
                cta={
                    /*
                     * `<Button href>` renders a real anchor under the
                     * hood so the link is keyboard-accessible and the
                     * browser's middle-click / right-click menu work
                     * (vs. an onClick-driven `window.open` which
                     * doesn't carry the URL into context menus). We
                     * leave `rel`/`target` defaults — mailto: doesn't
                     * open a new tab in any browser worth caring
                     * about, so the AntD button's normal href
                     * handling is sufficient.
                     */
                    <Button
                        href={microcopy.reports.feedbackHref}
                        type="primary"
                    >
                        {microcopy.reports.feedbackCta}
                    </Button>
                }
            />
        </PageContainer>
    );
};

export default ReportsPage;
