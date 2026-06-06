import {
    DeleteOutlined,
    InboxOutlined,
    RollbackOutlined
} from "@ant-design/icons";
import styled from "@emotion/styled";
import { Button, Empty, Popconfirm, Typography } from "antd";
import React, { useCallback } from "react";

import { microcopy, microcopyString } from "../../constants/microcopy";
import { fontSize, fontWeight, radius, space } from "../../theme/tokens";
import useAppMessage from "../../utils/hooks/useAppMessage";
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

const DrawerHeader = styled.div`
    align-items: center;
    display: flex;
    gap: ${space.xs}px;
    justify-content: space-between;
    padding-bottom: ${space.xs}px;
`;

const List = styled.ul`
    display: flex;
    flex-direction: column;
    gap: ${space.xxs}px;
    list-style: none;
    margin: 0;
    padding: 0;
`;

const Row = styled.li`
    align-items: flex-start;
    border-radius: ${radius.md}px;
    display: flex;
    gap: ${space.xs}px;
    padding: ${space.xs}px ${space.sm}px;
`;

const RowBody = styled.div`
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
`;

const RowName = styled(Typography.Text)`
    && {
        font-size: ${fontSize.sm}px;
        font-weight: ${fontWeight.medium};
        word-break: break-word;
    }
`;

const RowMeta = styled(Typography.Text)`
    && {
        color: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.45));
        font-size: ${fontSize.xs}px;
    }
`;

const RowActions = styled.div`
    align-items: center;
    display: flex;
    flex: 0 0 auto;
    gap: ${space.xxs}px;
`;

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
        <div data-testid="archive-drawer-body">
            <DrawerHeader>
                <Typography.Text strong style={{ fontSize: fontSize.sm }}>
                    {drawerTitle}
                </Typography.Text>
            </DrawerHeader>
            {!isLoading && archivedTasks.length === 0 ? (
                <Empty
                    data-testid="archive-drawer-empty"
                    description={
                        <span>
                            <Typography.Text strong>
                                {microcopyString(
                                    microcopy.archiveDrawer.empty.title
                                )}
                            </Typography.Text>
                            <br />
                            <Typography.Text type="secondary">
                                {microcopyString(
                                    microcopy.archiveDrawer.empty.description
                                )}
                            </Typography.Text>
                        </span>
                    }
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
            ) : (
                <List data-testid="archive-drawer-list">
                    {archivedTasks.map((archivedTask) => (
                        <Row
                            key={archivedTask._id}
                            data-testid="archive-drawer-row"
                            data-task-id={archivedTask._id}
                        >
                            <RowBody>
                                <RowName>{archivedTask.taskName}</RowName>
                                <RowMeta>{archivedTask.type}</RowMeta>
                            </RowBody>
                            <RowActions>
                                <Button
                                    aria-label={microcopyString(
                                        microcopy.archiveDrawer
                                            .unarchiveAriaLabel
                                    ).replace("{name}", archivedTask.taskName)}
                                    data-testid="archive-drawer-unarchive"
                                    disabled={actionsBusy}
                                    icon={<RollbackOutlined aria-hidden />}
                                    onClick={() =>
                                        handleUnarchive(archivedTask._id)
                                    }
                                    size="small"
                                    type="text"
                                >
                                    {microcopyString(
                                        microcopy.archiveDrawer.unarchive
                                    )}
                                </Button>
                                <Popconfirm
                                    cancelText={microcopyString(
                                        microcopy.actions.cancel
                                    )}
                                    description={microcopyString(
                                        microcopy.archiveDrawer.confirm
                                            .description
                                    )}
                                    okButtonProps={{ danger: true }}
                                    okText={microcopyString(
                                        microcopy.archiveDrawer.confirm
                                            .confirmLabel
                                    )}
                                    onConfirm={() =>
                                        handlePurge(archivedTask._id)
                                    }
                                    title={microcopyString(
                                        microcopy.archiveDrawer.confirm.title
                                    )}
                                >
                                    <Button
                                        aria-label={microcopyString(
                                            microcopy.archiveDrawer
                                                .deletePermanentlyAriaLabel
                                        ).replace(
                                            "{name}",
                                            archivedTask.taskName
                                        )}
                                        danger
                                        data-testid="archive-drawer-purge"
                                        disabled={actionsBusy}
                                        icon={<DeleteOutlined aria-hidden />}
                                        size="small"
                                        type="text"
                                    >
                                        {microcopyString(
                                            microcopy.archiveDrawer
                                                .deletePermanently
                                        )}
                                    </Button>
                                </Popconfirm>
                            </RowActions>
                        </Row>
                    ))}
                </List>
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
            onClose={onClose}
            open={open}
            title={
                <span>
                    <InboxOutlined aria-hidden style={{ marginInlineEnd: 8 }} />
                    {drawerTitle}
                </span>
            }
        >
            {body}
        </Sheet>
    );
};

export default ArchiveDrawer;
