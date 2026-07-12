import { Heart, MoreHorizontal, Trash2, Users } from "lucide-react";
import React from "react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { microcopy } from "../../constants/microcopy";
import { getActiveLocaleCode } from "../../i18n";
import { semantic } from "../../theme/tokens";
import { getAiSearchStrength } from "../../utils/ai/aiSearchStrength";
import usePrefetchProject from "../../utils/hooks/usePrefetchProject";
import AiMatchStrengthBadge from "../aiMatchStrengthBadge";
import SwipeableRow, { type SwipeAction } from "../swipeableRow";
import UserAvatar from "../userAvatar";

interface ProjectCardProps {
    project: IProject;
    manager?: IMember;
    liked: boolean;
    onLike: () => void;
    onEdit: () => void;
    onDelete: () => void;
}

/*
 * Card surface: a single padded tile with a hover/focus lift. The lift is
 * disabled on touch devices where hover feels janky.
 */
const CARD_CLASS = cn(
    "relative isolate flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-sm",
    "transition-[border-color,box-shadow,transform] duration-medium ease-standard",
    "hover:-translate-y-0.5 hover:border-glass-border-strong hover:shadow-md",
    "focus-within:-translate-y-0.5 focus-within:border-glass-border-strong focus-within:shadow-md",
    "[@media(hover:none)]:hover:translate-y-0 [@media(hover:none)]:hover:shadow-sm",
    "[@media(hover:none)]:focus-within:translate-y-0 [@media(hover:none)]:focus-within:shadow-sm"
);

const formatDate = (raw?: string): string => {
    if (!raw) return microcopy.feedback.noDate;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return microcopy.feedback.noDate;
    return new Intl.DateTimeFormat(getActiveLocaleCode(), {
        year: "numeric",
        month: "short",
        day: "2-digit"
    }).format(date);
};

/**
 * Single project card used inside the project list grid.
 *
 * Layout is two stacked rows inside one padded surface: a header row with a
 * small per-project monogram avatar inline with the title stack, and a meta
 * row that combines the manager identity, the AI match-strength badge (when
 * an AI search is active), the formatted date, and the secondary actions
 * (favorite, edit, delete).
 */
