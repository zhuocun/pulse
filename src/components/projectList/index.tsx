import { Plus } from "lucide-react";
import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import useAppMessage from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { microcopy, microcopyString } from "../../constants/microcopy";
import { getActiveLocaleCode } from "../../i18n";
import type { ProjectListSort } from "../../store/reducers/userPreferencesSlice";
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
    /**
     * Phase 4.2 — sort order is now URL-state (owned by the project
     * page) so the page can apply the user's saved default on first
     * load. Both props are optional so the legacy callers that only
     * mount the list keep working — the component falls back to an
     * internal `useState` then.
     */
    sortOrder?: ProjectListSort;
    onSortOrderChange?: (next: ProjectListSort) => void;
}

/**
 * antd-free `Button`-like affordance re-exported for older call sites
 * (`header`, `column`, popovers) that still expect the project list module
 * to expose this primitive. It is a zero-padding, text-styled button that
 * accepts the antd `Button` prop subset those callers pass (`type`,
 * `danger`, `icon`, `size`). New code should prefer a locally-styled
 * `<Button>` from `@/components/ui/button` instead.
 */
export interface NoPaddingButtonProps extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "type"
> {
    type?: "default" | "primary" | "text" | "link" | "dashed" | "ghost";
    htmlType?: "button" | "submit" | "reset";
    danger?: boolean;
    icon?: React.ReactNode;
    size?: "small" | "middle" | "large";
    block?: boolean;
    loading?: boolean;
}

export const NoPaddingButton = React.forwardRef<
    HTMLButtonElement,
    NoPaddingButtonProps
>(
    (
        {
            className,
            type = "default",
            htmlType,
            danger,
            icon,
            size: _size,
            block,
            loading,
            children,
            disabled,
            ...rest
        },
        ref
    ) => (
        <button
            ref={ref}
            type={htmlType ?? "button"}
            disabled={disabled ?? loading}
            className={cn(
                "inline-flex cursor-pointer items-center justify-center gap-xs border-0 bg-transparent p-0 font-medium",
                "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:cursor-not-allowed disabled:opacity-50",
                "[&_svg]:size-4 [&_svg]:shrink-0",
                danger
                    ? "text-destructive hover:text-destructive/80"
                    : type === "link" || type === "primary"
                      ? "text-primary hover:text-primary/80"
                      : "text-foreground hover:text-primary",
                type === "link" && "hover:underline",
                block && "w-full",
                className
            )}
            {...rest}
        >
            {icon}
            {children}
        </button>
    )
);
NoPaddingButton.displayName = "NoPaddingButton";

const SKELETON_COUNT = 6;

/*
 * Client-side pagination (Phase 2.2 §1.2 item 6). Twelve fills three to four
 * grid rows on desktop without crowding; the size-changer lets power users
 * widen the page to 24 / 48.
 */
const DEFAULT_PAGE_SIZE = 12;
const PAGE_SIZE_OPTIONS = [12, 24, 48];

const buildSortOptions = (): { label: string; value: ProjectListSort }[] => [
    {
        label: microcopy.options.projectListSort.createdAtDesc,
        value: "createdAt-desc"
    },
    {
        label: microcopy.options.projectListSort.createdAtAsc,
        value: "createdAt-asc"
    },
    {
        label: microcopy.options.projectListSort.nameAsc,
        value: "name-asc"
    },
    {
        label: microcopy.options.projectListSort.nameDesc,
        value: "name-desc"
    },
    {
        label: microcopy.options.projectListSort.favoritedFirst,
        value: "favorited-first"
    }
];

const projectCreatedAtTime = (raw?: string): number => {
    if (!raw) return 0;
    const time = new Date(raw).getTime();
    return Number.isNaN(time) ? 0 : time;
};

const sortProjects = (
    projects: IProject[],
    order: ProjectListSort,
    likedSet: ReadonlySet<string>
): IProject[] => {
    const out = [...projects];
    const locale = getActiveLocaleCode();
    switch (order) {
        case "name-desc":
            out.sort((a, b) =>
                b.projectName.localeCompare(a.projectName, locale)
            );
            break;
        case "name-asc":
            out.sort((a, b) =>
                a.projectName.localeCompare(b.projectName, locale)
            );
            break;
        case "createdAt-asc":
            out.sort(
                (a, b) =>
                    projectCreatedAtTime(a.createdAt) -
                    projectCreatedAtTime(b.createdAt)
            );
            break;
        case "favorited-first":
            out.sort((a, b) => {
                const aLiked = likedSet.has(a._id);
                const bLiked = likedSet.has(b._id);
                if (aLiked !== bLiked) return aLiked ? -1 : 1;
                return a.projectName.localeCompare(b.projectName, locale);
            });
            break;
        case "createdAt-desc":
        default:
            out.sort(
                (a, b) =>
                    projectCreatedAtTime(b.createdAt) -
                    projectCreatedAtTime(a.createdAt)
            );
    }
    return out;
};

