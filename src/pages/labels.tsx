import styled from "@emotion/styled";
import { Typography } from "antd";
import { useParams } from "react-router-dom";

import LabelsManager from "../components/labelsManager";
import PageContainer from "../components/pageContainer";
import { microcopy } from "../constants/microcopy";
import { fontSize, fontWeight, lineHeight, space } from "../theme/tokens";
import useReactQuery from "../utils/hooks/useReactQuery";
import useTitle from "../utils/hooks/useTitle";

/**
 * Project labels page (PRD-GAP-011 — backend Collaboration label feature).
 *
 * A thin shell that renders inside the project-detail outlet (mirrors
 * `pages/milestones.tsx`): a page heading plus the `LabelsManager`, which
 * owns the list + editor-gated create / edit / delete controls. The page
 * resolves the project record only for the browser-tab title; the manager
 * fetches its own label / roster / mutation data.
 *
 * `useTitle` follows the "{Page} · {Project}" composition the Reports /
 * Members / Milestones surfaces established — project name first so the
 * tab title is scannable from a stack of tabs, "Labels" qualifier second.
 * The bare "Labels" form covers the brief window before the project query
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

const LabelsPage = () => {
    const { projectId } = useParams<{ projectId: string }>();
    const { data: project } = useReactQuery<IProject>(ProjectQuery, {
        projectId
    });

    const titleText = project?.projectName
        ? microcopy.pageTitle.labelsWithProject.replace(
              "{project}",
              project.projectName
          )
        : microcopy.pageTitle.labels;
    useTitle(titleText, false);

    return (
        <PageContainer data-testid="labels-page">
            <PageHeading level={1}>
                {microcopy.projectLabels.heading}
            </PageHeading>
            {projectId ? <LabelsManager projectId={projectId} /> : null}
        </PageContainer>
    );
};

export default LabelsPage;
