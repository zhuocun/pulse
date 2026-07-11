import styled from "@emotion/styled";
import { useParams } from "react-router-dom";

import { Typography } from "@/components/ui/typography";
import MilestonesManager from "../components/milestonesManager";
import PageContainer from "../components/pageContainer";
import { microcopy } from "../constants/microcopy";
import { fontSize, fontWeight, lineHeight, space } from "../theme/tokens";
import useReactQuery from "../utils/hooks/useReactQuery";
import useTitle from "../utils/hooks/useTitle";

/**
 * Project milestones page (FE-MS-1 — backend Milestones feature).
 *
 * A thin shell that renders inside the project-detail outlet (mirrors
 * `pages/members.tsx`): a page heading plus the `MilestonesManager`, which
 * owns the list + editor-gated create / edit / delete controls. The page
 * resolves the project record only for the browser-tab title; the manager
 * fetches its own milestone / roster / mutation data.
 *
 * `useTitle` follows the "{Page} · {Project}" composition the Reports /
 * Members surfaces established — project name first so the tab title is
 * scannable from a stack of tabs, "Milestones" qualifier second. The bare
 * "Milestones" form covers the brief window before the project query
 * resolves.
 */

const ProjectQuery = "projects" as const;

const PageHeading = styled(Typography.Title)`
    && {
        font-size: ${fontSize.xxl}px;
        font-weight: ${fontWeight.semibold};
        line-height: ${lineHeight.tight};
        margin-bottom: ${space.md}px;
    }
`;

const MilestonesPage = () => {
    const { projectId } = useParams<{ projectId: string }>();
    const { data: project } = useReactQuery<IProject>(ProjectQuery, {
        projectId
    });

    const titleText = project?.projectName
        ? microcopy.pageTitle.milestonesWithProject.replace(
              "{project}",
              project.projectName
          )
        : microcopy.pageTitle.milestones;
    useTitle(titleText, false);

    return (
        <PageContainer data-testid="milestones-page">
            <PageHeading level={1}>{microcopy.milestones.heading}</PageHeading>
            {projectId ? <MilestonesManager projectId={projectId} /> : null}
        </PageContainer>
    );
};

export default MilestonesPage;