interface PendingDelete {
    projectId: string;
    projectName: string;
    beforeState?: IProject;
}

const ProjectList: React.FC<Props> = ({
    dataSource,
    members,
    error,
    loading,
    sortOrder: sortOrderProp,
    onSortOrderChange
}) => {
    const message = useAppMessage();
    const { user } = useAuth();
    const [pendingLikeId, setPendingLikeId] = useState("");
    const [internalSort, setInternalSort] =
        useState<ProjectListSort>("createdAt-desc");
    const sortOrder = sortOrderProp ?? internalSort;
    const setSortOrder = (next: ProjectListSort) => {
        if (onSortOrderChange) {
            onSortOrderChange(next);
        } else {
            setInternalSort(next);
        }
    };
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
        // dedicated success/failure toast below.
        () => {}
    );
    const { mutateAsync: undoDelete } = useReactMutation(
        "projects",
        "POST",
        ["projects"],
        undefined,
        () => {}
    );
    const { record: recordActivity } = useActivityFeed();
    const { startEditing, openModal } = useProjectModal();

    const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
        null
    );

    const likedSet = useMemo(
        () => new Set(user?.likedProjects ?? []),
        [user?.likedProjects]
    );
    const sortedProjects = useMemo(
        () => sortProjects(dataSource ?? [], sortOrder, likedSet),
        [dataSource, sortOrder, likedSet]
    );

    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
    const total = sortedProjects.length;

    const resultSignature = sortedProjects.map((p) => p._id).join("|");
    useEffect(() => {
        setPage(1);
    }, [resultSignature]);

    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, pageCount);
    const pagedProjects = useMemo(
        () =>
            sortedProjects.slice(
                (safePage - 1) * pageSize,
                (safePage - 1) * pageSize + pageSize
            ),
        [sortedProjects, safePage, pageSize]
    );

    const onLike = useCallback(
        (projectId: string) => {
            setPendingLikeId(projectId);
            update({ projectId })
                .catch(() => {
                    message.error(microcopy.feedback.likeFailed);
                })
                .finally(() => {
                    setPendingLikeId("");
                });
        },
        [message, update]
    );

    const requestDelete = useCallback(
        (projectId: string) => {
            const beforeState = dataSource?.find(
                (project) => project._id === projectId
            );
            setPendingDelete({
                projectId,
                projectName: beforeState?.projectName ?? "",
                beforeState
            });
        },
        [dataSource]
    );

    const confirmDelete = useCallback(() => {
        if (!pendingDelete) return;
        const { projectId, projectName, beforeState } = pendingDelete;
        setPendingDelete(null);
        remove(
            { projectId },
            {
                onSuccess: () => {
                    message.success(microcopy.feedback.projectDeleted);
                    recordActivity({
                        kind: "project",
                        action: "delete",
                        summary: microcopyString(
                            microcopy.activityFeed.descriptions.projectDeleted
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
                onError: () => message.error(microcopy.feedback.saveFailed)
            }
        );
    }, [message, pendingDelete, recordActivity, remove, undoDelete]);

    const isLiked = (projectId: string): boolean => {
        const baseLiked = Boolean(user?.likedProjects?.includes(projectId));
        if (pendingLikeId === projectId) return !baseLiked;
        return baseLiked;
    };

    /*
     * Stable per-project handler cache. `ProjectCard` is `React.memo`'d, so a
     * freshly-allocated arrow on every render would change the prop identity
     * on each keystroke and re-render every card. We bind each card's
     * id-less callbacks once and reuse the same refs across renders.
     */
    const getCardHandlers = useMemo(() => {
        const cache = new Map<
            string,
            { onLike: () => void; onEdit: () => void; onDelete: () => void }
        >();
        return (projectId: string) => {
            const existing = cache.get(projectId);
            if (existing) return existing;
            const handlers = {
                onLike: () => onLike(projectId),
                onEdit: () => startEditing(projectId),
                onDelete: () => requestDelete(projectId)
            };
            cache.set(projectId, handlers);
            return handlers;
        };
    }, [onLike, requestDelete, startEditing]);

    const deleteDialog = (
        <Dialog
            open={pendingDelete !== null}
            onOpenChange={(open) => {
                if (!open) setPendingDelete(null);
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {microcopy.confirm.deleteProject.title}
                    </DialogTitle>
                    <DialogDescription>
                        {microcopy.confirm.deleteProject.description}
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button
                        onClick={() => setPendingDelete(null)}
                        variant="default"
                    >
                        {microcopy.actions.cancel}
                    </Button>
                    <Button onClick={confirmDelete} variant="destructive">
                        {microcopy.confirm.deleteProject.confirmLabel}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );

    if (showSkeleton) {
        return (
            <section aria-busy className="flex flex-col gap-md">
                <div
                    role="list"
                    aria-label={microcopy.a11y.loadingProjects}
                    className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-md sm:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] sm:gap-lg"
                >
                    {Array.from({ length: SKELETON_COUNT }, (_, idx) => (
                        <div
                            key={`__skeleton__${idx}`}
                            role="listitem"
                            data-testid="project-skeleton"
                        >
                            <ProjectCardSkeleton />
                        </div>
                    ))}
                </div>
            </section>
        );
    }

    if (error) {
        return <section className="flex flex-col gap-md" />;
    }

    if (sortedProjects.length === 0) {
        return (
            <section className="flex flex-col gap-md">
                <EmptyState
                    variant="projects"
                    title={microcopy.empty.projects.title}
                    description={microcopy.empty.projects.description}
                    cta={
                        <Button
                            aria-label={microcopy.actions.createProject}
                            onClick={openModal}
                            variant="primary"
                        >
                            <Plus aria-hidden />
                            {microcopy.actions.createProject}
                        </Button>
                    }
                />
            </section>
        );
    }

    const projectCountLabel = (
        sortedProjects.length === 1
            ? microcopy.counts.projects.one
            : microcopy.counts.projects.other
    ).replace("{count}", String(sortedProjects.length));

    return (
        <section className="flex flex-col gap-md">
            {deleteDialog}
            <div className="flex flex-wrap items-center justify-between gap-sm text-sm text-muted-foreground">
                <span aria-live="polite" className="font-medium tracking-tight">
                    {projectCountLabel}
                </span>
                <span className="inline-flex items-center gap-xs text-xs font-medium text-muted-foreground">
                    {microcopy.actions.sort}
                    <Select
                        onValueChange={(value) =>
                            setSortOrder(value as ProjectListSort)
                        }
                        value={sortOrder}
                    >
                        <SelectTrigger
                            aria-label={microcopy.a11y.sortProjects}
                            className="h-8 w-auto min-w-[152px] border-0 bg-transparent"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {buildSortOptions().map((option) => (
                                <SelectItem
                                    key={option.value}
                                    value={option.value}
                                >
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </span>
            </div>
            <div
                role="list"
                aria-label={microcopy.a11y.projects}
                className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-md sm:grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] sm:gap-lg"
            >
                {pagedProjects.map((p) => {
                    const handlers = getCardHandlers(p._id);
                    return (
                        <div key={p._id} role="listitem">
                            <ProjectCard
                                liked={isLiked(p._id)}
                                manager={members.find(
                                    (m) => m._id === p.managerId
                                )}
                                onDelete={handlers.onDelete}
                                onEdit={handlers.onEdit}
                                onLike={handlers.onLike}
                                project={p}
                            />
                        </div>
                    );
                })}
            </div>
            {total > PAGE_SIZE_OPTIONS[0] ? (
                <nav
                    aria-label={microcopy.a11y.projectPagination}
                    className="flex flex-wrap items-center justify-center gap-xs sm:justify-end"
                >
                    {Array.from({ length: pageCount }, (_, idx) => idx + 1).map(
                        (n) => (
                            <Button
                                key={n}
                                aria-current={
                                    n === safePage ? "page" : undefined
                                }
                                className="size-8 min-w-8 px-0"
                                onClick={() => setPage(n)}
                                size="sm"
                                variant={n === safePage ? "primary" : "default"}
                            >
                                {n}
                            </Button>
                        )
                    )}
                    <Select
                        onValueChange={(value) => {
                            setPageSize(Number(value));
                            setPage(1);
                        }}
                        value={String(pageSize)}
                    >
                        <SelectTrigger
                            aria-label={microcopy.a11y.projectPagination}
                            className="h-8 w-auto"
                        >
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {PAGE_SIZE_OPTIONS.map((size) => (
                                <SelectItem key={size} value={String(size)}>
                                    {String(size)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </nav>
            ) : null}
        </section>
    );
};

export default ProjectList;
