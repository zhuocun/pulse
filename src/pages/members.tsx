import styled from "@emotion/styled";
import { useParams } from "react-router-dom";

import { Typography } from "@/components/ui/typography";
import PageContainer from "../components/pageContainer";
import ProjectMembersManager from "../components/projectMembersManager";
import { microcopy } from "../constants/microcopy";
import { fontSize, fontWeight, lineHeight, space } from "../theme/tokens";
import useReactQuery from "../utils/hooks/useReactQuery";
import useTitle from "../utils/hooks/useTitle";

/**
 * Project members page (M4 — backend Collaboration feature).
 *
 * A thin shell that renders inside the project-detail outlet (mirrors
 * `pages/reports.tsx`): a page heading plus the `ProjectMembersManager`,
 * which owns the roster + add / change-role / remove controls. The page
 * resolves the project record only for the browser-tab title; the
 * manager fetches its own roster / directory / mutation data.
 *
 * `useTitle` follows the "{Page} · {Project}" composition the Reports
 * surface established — project name first so the tab title is scannable
 * from a stack of tabs, "Members" qualifier second. The bare "Members"
 * form covers the brief window before the project query resolves.
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

const MembersPage = () => {
    const { projectId } = useParams<{ projectId: string }>();
    const { data: project } = useReactQuery<IProject>(ProjectQuery, {
        projectId
    });

    const titleText = project?.projectName
        ? microcopy.pageTitle.membersWithProject.replace(
              "{project}",
              project.projectName
          )
        : microcopy.pageTitle.members;
    useTitle(titleText, false);

    return (
        <PageContainer data-testid="members-page">
            <PageHeading level={1}>{microcopy.members.heading}</PageHeading>
            {projectId ? <ProjectMembersManager projectId={projectId} /> : null}
        </PageContainer>
    );
};

export default MembersPage;
