import { PlusOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Button, message, Modal, Select } from "antd";
import { useCallback, useMemo, useState } from "react";

import { microcopy, microcopyString } from "../../constants/microcopy";
import { getActiveLocaleCode } from "../../i18n";
import {
    breakpoints,
    fontSize,
    fontWeight,
    letterSpacing,
    space
} from "../../theme/tokens";
import useActivityFeed from "../../utils/hooks/useActivityFeed";
import useAuth from "../../utils/hooks/useAuth";
import useProjectModal from "../../utils/hooks/useProjectModal";
import useReactMutation from "../../utils/hooks/useReactMutation";
import deleteProjectCallback from "../../utils/optimisticUpdate/deleteProject";
import EmptyState from "../emptyState";
import ProjectCard, { ProjectCardSkeleton } from "../projectCard";

interface Props {
    dataSource?: IProject[];
    members: IMember[];
    /**
     * When the upstream query failed, the page renders an Alert with retry
     * above the grid. Hide the in-grid "No projects yet" empty state in
     * that case so the user is not told the list is empty when we simply
     * couldn't load it.
     */
    error?: boolean;
    loading?: boolean;
}

/**
 * Re-exported for older call sites (header, login, register, popovers)
 * that still expect the project list module to expose this primitive.
 * It exists here for backwards compatibility — new code should prefer a
 * locally-styled `<Button>` instead of importing this.
 */
export const NoPaddingButton = styled(Button)`
    padding: 0;
`;

const ListSurface = styled.section`
    display: flex;
    flex-direction: column;
    gap: ${space.md}px;
`;

const Toolbar = styled.div`
    align-items: center;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
    display: flex;
    flex-wrap: wrap;
    font-size: ${fontSize.sm}px;
    gap: ${space.sm}px;
    justify-content: space-between;

    > * {
        min-width: 0;
    }
`;

const ResultCount = styled.span`
    font-weight: ${fontWeight.medium};
    letter-spacing: ${letterSpacing.tight};
`;

/*
 * Was previously `styled.label` so the visible "SORT BY" caption read as
 * the field label. AntD's `<Select>` renders a `<div role="combobox">`
 * rather than a labelable form element, so the implicit label
 * association never fires — screen readers only get the explicit
 * `aria-label={microcopy.a11y.sortProjects}` on the Select itself, which
 * already covers the labelling contract. Render as a plain inline group
 * so we don't ship a `<label>` that has no labellable target.
 */
const SortRow = styled.span`
    align-items: center;
    color: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.5));
    display: inline-flex;
    font-size: ${fontSize.xs}px;
    font-weight: ${fontWeight.medium};
    gap: ${space.xs}px;
    letter-spacing: ${letterSpacing.wide};
    text-transform: uppercase;
`;

const Grid = styled.div`
    display: grid;
    gap: ${space.md}px;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));

    @media (min-width: ${breakpoints.sm}px) {
        gap: ${space.lg}px;
        grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
    }
`;

const SKELETON_KEY_PREFIX = "__skeleton__";
const SKELETON_COUNT = 6;

type SortOrder = "name-asc" | "name-desc" | "newest" | "oldest";

const buildSortOptions = (): { label: string; value: SortOrder }[] => [
    { label: microcopy.options.sort.nameAsc, value: "name-asc" },
    { label: microcopy.options.sort.nameDesc, value: "name-desc" },
    { label: microcopy.options.sort.newest, value: "newest" },
    { label: microcopy.options.sort.oldest, value: "oldest" }
];

const projectCreatedAtTime = (raw?: string): number => {
    if (!raw) return 0;
    const time = new Date(raw).getTime();
    return Number.isNaN(time) ? 0 : time;
};

const sortProjects = (projects: IProject[], order: SortOrder): IProject[] => {
    const out = [...projects];
    const locale = getActiveLocaleCode();
    switch (order) {
        case "name-desc":
            out.sort((a, b) =>
                b.projectName.localeCompare(a.projectName, locale)
            );
            break;
        case "newest":
            out.sort(
                (a, b) =>
                    projectCreatedAtTime(b.createdAt) -
                    projectCreatedAtTime(a.createdAt)
            );
            break;
        case "oldest":
            out.sort(
                (a, b) =>
                    projectCreatedAtTime(a.createdAt) -
                    projectCreatedAtTime(b.createdAt)
            );
            break;
        case "name-asc":
        default:
            out.sort((a, b) =>
                a.projectName.localeCompare(b.projectName, locale)
            );
    }
    return out;
};

