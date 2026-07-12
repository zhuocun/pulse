import { X } from "lucide-react";
import React from "react";
import { useParams } from "react-router-dom";

import { microcopy } from "../../constants/microcopy";
import { shadow } from "../../theme/tokens";
import useAppMessage from "../../components/ui/toast";
import useBulkSelection from "../../utils/hooks/useBulkSelection";
import useReactMutation from "../../utils/hooks/useReactMutation";
import bulkUpdateTasksCallback from "../../utils/optimisticUpdate/bulkUpdateTasks";
import { Button } from "../ui/button";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger
} from "../ui/dropdown-menu";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "../ui/select";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "../ui/tooltip";

/**
 * Floating bulk-edit toolbar (PRD-GAP-008). Appears once ≥1 task card is
 * selected on the board and fans a single metadata change out across the
 * whole selection via `PUT /tasks/bulk`. Only non-routing fields are
 * offered (priority / coordinator / labels) — the server drops `columnId` /
 * `projectId`, and offering them would imply a positional move the bulk
 * path deliberately can't make.
 *
 * The bar is `position: fixed` bottom-centre (the Gmail / Linear idiom) so
 * it never shifts the board layout; it sits below overlays (`zIndex.navBar`)
 * so an open modal/drawer still covers it.
 */
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

    const toggleLabel = (labelId: string, checked: boolean) => {
        setLabelIds((prev) => {
            const current = prev ?? [];
            return checked
                ? [...current, labelId]
                : current.filter((id) => id !== labelId);
        });
    };

    const selectedLabelCount = labelIds?.length ?? 0;

    return (
        <TooltipProvider>
            <div
                aria-label={microcopy.bulkEdit.toolbarAriaLabel}
                className="fixed left-1/2 z-[15] flex max-w-[calc(100vw-48px)] -translate-x-1/2 flex-wrap items-center justify-center gap-sm rounded-full border border-border bg-popover px-md py-sm max-md:left-md max-md:right-md max-md:translate-x-0 max-md:rounded-lg"
                data-testid="bulk-edit-toolbar"
                role="toolbar"
                style={{
                    bottom: "max(16px, env(safe-area-inset-bottom))",
                    boxShadow: shadow.lift
                }}
            >
                <span
                    className="whitespace-nowrap font-semibold"
                    aria-live="polite"
                >
                    {countLabel}
                </span>
                <div className="flex flex-wrap items-center gap-xs">
                    <Select
                        onValueChange={(value) =>
                            setPriority(value as TaskPriorityLevel)
                        }
                        value={priority}
                    >
                        <SelectTrigger
                            aria-label={microcopy.bulkEdit.setPriority}
                            className="min-w-[150px]"
                        >
                            <SelectValue
                                placeholder={microcopy.bulkEdit.setPriority}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            {PRIORITY_VALUES.map((value) => (
                                <SelectItem key={value} value={value}>
                                    {microcopy.options.priorities[value]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select
                        onValueChange={(value) => setCoordinatorId(value)}
                        value={coordinatorId}
                    >
                        <SelectTrigger
                            aria-label={microcopy.bulkEdit.setCoordinator}
                            className="min-w-[170px]"
                        >
                            <SelectValue
                                placeholder={microcopy.bulkEdit.setCoordinator}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            {members.map((member) => (
                                <SelectItem key={member._id} value={member._id}>
                                    {member.username}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                aria-label={microcopy.bulkEdit.setLabels}
                                className="min-w-[190px] justify-between font-normal"
                                variant="default"
                            >
                                {selectedLabelCount > 0
                                    ? microcopy.bulkEdit.selectedCount.other.replace(
                                          "{count}",
                                          String(selectedLabelCount)
                                      )
                                    : microcopy.bulkEdit.setLabels}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                            {labels.map((label) => (
                                <DropdownMenuCheckboxItem
                                    checked={
                                        labelIds?.includes(label._id) ?? false
                                    }
                                    key={label._id}
                                    onCheckedChange={(checked) =>
                                        toggleLabel(label._id, checked)
                                    }
                                    onSelect={(event) => event.preventDefault()}
                                >
                                    {label.name}
                                </DropdownMenuCheckboxItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                <Button
                    aria-label={microcopy.bulkEdit.applyAriaLabel}
                    disabled={!hasChange}
                    loading={isLoading}
                    onClick={onApply}
                    variant="primary"
                >
                    {microcopy.actions.apply}
                </Button>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            aria-label={microcopy.bulkEdit.clearSelection}
                            onClick={() => {
                                reset();
                                clear();
                            }}
                            size="icon"
                            variant="ghost"
                        >
                            <X aria-hidden />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        {microcopy.bulkEdit.clearSelection}
                    </TooltipContent>
                </Tooltip>
            </div>
        </TooltipProvider>
    );
};

export default BulkEditToolbar;
