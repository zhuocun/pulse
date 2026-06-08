import { CloseOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Button, Select, Tooltip } from "antd";
import React from "react";
import { useParams } from "react-router-dom";

import { microcopy } from "../../constants/microcopy";
import { breakpoints, radius, shadow, space, zIndex } from "../../theme/tokens";
import useAppMessage from "../../utils/hooks/useAppMessage";
import useBulkSelection from "../../utils/hooks/useBulkSelection";
import useReactMutation from "../../utils/hooks/useReactMutation";
import bulkUpdateTasksCallback from "../../utils/optimisticUpdate/bulkUpdateTasks";

/**
 * Floating bulk-edit toolbar (PRD-GAP-008). Appears once ≥1 task card is
 * selected on the board and fans a single metadata change out across the
 * whole selection via `PUT /tasks/bulk`. Only non-routing fields are
 * offered (priority / coordinator / labels) — the server drops `columnId` /
 * `projectId`, and offering them would imply a positional move the bulk
 * path deliberately can't make.
 *
 * The bar is `position: fixed` bottom-centre (the Gmail / Linear idiom) so
 * it never shifts the board layout; it sits below AntD overlays
 * (`zIndex.navBar`) so an open modal/drawer still covers it.
 */
const Bar = styled.div`
    align-items: center;
    background: var(--ant-color-bg-elevated, #ffffff);
    border: 1px solid var(--ant-color-border-secondary, rgba(15, 23, 42, 0.1));
    border-radius: ${radius.pill}px;
    bottom: max(${space.md}px, env(safe-area-inset-bottom));
    box-shadow: ${shadow.lift};
    display: flex;
    flex-wrap: wrap;
    gap: ${space.sm}px;
    justify-content: center;
    left: 50%;
    max-width: calc(100vw - ${space.lg * 2}px);
    padding: ${space.sm}px ${space.md}px;
    position: fixed;
    transform: translateX(-50%);
    z-index: ${zIndex.navBar};

    @media (max-width: ${breakpoints.md - 1}px) {
        border-radius: ${radius.lg}px;
        left: ${space.md}px;
        right: ${space.md}px;
        transform: none;
    }
`;

const Count = styled.span`
    font-weight: 600;
    white-space: nowrap;
`;

const Controls = styled.div`
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: ${space.xs}px;
`;

const PRIORITY_VALUES: TaskPriorityLevel[] = [
    "none",
    "low",
    "medium",
    "high",
    "urgent"
];

interface BulkEditToolbarProps {
    members?: IMember[];
    labels?: ILabel[];
}

const BulkEditToolbar: React.FC<BulkEditToolbarProps> = ({
    members = [],
    labels = []
}) => {
    const { projectId } = useParams<{ projectId: string }>();
    const message = useAppMessage();
    const { selectedIds, count, clear } = useBulkSelection();

    const [priority, setPriority] = React.useState<
        TaskPriorityLevel | undefined
    >(undefined);
    const [coordinatorId, setCoordinatorId] = React.useState<
        string | undefined
    >(undefined);
    // `undefined` = field untouched (not sent); `[]` = explicit clear (sent,
    // so the server strips every label off the selected tasks).
    const [labelIds, setLabelIds] = React.useState<string[] | undefined>(
        undefined
    );

    const { mutateAsync, isLoading } = useReactMutation(
        "tasks/bulk",
        "PUT",
        ["tasks", { projectId }],
        bulkUpdateTasksCallback,
        // Own the failure toast so the user sees a bulk-specific message
        // instead of the generic optimistic-revert one (the rollback still
        // happens inside useReactMutation before this runs).
        () => {
            message.error(microcopy.bulkEdit.applyFailed);
        }
    );

    const reset = React.useCallback(() => {
        setPriority(undefined);
        setCoordinatorId(undefined);
        setLabelIds(undefined);
    }, []);

    const changes = React.useMemo(() => {
        const next: Partial<ITask> = {};
        if (priority !== undefined) next.priority = priority;
        if (coordinatorId) next.coordinatorId = coordinatorId;
        if (labelIds !== undefined) next.labelIds = labelIds;
        return next;
    }, [priority, coordinatorId, labelIds]);

    const hasChange = Object.keys(changes).length > 0;

    if (count === 0) {
        return null;
    }

    const onApply = async () => {
        if (!hasChange) return;
        const taskIds = Array.from(selectedIds);
        const appliedCount = taskIds.length;
        try {
            await mutateAsync({ taskIds, changes });
            const template =
                appliedCount === 1
                    ? microcopy.bulkEdit.applied.one
                    : microcopy.bulkEdit.applied.other;
            message.success(template.replace("{count}", String(appliedCount)));
            reset();
            clear();
        } catch {
            // The onError handler above already surfaced the failure and
            // useReactMutation rolled the optimistic patch back; keep the
            // selection so the user can retry.
        }
    };

    const countLabel = (
        count === 1
            ? microcopy.bulkEdit.selectedCount.one
            : microcopy.bulkEdit.selectedCount.other
    ).replace("{count}", String(count));

    return (
        <Bar
            aria-label={microcopy.bulkEdit.toolbarAriaLabel}
            data-testid="bulk-edit-toolbar"
            role="toolbar"
        >
            <Count aria-live="polite">{countLabel}</Count>
            <Controls>
                <Select<TaskPriorityLevel>
                    allowClear
                    aria-label={microcopy.bulkEdit.setPriority}
                    onChange={(value) => setPriority(value ?? undefined)}
                    options={PRIORITY_VALUES.map((value) => ({
                        label: microcopy.options.priorities[value],
                        value
                    }))}
                    placeholder={microcopy.bulkEdit.setPriority}
                    style={{ minWidth: 150 }}
                    value={priority}
                />
                <Select<string>
                    allowClear
                    aria-label={microcopy.bulkEdit.setCoordinator}
                    optionFilterProp="label"
                    onChange={(value) => setCoordinatorId(value ?? undefined)}
                    options={members.map((member) => ({
                        label: member.username,
                        value: member._id
                    }))}
                    placeholder={microcopy.bulkEdit.setCoordinator}
                    showSearch
                    style={{ minWidth: 170 }}
                    value={coordinatorId}
                />
                <Select<string[]>
                    allowClear
                    aria-label={microcopy.bulkEdit.setLabels}
                    mode="multiple"
                    optionFilterProp="label"
                    onChange={(value) => setLabelIds(value)}
                    options={labels.map((label) => ({
                        label: label.name,
                        value: label._id
                    }))}
                    placeholder={microcopy.bulkEdit.setLabels}
                    style={{ minWidth: 190 }}
                    value={labelIds}
                />
            </Controls>
            <Button
                aria-label={microcopy.bulkEdit.applyAriaLabel}
                disabled={!hasChange}
                loading={isLoading}
                onClick={onApply}
                type="primary"
            >
                {microcopy.actions.apply}
            </Button>
            <Tooltip title={microcopy.bulkEdit.clearSelection}>
                <Button
                    aria-label={microcopy.bulkEdit.clearSelection}
                    icon={<CloseOutlined aria-hidden />}
                    onClick={() => {
                        reset();
                        clear();
                    }}
                    type="text"
                />
            </Tooltip>
        </Bar>
    );
};

export default BulkEditToolbar;
