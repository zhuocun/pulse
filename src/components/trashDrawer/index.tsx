import { DeleteOutlined, UndoOutlined } from "@ant-design/icons";
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
 * Work-management-depth §5.4/§5.6 — Trash drawer.
 *
 * A read-only, board-scoped surface that lists the project's soft-deleted
 * tasks (the backend's `GET /tasks?includeTrashed=true` projection) and
 * gives each one two recovery affordances:
 *
 *   • Restore — `PUT /tasks/restore { _id }` un-deletes the task so it
 *     reappears on the board.
 *   • Delete permanently — `DELETE /tasks?taskId=…&purge=true` hard-deletes
 *     it, behind an AntD `Popconfirm` (mirrors the destructive-confirm
 *     idiom used by `commentsThread`).
 *
 * It mirrors `ActivityFeedDrawer` end-to-end: a `<Sheet>`-based drawer
 * (phone multi-detent surface vs. desktop right shelf), an `<Empty>`
 * state, and per-row aria-labels carrying the task name. Its open/close
 * state lives on the Redux `overlays` slice via `useTrashDrawer`, exactly
 * like the rest of the overlay family.
 *
 * CRITICAL — cache invalidation: the trash list (`["tasks", { projectId,
 * includeTrashed: true }]`) and the board's own list (`["tasks",
 * { projectId }]`) are DISTINCT React Query keys. Both restore and purge
 * must refresh BOTH so the restored task leaves the trash list AND
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

interface TrashDrawerProps {
    open: boolean;
    onClose: () => void;
    /**
     * The board's project. Passed in (rather than read from the URL) so
     * the drawer stays a pure presentational mirror of `ActivityFeedDrawer`
     * — the board page already owns `projectId` from `useParams`.
     */
    projectId?: string;
}

const TrashDrawer: React.FC<TrashDrawerProps> = ({
    open,
    onClose,
    projectId
}) => {
    // AntD v6: the static `message` import warns it can't read dynamic
    // theme. `useAppMessage()` returns a theme-aware instance (with a
    // static fallback for tests that render without `<App>`).
    const message = useAppMessage();

    /*
     * Trashed-task list. DISTINCT key from the board's `["tasks",
     * { projectId }]` — `includeTrashed: true` survives `filterRequest`
     * (booleans aren't void) so the query key carries the flag and the
     * GET resolves to `?projectId=…&includeTrashed=true`. Disabled until
     * the drawer is open AND a project is in scope so the closed drawer
     * never fetches.
     */
    const { data, isLoading } = useReactQuery<ITask[]>(
        "tasks",
        { projectId, includeTrashed: true },
        undefined,
        undefined,
        undefined,
        open && Boolean(projectId)
    );
    /*
     * Filter to only genuinely-trashed rows. `GET /tasks?includeTrashed=true`
     * WIDENS the response to active + trashed (the flag opts trashed rows IN;
     * it does NOT scope the list to only-trashed — see `ITask.deletedAt`), so
     * without this guard every live board task would surface in the trash.
     */
    const trashedTasks = (data ?? []).filter((trashedTask) =>
        Boolean(trashedTask.deletedAt)
    );

    /*
     * Both mutations invalidate the `["tasks"]` PREFIX (not a specific
     * key) so React Query's partial-match refetches both the trash list
     * and the board list — the restored row leaves the trash and the
     * board picks the task back up (or drops the purged one). See the
     * component doc for the prefix-match rationale.
     */
    const { mutate: restore, isLoading: restoring } = useReactMutation(
        "tasks/restore",
        "PUT",
        ["tasks"],
        undefined,
        () =>
            message.error(microcopyString(microcopy.feedback.taskRestoreFailed))
    );
    const { mutate: purge, isLoading: purging } = useReactMutation(
        "tasks",
        "DELETE",
        ["tasks"],
        undefined,
        () => message.error(microcopyString(microcopy.feedback.taskPurgeFailed))
    );

    const handleRestore = useCallback(
        (taskId: string) => {
            restore(
                { _id: taskId },
                {
                    onSuccess: () =>
                        message.success(
                            microcopyString(microcopy.feedback.taskRestored)
                        )
                }
            );
        },
        [restore, message]
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

    const drawerTitle = microcopyString(microcopy.trashDrawer.drawerTitle);
    const actionsBusy = restoring || purging;

    const body = (
        <div data-testid="trash-drawer-body">
            <DrawerHeader>
                <Typography.Text strong style={{ fontSize: fontSize.sm }}>
                    {drawerTitle}
                </Typography.Text>
            </DrawerHeader>
            {!isLoading && trashedTasks.length === 0 ? (
                <Empty
                    data-testid="trash-drawer-empty"
                    description={
                        <span>
                            <Typography.Text strong>
                                {microcopyString(
                                    microcopy.trashDrawer.empty.title
                                )}
                            </Typography.Text>
                            <br />
                            <Typography.Text type="secondary">
                                {microcopyString(
                                    microcopy.trashDrawer.empty.description
                                )}
                            </Typography.Text>
                        </span>
                    }
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
            ) : (
                <List data-testid="trash-drawer-list">
                    {trashedTasks.map((trashedTask) => (
                        <Row
                            key={trashedTask._id}
                            data-testid="trash-drawer-row"
                            data-task-id={trashedTask._id}
                        >
                            <RowBody>
                                <RowName>{trashedTask.taskName}</RowName>
                                <RowMeta>{trashedTask.type}</RowMeta>
                            </RowBody>
                            <RowActions>
                                <Button
                                    aria-label={microcopyString(
                                        microcopy.trashDrawer.restoreAriaLabel
                                    ).replace("{name}", trashedTask.taskName)}
                                    data-testid="trash-drawer-restore"
                                    disabled={actionsBusy}
                                    icon={<UndoOutlined aria-hidden />}
                                    onClick={() =>
                                        handleRestore(trashedTask._id)
                                    }
                                    size="small"
                                    type="text"
                                >
                                    {microcopyString(
                                        microcopy.trashDrawer.restore
                                    )}
                                </Button>
                                <Popconfirm
                                    cancelText={microcopyString(
                                        microcopy.actions.cancel
                                    )}
                                    description={microcopyString(
                                        microcopy.trashDrawer.confirm
                                            .description
                                    )}
                                    okButtonProps={{ danger: true }}
                                    okText={microcopyString(
                                        microcopy.trashDrawer.confirm
                                            .confirmLabel
                                    )}
                                    onConfirm={() =>
                                        handlePurge(trashedTask._id)
                                    }
                                    title={microcopyString(
                                        microcopy.trashDrawer.confirm.title
                                    )}
                                >
                                    <Button
                                        aria-label={microcopyString(
                                            microcopy.trashDrawer
                                                .deletePermanentlyAriaLabel
                                        ).replace(
                                            "{name}",
                                            trashedTask.taskName
                                        )}
                                        danger
                                        data-testid="trash-drawer-purge"
                                        disabled={actionsBusy}
                                        icon={<DeleteOutlined aria-hidden />}
                                        size="small"
                                        type="text"
                                    >
                                        {microcopyString(
                                            microcopy.trashDrawer
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
            data-testid="trash-drawer"
            defaultDetent="medium"
            detents={["medium", "large"]}
            /*
             * Sheet handles the phone vs. desktop split internally
             * (useIsPhoneChrome): phone → animated multi-detent surface,
             * desktop / tablet → AntD right-shelf Drawer. Mirrors
             * `ActivityFeedDrawer`'s placement / size choices.
             */
            desktopPlacement="right"
            desktopSize="default"
            onClose={onClose}
            open={open}
            title={
                <span>
                    <DeleteOutlined
                        aria-hidden
                        style={{ marginInlineEnd: 8 }}
                    />
                    {drawerTitle}
                </span>
            }
        >
            {body}
        </Sheet>
    );
};

export default TrashDrawer;