const ProjectCardComponent: React.FC<ProjectCardProps> = ({
    project,
    manager,
    liked,
    onLike,
    onEdit,
    onDelete
}) => {
    const navigate = useNavigate();
    const prefetchProject = usePrefetchProject();
    const warmProject = React.useCallback(
        () => prefetchProject(project._id),
        [prefetchProject, project._id]
    );
    const strength = getAiSearchStrength("projects", project._id);

    const favoriteAction: SwipeAction = {
        key: "favorite",
        label: liked
            ? microcopy.swipeActions.unfavorite
            : microcopy.swipeActions.favorite,
        icon: (
            <Heart aria-hidden className={liked ? "fill-current" : undefined} />
        ),
        background: semantic.favorite,
        foreground: "#fff",
        onCommit: onLike
    };
    const deleteAction: SwipeAction = {
        key: "delete",
        label: microcopy.actions.delete,
        icon: <Trash2 aria-hidden />,
        background: semantic.error,
        foreground: "#fff",
        destructive: true,
        onCommit: onDelete
    };

    return (
        // Hover/focus only warm the board query cache (a prefetch hint), not a
        // real activation — the card's actions live on the inner link/buttons.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <article
            className={CARD_CLASS}
            onFocus={warmProject}
            onMouseEnter={warmProject}
        >
            <SwipeableRow
                data-testid="project-card-swipe"
                leadingAction={favoriteAction}
                trailingAction={deleteAction}
            >
                <div className="relative z-0 flex flex-1 flex-col gap-sm p-md">
                    <div className="z-[2] flex min-w-0 items-center gap-sm">
                        <UserAvatar
                            id={project._id}
                            name={project.projectName}
                            size={40}
                            className="shrink-0"
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                            <span
                                className="block max-w-full min-w-0 truncate text-xs font-medium text-muted-foreground"
                                data-testid="project-organization"
                                title={project.organization || undefined}
                            >
                                {project.organization ||
                                    microcopy.labels.noOrganization}
                            </span>
                            <a
                                className={cn(
                                    "block overflow-hidden text-lg font-semibold leading-snug tracking-tight text-foreground no-underline",
                                    "[overflow-wrap:break-word] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]",
                                    "hover:text-primary focus-visible:text-primary",
                                    "after:absolute after:inset-0 after:z-[1] after:content-['']",
                                    "coarse:min-h-[44px]"
                                )}
                                href={`/projects/${project._id}`}
                                onClick={(event) => {
                                    if (
                                        event.metaKey ||
                                        event.ctrlKey ||
                                        event.shiftKey ||
                                        event.button !== 0
                                    ) {
                                        return;
                                    }
                                    event.preventDefault();
                                    navigate(`/projects/${project._id}`, {
                                        viewTransition: true
                                    });
                                }}
                            >
                                {project.projectName}
                            </a>
                        </div>
                    </div>
                    <div className="relative z-[2] mt-auto flex min-w-0 flex-wrap items-center justify-between gap-xs text-sm text-muted-foreground">
                        <span className="flex min-w-0 flex-1 items-center gap-xs overflow-hidden text-inherit">
                            {manager ? (
                                <>
                                    <UserAvatar
                                        id={manager._id}
                                        name={manager.username}
                                        size="small"
                                    />
                                    <span className="truncate">
                                        {manager.username}
                                    </span>
                                </>
                            ) : (
                                <>
                                    <Users
                                        aria-hidden
                                        className="size-4 shrink-0"
                                    />
                                    <span className="truncate">
                                        {microcopy.feedback.noManager}
                                    </span>
                                </>
                            )}
                            <span
                                aria-hidden
                                className="shrink-0 text-muted-foreground"
                            >
                                ·
                            </span>
                            {strength ? (
                                <AiMatchStrengthBadge strength={strength} />
                            ) : null}
                            <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                                {formatDate(project.createdAt)}
                            </span>
                        </span>
                        <div className="relative z-[3] isolate inline-flex shrink-0 items-center gap-xs">
                            <Button
                                aria-label={
                                    liked
                                        ? microcopy.a11y.unlikeProject.replace(
                                              "{name}",
                                              project.projectName
                                          )
                                        : microcopy.a11y.likeProject.replace(
                                              "{name}",
                                              project.projectName
                                          )
                                }
                                aria-pressed={liked}
                                className="coarse:min-w-[44px]"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onLike();
                                }}
                                size="sm"
                                variant="ghost"
                            >
                                <Heart
                                    aria-hidden
                                    className={
                                        liked ? "fill-current" : undefined
                                    }
                                    style={
                                        liked
                                            ? { color: semantic.favorite }
                                            : undefined
                                    }
                                />
                            </Button>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        aria-label={microcopy.a11y.moreActionsForProject.replace(
                                            "{name}",
                                            project.projectName
                                        )}
                                        className="coarse:min-w-[44px]"
                                        onClick={(e) => e.stopPropagation()}
                                        size="sm"
                                        variant="ghost"
                                    >
                                        <MoreHorizontal aria-hidden />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem onSelect={() => onEdit()}>
                                        {microcopy.actions.edit}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        onSelect={() => onDelete()}
                                    >
                                        {microcopy.actions.delete}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                </div>
            </SwipeableRow>
        </article>
    );
};

export const ProjectCardSkeleton: React.FC = () => (
    <article
        className={CARD_CLASS}
        aria-hidden
        data-testid="project-card-skeleton"
    >
        <div className="relative z-0 flex flex-1 flex-col gap-sm p-md">
            <div className="z-[2] flex min-w-0 items-center gap-sm">
                <Skeleton className="size-10 rounded-md" />
                <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-4 w-4/5" />
                </div>
            </div>
            <div className="mt-auto flex items-center justify-between gap-xs">
                <span className="flex flex-1 items-center gap-xs">
                    <Skeleton className="size-6 rounded-md" />
                    <Skeleton className="h-3 w-24" />
                </span>
                <Skeleton className="h-3 w-14" />
            </div>
        </div>
    </article>
);

/**
 * Memoized so a keystroke in the project search input (which re-renders
 * `ProjectList`) does not re-render every card in the grid — only the cards
 * whose props actually changed. The parent passes stable id-keyed callbacks
 * (see the `useCallback`-backed `handle*` factories in `ProjectList`), so the
 * default shallow comparison is correct here.
 */
const ProjectCard = React.memo(ProjectCardComponent);
ProjectCard.displayName = "ProjectCard";

export default ProjectCard;
