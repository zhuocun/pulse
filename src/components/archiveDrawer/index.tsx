import { ArchiveRestore, Inbox, Trash2 } from "lucide-react";
import React, { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import useAppMessage from "@/components/ui/toast";
import { Typography } from "@/components/ui/typography";

import { microcopy, microcopyString } from "../../constants/microcopy";
import { space } from "../../theme/tokens";
import useReactMutation from "../../utils/hooks/useReactMutation";
import useReactQuery from "../../utils/hooks/useReactQuery";
import Sheet from "../sheet";

/**
 * Work-management-depth §5.4/§5.6 — Archive drawer.
 *
 * A read-only, board-scoped surface that lists the project's archived
 * tasks (the backend's `GET /tasks?includeArchived=true` projection) and
 * gives each one two recovery affordances:
 *
 *   • Unarchive — `PUT /tasks/archive { _id, archived: false }` clears the
 *     task's `archivedAt` ONLY (leaving any independent `deletedAt`
 *     untouched) so it reappears on the board. This is the dedicated
 *     unarchive endpoint — NOT `/tasks/restore`, which clears both
 *     markers and would also un-trash an independently-trashed task.
 *   • Delete permanently — `DELETE /tasks?taskId=…&purge=true` hard-deletes
 *     it, behind an AntD `Popconfirm` (mirrors the destructive-confirm
 *     idiom used by `commentsThread`).
 *
 * It mirrors `TrashDrawer` end-to-end: a `<Sheet>`-based drawer (phone
 * multi-detent surface vs. desktop right shelf), an `<Empty>` state, and
 * per-row aria-labels carrying the task name. Its open/close state lives
 * on the Redux `overlays` slice via `useArchiveDrawer`, exactly like the
 * rest of the overlay family.
 *
 * CRITICAL — cache invalidation: the archive list (`["tasks", { projectId,
 * includeArchived: true }]`) and the board's own list (`["tasks",
 * { projectId }]`) are DISTINCT React Query keys. Both unarchive and purge
 * must refresh BOTH so the unarchived task leaves the archive list AND
 * (re)appears on / disappears from the board. We pass the bare `["tasks"]`
 * prefix as the mutation's invalidation key — React Query v5
 * `invalidateQueries` does partial (prefix) matching by default, so the
 * single prefix invalidates every `["tasks", …]` observer in one call.
 */

/**
 * Destructive-confirm affordance replacing antd `Popconfirm`. The trigger
 * button opens a small `Popover` (click-to-open, unlike a dropdown menu)
 * carrying the title / description and a destructive confirm plus a cancel
 * button; confirming fires `onConfirm` and closes the popover.
 */
interface PurgeConfirmButtonProps {
    triggerAriaLabel: string;
    triggerLabel: string;
    disabled?: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: () => void;
}

const PurgeConfirmButton: React.FC<PurgeConfirmButtonProps> = ({
    triggerAriaLabel,
    triggerLabel,
    disabled,
    title,
    description,
    confirmLabel,
    cancelLabel,
    onConfirm
}) => {
    const [open, setOpen] = useState(false);
    return (
        <Popover onOpenChange={setOpen} open={open}>
            <PopoverTrigger asChild>
                <Button
                    aria-label={triggerAriaLabel}
                    className="!h-auto !p-0 text-destructive hover:text-destructive/80"
                    data-testid="archive-drawer-purge"
                    disabled={disabled}
                    size="sm"
                    variant="ghost"
                >
                    <Trash2 aria-hidden />
                    {triggerLabel}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="end"
                aria-label={title}
                className="w-auto max-w-[280px] p-sm"
            >
                <div className="text-sm font-semibold text-foreground">
                    {title}
                </div>
                <div className="mt-xxs text-sm text-muted-foreground">
                    {description}
                </div>
                <div className="mt-sm flex justify-end gap-xs">
                    <Button
                        onClick={() => setOpen(false)}
                        size="sm"
                        variant="default"
                    >
                        {cancelLabel}
                    </Button>
                    <Button
                        onClick={() => {
                            onConfirm();
                            setOpen(false);
                        }}
                        size="sm"
                        variant="destructive"
                    >
                        {confirmLabel}
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
};

interface ArchiveDrawerProps {
    open: boolean;
    onClose: () => void;
    /**
     * The board's project. Passed in (rather than read from the URL) so
     * the drawer stays a pure presentational mirror of `TrashDrawer` — the
     * board page already owns `projectId` from `useParams`.
     */
    projectId?: string;
}

const ArchiveDrawer: React.FC<ArchiveDrawerProps> = ({
    open,
    onClose,
    projectId
}) => {
    // AntD v6: the static `message` import warns it can't read dynamic
    // theme. `useAppMessage()` returns a theme-aware instance (with a
    // static fallback for tests that render without `<App>`).
    const message = useAppMessage();

    /*
     * Archived-task list. DISTINCT key from the board's `["tasks",
     * { projectId }]` — `includeArchived: true` survives `filterRequest`
     * (booleans aren't void) so the query key carries the flag and the
     * GET resolves to `?projectId=…&includeArchived=true`. Disabled until
     * the drawer is open AND a project is in scope so the closed drawer
     * never fetches.
     */
    const { data, isLoading } = useReactQuery<ITask[]>(
        "tasks",
        { projectId, includeArchived: true },
        undefined,
        undefined,
        undefined,
        open && Boolean(projectId)
    );
    /*
     * Filter to only genuinely-archived rows. `GET /tasks?includeArchived=true`
     * WIDENS the response to active + archived (the flag opts archived rows IN;
     * it does NOT scope the list to only-archived — see `ITask.archivedAt`), so
     * without this guard every live board task would surface in the archive.
     */
    const archivedTasks = (data ?? []).filter((archivedTask) =>
        Boolean(archivedTask.archivedAt)
    );

    /*
     * Both mutations invalidate the `["tasks"]` PREFIX (not a specific
     * key) so React Query's partial-match refetches both the archive list
     * and the board list — the unarchived row leaves the archive and the
     * board picks the task back up (or drops the purged one). See the
     * component doc for the prefix-match rationale.
     */
    const { mutate: unarchive, isLoading: unarchiving } = useReactMutation(
        "tasks/archive",
        "PUT",
        ["tasks"],
        undefined,
        () =>
            message.error(
                microcopyString(microcopy.feedback.taskUnarchiveFailed)
            )
    );
    const { mutate: purge, isLoading: purging } = useReactMutation(
        "tasks",
        "DELETE",
        ["tasks"],
        undefined,
        () => message.error(microcopyString(microcopy.feedback.taskPurgeFailed))
    );

    const handleUnarchive = useCallback(
        (taskId: string) => {
            unarchive(
                { _id: taskId, archived: false },
                {
                    onSuccess: () =>
                        message.success(
                            microcopyString(microcopy.feedback.taskUnarchived)
                        )
                }
            );
        },
        [unarchive, message]
    );

    const handlePurge = useCallback(
        (taskId: string) => {
            purge(
                { taskId, purge: true },
                {
                    onSuccess: () =>
                        message.success(
                            microcopyString(microcopy.feedback.taskPurged)
                        )
                }
            );
        },
        [purge, message]
    );

    const drawerTitle = microcopyString(microcopy.archiveDrawer.drawerTitle);
    const actionsBusy = unarchiving || purging;

    const body = (
        <div aria-busy={isLoading} data-testid="archive-drawer-body">
            <div className="flex items-center justify-between gap-xs pb-xs">
                <Typography.Text className="text-sm" strong>
                    {drawerTitle}
                </Typography.Text>
            </div>
            {isLoading ? (
                <div
                    className="flex flex-col gap-sm p-sm"
                    data-testid="archive-drawer-loading"
                    role="status"
                >
                    <Typography.Text type="secondary">
                        {microcopyString(microcopy.archiveDrawer.loading)}
                    </Typography.Text>
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                </div>
            ) : archivedTasks.length === 0 ? (
                <Empty
                    data-testid="archive-drawer-empty"
                    description={microcopyString(
                        microcopy.archiveDrawer.empty.description
                    )}
                    title={microcopyString(microcopy.archiveDrawer.empty.title)}
                />
            ) : (
                <ul
                    className="m-0 flex list-none flex-col gap-xxs p-0"
                    data-testid="archive-drawer-list"
                >
                    {archivedTasks.map((archivedTask) => (
                        <li
                            className="flex items-start gap-xs rounded-md px-sm py-xs"
                            key={archivedTask._id}
                            data-testid="archive-drawer-row"
                            data-task-id={archivedTask._id}
                        >
                            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                                <Typography.Text className="text-sm font-medium break-words">
                                    {archivedTask.taskName}
                                </Typography.Text>
                                <Typography.Text className="text-xs [color:var(--ant-color-text-tertiary,rgba(15,23,42,0.45))]">
                                    {archivedTask.type}
                                </Typography.Text>
                            </div>
                            <div className="flex flex-none items-center gap-xxs">
                                <Button
                                    aria-label={microcopyString(
                                        microcopy.archiveDrawer
                                            .unarchiveAriaLabel
                                    ).replace("{name}", archivedTask.taskName)}
                                    className="!h-auto !p-0"
                                    data-testid="archive-drawer-unarchive"
                                    disabled={actionsBusy}
                                    onClick={() =>
                                        handleUnarchive(archivedTask._id)
                                    }
                                    size="sm"
                                    variant="ghost"
                                >
                                    <ArchiveRestore aria-hidden />
                                    {microcopyString(
                                        microcopy.archiveDrawer.unarchive
                                    )}
                                </Button>
                                <PurgeConfirmButton
                                    cancelLabel={microcopyString(
                                        microcopy.actions.cancel
                                    )}
                                    confirmLabel={microcopyString(
                                        microcopy.archiveDrawer.confirm
                                            .confirmLabel
                                    )}
                                    description={microcopyString(
                                        microcopy.archiveDrawer.confirm
                                            .description
                                    )}
                                    disabled={actionsBusy}
                                    onConfirm={() =>
                                        handlePurge(archivedTask._id)
                                    }
                                    title={microcopyString(
                                        microcopy.archiveDrawer.confirm.title
                                    )}
                                    triggerAriaLabel={microcopyString(
                                        microcopy.archiveDrawer
                                            .deletePermanentlyAriaLabel
                                    ).replace("{name}", archivedTask.taskName)}
                                    triggerLabel={microcopyString(
                                        microcopy.archiveDrawer
                                            .deletePermanently
                                    )}
                                />
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );

    return (
        <Sheet
            closable
            data-testid="archive-drawer"
            defaultDetent="medium"
            detents={["medium", "large"]}
            /*
             * Sheet handles the phone vs. desktop split internally
             * (useIsPhoneChrome): phone → animated multi-detent surface,
             * desktop / tablet → AntD right-shelf Drawer. Mirrors
             * `TrashDrawer`'s placement / size choices.
             */
            desktopPlacement="right"
            desktopSize="default"
            closeAriaLabel={microcopyString(microcopy.actions.close)}
            onClose={onClose}
            open={open}
            styles={{
                body: {
                    paddingBottom: `max(${space.lg}px, env(safe-area-inset-bottom))`
                }
            }}
            title={
                <span className="inline-flex items-center gap-xs">
                    <Inbox aria-hidden className="size-4" />
                    {drawerTitle}
                </span>
            }
        >
            {body}
        </Sheet>
    );
};

export default ArchiveDrawer;
