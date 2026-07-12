import { useParams } from "react-router-dom";

import { Typography } from "@/components/ui/typography";
import LabelsManager from "../components/labelsManager";
import PageContainer from "../components/pageContainer";
import { microcopy } from "../constants/microcopy";
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
            <Typography.Title
                className="mb-md text-xxl font-semibold leading-tight"
                level={1}
            >
                {microcopy.projectLabels.heading}
            </Typography.Title>
            {projectId ? <LabelsManager projectId={projectId} /> : null}
        </PageContainer>
    );
};

export default LabelsPage;