const ProjectList: React.FC<Props> = ({
    dataSource,
    members,
    error,
    loading
}) => {
    const { user } = useAuth();
    const [pendingLikeId, setPendingLikeId] = useState("");
    const [sortOrder, setSortOrder] = useState<SortOrder>("name-asc");
    const showSkeleton = Boolean(loading) && !error;
    const { mutateAsync: update } = useReactMutation(
        "users/likes",
        "PUT",
        "users"
    );
    const { mutate: remove } = useReactMutation(
        "projects",
        "DELETE",
        ["projects"],
        deleteProjectCallback,
        // Suppress useReactMutation's auto-revert toast; we surface a
        // dedicated success/failure toast below so the user sees the
        // outcome of the explicit confirm-to-delete.
        () => {}
    );
    // Companion POST mutation used purely as the undo closure for
    // the activity-feed Undo button. Re-creates the deleted project
    // with the captured before-state so the user can recover from an
    // accidental delete. Fire-and-forget — errors are swallowed.
    const { mutateAsync: undoDelete } = useReactMutation(
        "projects",
        "POST",
        ["projects"],
        undefined,
        () => {}
    );
    const { record: recordActivity } = useActivityFeed();
    const { startEditing, openModal } = useProjectModal();

    const sortedProjects = useMemo(
        () => sortProjects(dataSource ?? [], sortOrder),
        [dataSource, sortOrder]
    );

    const onLike = useCallback(
        (projectId: string) => {
            setPendingLikeId(projectId);
            update({ projectId })
                .catch(() => {
                    // Without this catch the heart icon stays stuck in its
                    // optimistic flipped state because `pendingLikeId` is
                    // never cleared on rejection.
                    message.error(microcopy.feedback.likeFailed);
                })
                .finally(() => {
                    setPendingLikeId("");
                });
        },
        [update]
    );

    const onDelete = (projectId: string) => {
        // Capture the full project payload BEFORE removal so the
        // activity-feed undo closure can POST it back if the user
        // changes their mind. After the mutation the dataSource has
        // been pruned and the lookup would return undefined.
        const beforeState = dataSource?.find(
            (project) => project._id === projectId
        );
        const projectName = beforeState?.projectName ?? "";
        Modal.confirm({
            centered: true,
            okText: microcopy.confirm.deleteProject.confirmLabel,
            cancelText: microcopy.actions.cancel,
            okButtonProps: { danger: true },
            title: microcopy.confirm.deleteProject.title,
            content: microcopy.confirm.deleteProject.description,
            onOk() {
                remove(
                    { projectId },
                    {
                        onSuccess: () => {
                            message.success(microcopy.feedback.projectDeleted);
                            // Phase 4.3 — record the delete into the
                            // activity feed only after the server
                            // confirms the deletion, so a 5xx leaves
                            // the feed clean. The 10s-window Undo
                            // closure re-POSTs the captured project so
                            // the user can recover from an accidental
                            // delete.
                            recordActivity({
                                kind: "project",
                                action: "delete",
                                summary: microcopyString(
                                    microcopy.activityFeed.descriptions
                                        .projectDeleted
                                ).replace("{name}", projectName),
                                undo: beforeState
                                    ? () => {
                                          void undoDelete(
                                              beforeState as unknown as Record<
                                                  string,
                                                  unknown
                                              >
                                          );
                                      }
                                    : undefined
                            });
                        },
                        onError: () =>
                            message.error(microcopy.feedback.saveFailed)
                    }
                );
            }
        });
    };

    const isLiked = (projectId: string): boolean => {
        const baseLiked = Boolean(user?.likedProjects?.includes(projectId));
        if (pendingLikeId === projectId) return !baseLiked;
        return baseLiked;
    };

    if (showSkeleton) {
        return (
            <ListSurface aria-busy>
                <Grid role="list" aria-label={microcopy.a11y.loadingProjects}>
                    {Array.from({ length: SKELETON_COUNT }, (_, idx) => (
                        <div
                            key={`${SKELETON_KEY_PREFIX}${idx}`}
                            role="listitem"
                            className="ant-skeleton"
                        >
                            <ProjectCardSkeleton />
                        </div>
                    ))}
                </Grid>
            </ListSurface>
        );
    }

    if (error) {
        // Page-level <Alert> is rendered by the calling page; render
        // nothing here so the user does not see a misleading empty state.
        return <ListSurface />;
    }

    if (sortedProjects.length === 0) {
        return (
            <ListSurface>
                <EmptyState
                    variant="projects"
                    title={microcopy.empty.projects.title}
                    description={microcopy.empty.projects.description}
                    cta={
                        <Button
                            aria-label={microcopy.actions.createProject}
                            icon={<PlusOutlined aria-hidden />}
                            onClick={openModal}
                            type="primary"
                        >
                            {microcopy.actions.createProject}
                        </Button>
                    }
                />
            </ListSurface>
        );
    }

    const projectCountLabel = (
        sortedProjects.length === 1
            ? microcopy.counts.projects.one
            : microcopy.counts.projects.other
    ).replace("{count}", String(sortedProjects.length));

    return (
        <ListSurface>
            <Toolbar>
                <ResultCount aria-live="polite">
                    {projectCountLabel}
                </ResultCount>
                <SortRow>
                    {microcopy.actions.sort}
                    <Select<SortOrder>
                        aria-label={microcopy.a11y.sortProjects}
                        onChange={setSortOrder}
                        options={buildSortOptions()}
                        size="small"
                        style={{ minWidth: 152 }}
                        value={sortOrder}
                        variant="borderless"
                    />
                </SortRow>
            </Toolbar>
            <Grid role="list" aria-label={microcopy.a11y.projects}>
                {sortedProjects.map((p) => (
                    <div key={p._id} role="listitem">
                        <ProjectCard
                            liked={isLiked(p._id)}
                            manager={members.find((m) => m._id === p.managerId)}
                            onDelete={() => onDelete(p._id)}
                            onEdit={() => startEditing(p._id)}
                            onLike={() => onLike(p._id)}
                            project={p}
                        />
                    </div>
                ))}
            </Grid>
        </ListSurface>
    );
};

export default ProjectList;
