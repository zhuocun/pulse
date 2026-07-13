import {
    AlertTriangle,
    Ban,
    CheckCircle2,
    Clock,
    Flag,
    GripVertical,
    MoreVertical
} from "lucide-react";
import dayjs from "dayjs";
import React from "react";
import { useParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@/components/ui/tooltip";
import { Text, Title } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import bugIcon from "../../assets/bug.svg";
import taskIcon from "../../assets/task.svg";
import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import { space } from "../../theme/tokens";
import { getAiSearchStrength } from "../../utils/ai/aiSearchStrength";
import { labelTagProps } from "../../utils/labelTagColor";
import normalizeTaskType from "../../utils/normalizeTaskType";
import useBoardDensity from "../../utils/hooks/useBoardDensity";
import useBulkSelection from "../../utils/hooks/useBulkSelection";
import useColumnReadiness from "../../utils/hooks/useColumnReadiness";
import useReactMutation from "../../utils/hooks/useReactMutation";
import useTaskModal from "../../utils/hooks/useTaskModal";
import useTaskPanelNavigation from "../../utils/hooks/useTaskPanelNavigation";
import useUndoToast from "../../utils/hooks/useUndoToast";
import { isOptimisticPlaceholderId } from "../../utils/optimisticClientId";
import newColumnCallback from "../../utils/optimisticUpdate/createColumn";
import deleteColumnCallback from "../../utils/optimisticUpdate/deleteColumn";
import updateColumnCallback from "../../utils/optimisticUpdate/updateColumn";
import AiMatchStrengthBadge from "../aiMatchStrengthBadge";
import ColumnReadinessPill from "../columnReadinessPill";
import {
    Drag,
    Drop,
    DropChild,
    useDetachedDragHandleProps
} from "../dragAndDrop";
import { NoPaddingButton } from "../projectList";
import Row from "../row";
import TaskCreator from "../taskCreator";
import { TaskSearchParam } from "../taskSearchPanel";
import UserAvatar from "../userAvatar";

const formatTemplate = (
    template: string,
    values: Record<string, string | number>
) =>
    Object.entries(values).reduce(
        (acc, [key, value]) => acc.replace(`{${key}}`, String(value)),
        template
    );

/**
 * Phase 4.2 — density-driven CSS custom properties. The column reads the
 * user's preference from Redux via `useBoardDensity()` and writes the
 * `--density-card-*` custom properties onto the `ColumnContainer` root
 * (plus a `data-density` marker for tests / debugging). The variables
 * cascade into every descendant that references them, so a change never
 * has to re-thread the density value through props.
 *
 * Comfortable values mirror the legacy tokens (8 / 12 / 16 / 14 px) so the
 * default UI is byte-identical. Density deltas vs. comfortable:
 *   - --density-card-padding-y     12 → 8  (−33%)
 *   - --density-card-padding-x     16 → 12 (−25%)
 *   - --density-card-gap            8 → 4  (−50%)
 *   - --density-card-title-mb       8 → 4  (−50%)
 *   - --density-card-title-fs       14 → 13 (−7%)
 *   - --density-card-footer-fs      12 → 11 (−8%)
 */
const densityVars = (density: "comfortable" | "compact"): React.CSSProperties =>
    (density === "compact"
        ? {
              "--density-card-padding-y": `${space.xs}px`,
              "--density-card-padding-x": `${space.sm}px`,
              "--density-card-gap": `${space.xxs}px`,
              "--density-card-title-mb": `${space.xxs}px`,
              "--density-card-title-fs": "13px",
              "--density-card-footer-fs": "11px"
          }
        : {
              "--density-card-padding-y": `${space.sm}px`,
              "--density-card-padding-x": `${space.md}px`,
              "--density-card-gap": `${space.xs}px`,
              "--density-card-title-mb": `${space.xs}px`,
              "--density-card-title-fs": "14px",
              "--density-card-footer-fs": "12px"
          }) as React.CSSProperties;

/**
 * Fix the column at 18rem so a single ultra-wide task card cannot stretch
 * the lane past its lane-mates. On phone-sized viewports (< md, 768px) the
 * column shrinks to leave a ~32px peek of the next column's header.
 */
const COLUMN_CONTAINER_CLASS = cn(
    "mr-md flex flex-col rounded-lg border border-transparent bg-muted/50 p-sm transition-colors",
    "w-[18rem] min-w-[18rem] flex-[0_0_18rem]",
    "max-md:w-[min(17rem,calc(100dvw-80px))] max-md:min-w-[min(17rem,calc(100dvw-80px))]"
);

/**
 * The column's vertical scroll context. The ColumnHeader lives *inside*
 * this container as its first child so `position: sticky` on the header
 * pins it against this exact scroll port. The dnd placeholder gets a
 * dashed brand outline so the drop target reads clearly mid-drag.
 */
const TASK_CONTAINER_CLASS = cn(
    "flex flex-1 flex-col overflow-y-auto pb-xs [gap:var(--density-card-gap,8px)]",
    "[&_[data-rfd-placeholder-context-id]]:box-border [&_[data-rfd-placeholder-context-id]]:min-h-[40px]",
    "[&_[data-rfd-placeholder-context-id]]:rounded-sm [&_[data-rfd-placeholder-context-id]]:border",
    "[&_[data-rfd-placeholder-context-id]]:border-dashed [&_[data-rfd-placeholder-context-id]]:border-primary",
    "[&_[data-rfd-placeholder-context-id]]:bg-primary/10"
);

/**
 * Per-row drag shell. Carries the optimistic-insert reveal (a guarded
 * slide-and-fade that only runs for the placeholder card and only when
 * the user hasn't opted out of motion) and the drag-lift treatment on
 * the inner `.task-card-lift-surface` while a drag snapshot is active.
 */
const TASK_ROW_DRAG_SHELL_CLASS = cn(
    "w-full",
    "[&_.task-card-lift-surface]:transition-[border-color,box-shadow,transform] [&_.task-card-lift-surface]:duration-short [&_.task-card-lift-surface]:ease-out",
    "motion-safe:data-[optimistic=true]:animate-in motion-safe:data-[optimistic=true]:fade-in motion-safe:data-[optimistic=true]:slide-in-from-top-2",
    "data-[dragging=true]:[&_.task-card-lift-surface]:shadow-[0_6px_16px_rgba(15,23,42,0.12),0_0_0_1px_rgba(15,23,42,0.06)]",
    "motion-safe:data-[dragging=true]:[&_.task-card-lift-surface]:scale-[1.02]"
);

const FILTERED_EMPTY_CLASS = cn(
    "flex flex-col items-center gap-xxs rounded-md border border-dashed border-border bg-muted/40",
    "px-md py-sm text-center text-xs text-muted-foreground"
);

const FILTERED_EMPTY_BUTTON_CLASS = cn(
    "cursor-pointer rounded-sm border-0 bg-transparent px-xs py-xxs text-xs font-medium text-primary",
    "hover:bg-primary/10 focus-visible:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-transparent",
    "coarse:min-h-[44px] coarse:px-sm coarse:py-xs"
);

const CARD_META_CLASS =
    "flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-xs gap-y-xxs";

const CARD_TRAILING_META_CLASS =
    "inline-flex shrink-0 items-center gap-xs whitespace-nowrap";

const CARD_TITLE_CLASS = cn(
    "line-clamp-2 font-medium leading-[1.4] text-foreground [word-break:break-word]",
    "[font-size:var(--density-card-title-fs,14px)] [margin-bottom:var(--density-card-title-mb,8px)]"
);

const CARD_FOOTER_CLASS =
    "flex min-w-0 items-start gap-xs text-muted-foreground [font-size:var(--density-card-footer-fs,12px)]";

/**
 * Overdue rule: the task carries a `dueDate` whose LOCAL calendar date is
 * strictly before today. We compare date-only (`YYYY-MM-DD`), matching the
 * lens predicates, so a task due "today" is NOT overdue.
 */
const isTaskOverdue = (
    dueDate: string | null | undefined,
    now: Date = new Date()
): boolean => {
    if (!dueDate) return false;
    const due = dayjs(dueDate);
    if (!due.isValid()) return false;
    return due.startOf("day").isBefore(dayjs(now).startOf("day"));
};

const STATUS_PALETTE = [
    "#94A3B8",
    "#475569",
    "#0EA5E9",
    "#10B981",
    "#F59E0B",
    "#EF4444",
    "#3B82F6",
    "#F472B6"
] as const;

const dotForColumn = (id: string): string => {
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) {
        hash = (hash * 31 + id.charCodeAt(i)) | 0;
    }
    return STATUS_PALETTE[Math.abs(hash) % STATUS_PALETTE.length];
};

/**
 * Per-priority tint, escalating low → urgent. `none` is absent from the map
 * because that branch renders no badge at all. The glyph is identical across
 * levels (a flag); the visible label + aria-label disambiguate, so colour is
 * never the sole carrier of meaning.
 */
const PRIORITY_TINT: Record<Exclude<TaskPriorityLevel, "none">, string> = {
    low: "var(--pulse-text-tertiary, rgba(15, 23, 42, 0.45))",
    medium: "var(--pulse-brand-primary, #ea580c)",
    high: "var(--pulse-priority-high, #b45309)",
    urgent: "var(--pulse-error, #dc2626)"
};

// Column categories shown in the edit picker — same source of truth the
// creator uses. Listed explicitly so the order is stable across renders.
const COLUMN_CATEGORY_OPTIONS: NonNullable<IColumn["category"]>[] = [
    "todo",
    "in_progress",
    "done"
];

/**
 * Column-edit modal (PRD §5.5). The board PUT accepts exactly
 * `{columnName, wipLimit, category}` keyed by `_id`; we send all three so a
 * single save can rename, re-categorise, and re-cap the column. The
 * optimistic `updateColumnCallback` patches the cached column instantly and
 * `useReactMutation` rolls back on error. `wipLimit` is a non-negative int
 * (`0` = no limit, AC-C11).
 */
const ColumnEditModal: React.FC<{
    column: IColumn;
    open: boolean;
    onClose: () => void;
}> = ({ column, open, onClose }) => {
    const { projectId } = useParams<{ projectId: string }>();
    const { mutate: update, isLoading } = useReactMutation(
        "boards",
        "PUT",
        ["boards", { projectId }],
        updateColumnCallback
    );
    // Companion PUT used only as the Undo closure: it restores the
    // column's captured prior settings. Fire-and-forget — errors are
    // swallowed because the user already initiated the Undo deliberately.
    const { mutateAsync: undoUpdate } = useReactMutation(
        "boards",
        "PUT",
        ["boards", { projectId }],
        updateColumnCallback,
        () => {}
    );
    const { show: showUndoToast } = useUndoToast();
    const [name, setName] = React.useState(column.columnName);
    const [category, setCategory] = React.useState<
        NonNullable<IColumn["category"]>
    >(column.category ?? "todo");
    const [wipLimit, setWipLimit] = React.useState<number>(
        column.wipLimit ?? 0
    );
    // Re-seed the form from the column whenever the modal (re)opens so a
    // cancelled edit never leaks a stale draft into the next open.
    React.useEffect(() => {
        if (open) {
            setName(column.columnName);
            setCategory(column.category ?? "todo");
            setWipLimit(column.wipLimit ?? 0);
        }
    }, [open, column.columnName, column.category, column.wipLimit]);
    const trimmed = name.trim();
    const onSave = () => {
        if (!trimmed) return;
        // Capture the column's prior settings BEFORE the optimistic PUT so
        // the Undo closure can restore them.
        const beforeState = {
            _id: column._id,
            columnName: column.columnName,
            category: column.category ?? "todo",
            wipLimit: column.wipLimit ?? 0
        };
        update({
            _id: column._id,
            columnName: trimmed,
            category,
            wipLimit
        });
        onClose();
        // §2.A.4 — a column edit is reversible, so surface a transient Undo
        // toast whose inverse PUTs the captured prior settings back.
        showUndoToast({
            description: microcopy.feedback.columnUpdated,
            analyticsTag: "column.update",
            undo: async () => {
                await undoUpdate(beforeState);
            }
        });
    };
    return (
        <Dialog
            onOpenChange={(next) => (next ? undefined : onClose())}
            open={open}
        >
            <DialogContent aria-describedby={undefined} className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{microcopy.column.editTitle}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-sm">
                    <label className="flex flex-col gap-xxs">
                        <span>{microcopy.a11y.newColumnName}</span>
                        <Input
                            aria-label={microcopy.a11y.newColumnName}
                            autoComplete="off"
                            autoFocus
                            enterKeyHint="done"
                            inputMode="text"
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    onSave();
                                }
                            }}
                            value={name}
                        />
                    </label>
                    <label className="flex flex-col gap-xxs">
                        <span>{microcopy.a11y.newColumnCategory}</span>
                        <Select
                            onValueChange={(value) =>
                                setCategory(
                                    value as NonNullable<IColumn["category"]>
                                )
                            }
                            value={category}
                        >
                            <SelectTrigger
                                aria-label={microcopy.a11y.newColumnCategory}
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {COLUMN_CATEGORY_OPTIONS.map((value) => (
                                    <SelectItem key={value} value={value}>
                                        {
                                            microcopy.options.columnCategories[
                                                value
                                            ]
                                        }
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </label>
                    <label className="flex flex-col gap-xxs">
                        <span>{microcopy.fields.wipLimit}</span>
                        <Input
                            aria-label={microcopy.fields.wipLimit}
                            inputMode="numeric"
                            min={0}
                            onChange={(e) => {
                                const parsed = Number(e.target.value);
                                setWipLimit(
                                    e.target.value === "" ||
                                        Number.isNaN(parsed)
                                        ? 0
                                        : parsed
                                );
                            }}
                            step={1}
                            type="number"
                            value={wipLimit}
                        />
                        <Text className="text-xs" type="secondary">
                            {microcopy.column.wipLimitHelp}
                        </Text>
                    </label>
                </div>
                <DialogFooter>
                    <Button onClick={onClose} variant="default">
                        {microcopy.actions.cancel}
                    </Button>
                    <Button
                        disabled={!trimmed}
                        loading={isLoading}
                        onClick={onSave}
                        variant="primary"
                    >
                        {microcopy.actions.save}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

const DeleteDropDown: React.FC<{
    columnId: string;
    columnName: string;
    /** Full column snapshot — captured so Undo can re-create it. */
    column: IColumn;
    /**
     * Whether the column currently holds any tasks. Column deletion
     * cascades server-side and the re-create POST mints a fresh column
     * without those tasks — so a non-empty column delete has no honorable
     * inverse. Empty columns get the optimistic-delete + Undo toast;
     * non-empty columns fall back to a confirm dialog.
     */
    hasTasks: boolean;
}> = ({ columnId, columnName, column, hasTasks }) => {
    const { projectId } = useParams<{ projectId: string }>();
    const { mutate: remove } = useReactMutation(
        "boards",
        "DELETE",
        ["boards", { projectId }],
        deleteColumnCallback,
        // Suppress useReactMutation's auto-revert toast; the toast+Undo
        // surface below owns the user-visible feedback for this delete.
        () => {}
    );
    // Companion POST mutation used purely as the Undo closure: it
    // re-creates the just-deleted column with the captured snapshot so an
    // accidental delete is recoverable.
    const { mutateAsync: undoDelete } = useReactMutation(
        "boards",
        "POST",
        ["boards", { projectId }],
        newColumnCallback,
        () => {}
    );
    const { show: showUndoToast } = useUndoToast();
    const [editOpen, setEditOpen] = React.useState(false);
    const [confirmOpen, setConfirmOpen] = React.useState(false);
    const disabled = isOptimisticPlaceholderId(columnId);
    const performEmptyDelete = () => {
        // Capture the full column payload BEFORE removal so the Undo
        // closure can POST it back. After the optimistic prune the cache
        // no longer carries it.
        const beforeState = column;
        remove({ columnId });
        showUndoToast({
            description: microcopy.feedback.columnDeleted,
            analyticsTag: "column.delete",
            // The optimistic delete prunes this column from the board, so
            // this Column instance unmounts on the same action; keep the
            // toast alive past unmount so the user still gets their Undo
            // window.
            dismissOnUnmount: false,
            undo: async () => {
                await undoDelete(
                    beforeState as unknown as Record<string, unknown>
                );
            }
        });
    };
    const onDelete = () => {
        if (hasTasks) {
            // Non-empty column: the server cascade-deletes every task and
            // re-create cannot restore them, so an Undo we can't honor
            // would lie to the user. Confirm instead (§2.A.4).
            setConfirmOpen(true);
            return;
        }
        performEmptyDelete();
    };
    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <NoPaddingButton
                        aria-label={formatTemplate(
                            microcopy.a11y.moreActionsForColumn as string,
                            { name: columnName }
                        )}
                        icon={<MoreVertical aria-hidden />}
                    />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem
                        aria-label={formatTemplate(
                            microcopy.a11y.editColumnNamed as string,
                            { name: columnName }
                        )}
                        disabled={disabled}
                        onSelect={() => setEditOpen(true)}
                    >
                        {microcopy.actions.edit}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        aria-label={formatTemplate(
                            microcopy.a11y.deleteColumnNamed as string,
                            { name: columnName }
                        )}
                        className="text-destructive focus:text-destructive"
                        disabled={disabled}
                        onSelect={onDelete}
                    >
                        {microcopy.actions.delete}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <ColumnEditModal
                column={column}
                onClose={() => setEditOpen(false)}
                open={editOpen}
            />
            <Dialog onOpenChange={setConfirmOpen} open={confirmOpen}>
                <DialogContent
                    aria-describedby={undefined}
                    className="max-w-md"
                >
                    <DialogHeader>
                        <DialogTitle>
                            {microcopy.confirm.deleteColumn.title}
                        </DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        {microcopy.confirm.deleteColumn.description}
                    </p>
                    <DialogFooter>
                        <Button
                            onClick={() => setConfirmOpen(false)}
                            variant="default"
                        >
                            {microcopy.actions.cancel}
                        </Button>
                        <Button
                            onClick={() => {
                                remove({ columnId });
                                setConfirmOpen(false);
                            }}
                            variant="destructive"
                        >
                            {microcopy.confirm.deleteColumn.confirmLabel}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};

type TaskCardProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    task: ITask;
    members: IMember[];
    /**
     * Project labels, used to resolve `task.labelIds` → name + colour chips.
     * Optional so callers that don't render labels (or haven't loaded them)
     * simply omit the chip row.
     */
    labels?: ILabel[];
    /**
     * Project milestones, used to resolve `task.milestoneId` → a milestone
     * badge. Optional so callers that don't render the badge (or haven't
     * loaded them) simply omit it.
     */
    milestones?: IMilestone[];
    onOpen?: () => void;
    isMock?: boolean;
    /** Reordering is paused by active filters — advisory affordance only. */
    dragDisabledByFilters?: boolean;
};

const TaskCard = React.forwardRef<HTMLButtonElement, TaskCardProps>(
    (
        {
            task,
            members,
            labels,
            milestones,
            onOpen,
            isMock,
            dragDisabledByFilters,
            "aria-label": ariaLabel,
            className,
            ...rest
        },
        ref
    ) => {
        const { projectId } = useParams<{ projectId: string }>();
        // Board multi-select (PRD-GAP-008). `selectable` gates the checkbox
        // on a live provider AND a persisted task — an optimistic placeholder
        // has no server id to bulk-edit, so it's never selectable.
        const selection = useBulkSelection();
        const selectable = selection.enabled && !isMock;
        const selected = selectable && selection.isSelected(task._id);
        const coordinator = members.find((m) => m._id === task.coordinatorId);
        // Shared normalizer keeps the card's Task/Bug coercion in
        // lockstep with the task modal's select + title tag.
        const isBug = normalizeTaskType(task.type) === "Bug";
        // Epic chips use the same hex wash path as project labels so dark
        // mode lifts ink via `light-dark()` (hardcoded Tailwind hex/10
        // washes stay ~1.7:1 on near-black cards).
        const epicTagStyle = task.epic
            ? labelTagProps(isBug ? "#DB2777" : "#2f54eb").style
            : undefined;
        // Resolve the task's label ids to the project's label objects (name
        // + colour). Unknown ids (a label deleted since the task was tagged)
        // are dropped rather than rendered as a blank chip.
        const taskLabels = (task.labelIds ?? [])
            .map((id) => (labels ?? []).find((label) => label._id === id))
            .filter((label): label is ILabel => Boolean(label));
        const overdue = isTaskOverdue(task.dueDate);
        const overdueLabel = task.dueDate
            ? formatTemplate(microcopy.a11y.overdueTask as string, {
                  date: task.dueDate
              })
            : "";
        // Priority badge (PRD §3.4): `none` / absent renders nothing.
        const priority: TaskPriorityLevel | undefined = task.priority;
        const activePriority: Exclude<TaskPriorityLevel, "none"> | null =
            priority !== undefined && priority !== "none" ? priority : null;
        // Blocked badge (PRD §4.5): a non-empty server-derived `blockedBy`
        // array means the task has ≥1 unfinished prerequisite.
        const blocked =
            Array.isArray(task.blockedBy) && task.blockedBy.length > 0;
        // Completed badge (PRD §3 lifecycle): `completedAt` is a
        // server-managed timestamp. Guard truthiness BEFORE dayjs —
        // `dayjs(undefined)` is "now" and would render a bogus date.
        const completed =
            Boolean(task.completedAt) && dayjs(task.completedAt).isValid();
        const completedLabel = completed
            ? formatTemplate(microcopy.a11y.completedTask as string, {
                  date: dayjs(task.completedAt).format("YYYY-MM-DD")
              })
            : "";
        // Milestone badge: resolve `task.milestoneId` against the project's
        // milestones. An unset or dangling id renders nothing.
        const milestone = (milestones ?? []).find(
            (m) => m._id === task.milestoneId
        );
        const milestoneLabel = milestone
            ? formatTemplate(microcopy.a11y.milestoneTask as string, {
                  name: milestone.name
              })
            : "";
        // Read per-result strength from the AI search cache (P1-2). Returns
        // null when no semantic filter is active.
        const strength = getAiSearchStrength("tasks", task._id);
        /*
         * Inline-edit title (Phase 4.5): double-click the title to swap it
         * for an Input that mutates the task in place. We reuse the SAME
         * `tasks PUT` mutation that `taskModal` uses so optimistic update +
         * cache invalidation work identically across both surfaces.
         *
         * Why blur → commit? Linear is the dominant convention for
         * task-card inline edits, and committing on blur matches the user's
         * "I clicked away, save what I typed" mental model. Enter / Esc are
         * available to disambiguate deliberately.
         */
        const { mutate: updateTask, isLoading: isUpdating } = useReactMutation(
            "tasks",
            "PUT",
            ["tasks", { projectId }]
        );
        const [editing, setEditing] = React.useState(false);
        const [draft, setDraft] = React.useState(task.taskName);
        const cardRef = React.useRef<HTMLButtonElement | null>(null);
        const inputRef = React.useRef<HTMLInputElement | null>(null);
        /*
         * Browsers fire `click → click → dblclick` for a real double-click.
         * Stopping propagation on `dblclick` alone isn't enough — the two
         * preceding `click` events would still bubble to the card and open
         * the modal underneath the inline-edit Input. We defer the outer
         * open by ~250 ms; a `dblclick` inside that window cancels the
         * pending timer so the modal never fires. 250 ms matches the OS
         * dblclick threshold (Linear / Notion use the same envelope).
         */
        const openTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
            null
        );
        React.useEffect(
            () => () => {
                if (openTimerRef.current !== null) {
                    clearTimeout(openTimerRef.current);
                    openTimerRef.current = null;
                }
            },
            []
        );
        // Bridge the outer forwardRef to our local cardRef so we can
        // restore focus on commit/revert without losing parent-supplied
        // refs (react-router, dnd, etc.).
        const setCardRef = React.useCallback(
            (node: HTMLButtonElement | null) => {
                cardRef.current = node;
                if (typeof ref === "function") ref(node);
                else if (ref) {
                    (
                        ref as React.MutableRefObject<HTMLButtonElement | null>
                    ).current = node;
                }
            },
            [ref]
        );
        // Sync `draft` to upstream renames unless the user is actively
        // editing (so we don't clobber in-flight keystrokes).
        React.useEffect(() => {
            if (!editing) setDraft(task.taskName);
        }, [editing, task.taskName]);
        const exitEditing = React.useCallback(
            (opts?: { restoreFocus?: boolean }) => {
                setEditing(false);
                if (opts?.restoreFocus !== false) {
                    queueMicrotask(() => cardRef.current?.focus());
                }
            },
            []
        );
        const commitDraft = React.useCallback(() => {
            const trimmed = draft.trim();
            // No-op commit when the trimmed value equals the current server
            // value — saves a request AND avoids a needless invalidation.
            if (!trimmed || trimmed === task.taskName) {
                exitEditing();
                return;
            }
            updateTask({ ...task, taskName: trimmed });
            exitEditing();
        }, [draft, exitEditing, task, updateTask]);
        const revertDraft = React.useCallback(() => {
            setDraft(task.taskName);
            exitEditing();
        }, [exitEditing, task.taskName]);
        const enterEditing = React.useCallback(
            (event: React.MouseEvent<HTMLDivElement>) => {
                // Double-click on the title — stop propagation so the outer
                // open handler doesn't also fire, and cancel the pending
                // single-click open timer.
                event.stopPropagation();
                if (openTimerRef.current !== null) {
                    clearTimeout(openTimerRef.current);
                    openTimerRef.current = null;
                }
                if (isMock) return;
                setDraft(task.taskName);
                setEditing(true);
                queueMicrotask(() => {
                    const node = inputRef.current;
                    if (node) {
                        node.focus();
                        node.select();
                    }
                });
            },
            [isMock, task.taskName]
        );
        const handleCardClick = React.useCallback(() => {
            if (!onOpen) return;
            if (openTimerRef.current !== null) {
                clearTimeout(openTimerRef.current);
            }
            openTimerRef.current = setTimeout(() => {
                openTimerRef.current = null;
                cardRef.current?.focus();
                onOpen();
            }, 250);
        }, [onOpen]);
        const cardButton = (
            <button
                aria-keyshortcuts="Space ArrowUp ArrowDown ArrowLeft ArrowRight Escape"
                aria-label={
                    ariaLabel ??
                    formatTemplate(microcopy.a11y.openTask as string, {
                        name: task.taskName
                    })
                }
                className={cn(
                    "block w-full rounded-md border border-border bg-card text-left text-card-foreground",
                    "shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-[border-color,box-shadow,transform] duration-short ease-out",
                    "[padding:var(--density-card-padding-y,12px)_var(--density-card-padding-x,16px)]",
                    "hover:enabled:-translate-y-px hover:enabled:border-[color:var(--glass-border-strong)] hover:enabled:shadow-md",
                    "focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    "active:enabled:translate-y-0 disabled:cursor-default disabled:opacity-70",
                    dragDisabledByFilters
                        ? "cursor-not-allowed"
                        : "cursor-pointer",
                    selectable && "coarse:pl-[52px] coarse:pt-[52px]",
                    className
                )}
                disabled={isMock}
                onClick={handleCardClick}
                ref={setCardRef}
                title={
                    dragDisabledByFilters
                        ? undefined
                        : microcopy.dragHints.taskCardKeyboard
                }
                type="button"
                {...rest}
            >
                {task.epic ? (
                    <Badge
                        className="mb-xs max-w-full whitespace-normal border-transparent bg-transparent px-xs text-xs font-medium text-foreground [word-break:break-word]"
                        style={epicTagStyle}
                    >
                        {task.epic}
                    </Badge>
                ) : null}
                {taskLabels.length > 0 ? (
                    <div
                        aria-label={microcopy.fields.labels}
                        className="mb-xs flex flex-wrap gap-xxs"
                    >
                        {taskLabels.map((label) => {
                            const { style: labelStyle } = labelTagProps(
                                label.color
                            );
                            return (
                                <Badge
                                    className="m-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap border-transparent bg-secondary text-xs font-medium text-secondary-foreground"
                                    key={label._id}
                                    style={labelStyle}
                                >
                                    {label.name}
                                </Badge>
                            );
                        })}
                    </div>
                ) : null}
                {editing ? (
                    // Pure event-quarantine wrapper, not an interactive
                    // control — a role would mislead assistive tech.
                    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
                    <div
                        className={CARD_TITLE_CLASS}
                        // The Input is a button child — every pointer/key
                        // event has to be quarantined or the parent
                        // <button> would treat typing as a click.
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <Input
                            aria-label={microcopy.a11y.renameTask as string}
                            autoComplete="off"
                            autoFocus
                            className="h-auto [font-size:var(--density-card-title-fs,14px)] leading-[1.4]"
                            data-testid="task-card-title-input"
                            disabled={isUpdating}
                            enterKeyHint="done"
                            inputMode="text"
                            onBlur={commitDraft}
                            onChange={(e) => setDraft(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            /*
                             * Enter / Esc are handled here rather than via a
                             * separate onPressEnter so a single commit fires
                             * per keypress.
                             */
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    commitDraft();
                                } else if (e.key === "Escape") {
                                    e.preventDefault();
                                    revertDraft();
                                }
                            }}
                            ref={inputRef}
                            value={draft}
                        />
                    </div>
                ) : (
                    // Double-click-to-rename lives on the card <button>; this
                    // div only widens the hit area, so no separate role.
                    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
                    <div
                        className={CARD_TITLE_CLASS}
                        data-testid="task-card-title"
                        onDoubleClick={enterEditing}
                    >
                        {task.taskName}
                    </div>
                )}
                <div
                    className={CARD_FOOTER_CLASS}
                    data-testid="task-card-footer"
                >
                    {/* The label "Bug"/"Task" reads as the visible text and
                     * the icon is decorative, so no Tooltip is needed. */}
                    <span
                        className="inline-flex shrink-0 items-center gap-xxs font-medium"
                        style={{
                            color: isBug
                                ? "#DB2777"
                                : "var(--pulse-brand-primary, #EA580C)"
                        }}
                    >
                        {/* Explicit width/height locks the badge's aspect
                         * ratio so the row never shifts while the SVG loads
                         * (CLS). */}
                        <img
                            alt=""
                            aria-hidden
                            height={14}
                            loading="lazy"
                            src={isBug ? bugIcon : taskIcon}
                            width={14}
                        />
                        <span>
                            {isBug
                                ? microcopy.options.taskTypes.bug
                                : microcopy.options.taskTypes.task}
                        </span>
                    </span>
                    <span
                        className={CARD_META_CLASS}
                        data-testid="task-card-meta"
                    >
                        {completed ? (
                            <span
                                aria-label={completedLabel}
                                className="inline-flex items-center gap-xxs whitespace-nowrap font-semibold text-success [&_svg]:size-4"
                                data-testid="task-card-completed"
                            >
                                <CheckCircle2 aria-hidden />
                                <span>{microcopy.taskCard.completed}</span>
                            </span>
                        ) : null}
                        {blocked && !completed ? (
                            <span
                                aria-label={
                                    microcopy.a11y.blockedTask as string
                                }
                                className="inline-flex items-center gap-xxs whitespace-nowrap font-semibold text-destructive [&_svg]:size-4"
                                data-testid="task-card-blocked"
                            >
                                <Ban aria-hidden />
                                <span>{microcopy.taskCard.blocked}</span>
                            </span>
                        ) : null}
                        {activePriority ? (
                            <span
                                aria-label={formatTemplate(
                                    microcopy.a11y.priorityTask as string,
                                    {
                                        priority:
                                            microcopy.options.priorities[
                                                activePriority
                                            ]
                                    }
                                )}
                                className="inline-flex items-center gap-xxs whitespace-nowrap font-semibold [&_svg]:size-4"
                                data-testid="task-card-priority"
                                style={{ color: PRIORITY_TINT[activePriority] }}
                            >
                                <Flag aria-hidden />
                                <span>
                                    {
                                        microcopy.options.priorities[
                                            activePriority
                                        ]
                                    }
                                </span>
                            </span>
                        ) : null}
                        {overdue && !completed ? (
                            <span
                                aria-label={overdueLabel}
                                className="inline-flex items-center gap-xxs whitespace-nowrap font-semibold text-destructive [&_svg]:size-4"
                                data-testid="task-card-overdue"
                            >
                                <Clock aria-hidden />
                                <span>{microcopy.taskCard.overdue}</span>
                            </span>
                        ) : null}
                        {task.milestoneId && milestone ? (
                            <span
                                aria-label={milestoneLabel}
                                className="inline-flex min-w-0 max-w-[12ch] flex-[1_1_8ch] items-center gap-xxs overflow-hidden whitespace-nowrap font-medium text-muted-foreground [&>span]:overflow-hidden [&>span]:text-ellipsis [&_svg]:size-4"
                                data-testid="task-card-milestone"
                                title={milestone.name}
                            >
                                <Flag aria-hidden />
                                <span>{milestone.name}</span>
                            </span>
                        ) : null}
                        {strength ? (
                            <AiMatchStrengthBadge strength={strength} />
                        ) : null}
                        {typeof task.storyPoints === "number" || coordinator ? (
                            <span
                                className={CARD_TRAILING_META_CLASS}
                                data-testid="task-card-trailing-meta"
                            >
                                {typeof task.storyPoints === "number" ? (
                                    <Badge
                                        className="m-0 font-semibold tabular-nums"
                                        variant="secondary"
                                    >
                                        {microcopy.brief.markdownStoryPoints.replace(
                                            "{count}",
                                            String(task.storyPoints)
                                        )}
                                    </Badge>
                                ) : null}
                                {coordinator ? (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="inline-flex">
                                                <UserAvatar
                                                    aria-label={formatTemplate(
                                                        microcopy.a11y
                                                            .assignedTo as string,
                                                        {
                                                            name: coordinator.username
                                                        }
                                                    )}
                                                    id={coordinator._id}
                                                    name={coordinator.username}
                                                />
                                            </span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {formatTemplate(
                                                microcopy.a11y
                                                    .assignedTo as string,
                                                {
                                                    name: coordinator.username
                                                }
                                            )}
                                        </TooltipContent>
                                    </Tooltip>
                                ) : null}
                            </span>
                        ) : null}
                    </span>
                </div>
            </button>
        );
        if (!selectable) {
            return cardButton;
        }
        const selectLabel = formatTemplate(
            (selected
                ? microcopy.bulkEdit.deselectTask
                : microcopy.bulkEdit.selectTask) as string,
            { name: task.taskName }
        );
        return (
            <div
                className={cn(
                    "relative w-full",
                    "[&:focus-within_[data-select-slot]]:opacity-100 [&:hover_[data-select-slot]]:opacity-100"
                )}
                data-selected={selected ? "true" : "false"}
            >
                {/* Event-quarantine wrapper for the Checkbox; not itself
                    interactive, so a role would mislead assistive tech. */}
                {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                <span
                    className={cn(
                        "absolute left-xs top-xs z-[2] inline-flex items-center justify-center rounded-sm bg-card p-[2px] transition-opacity",
                        selected ? "opacity-100" : "opacity-0",
                        "coarse:min-h-[44px] coarse:min-w-[44px] coarse:p-0 coarse:opacity-100",
                        "coarse:[&_[role=checkbox]]:size-full"
                    )}
                    data-select-slot
                    // Quarantine pointer events so toggling selection never
                    // bubbles to the card's open handler or kicks off a drag.
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <Checkbox
                        aria-label={selectLabel}
                        checked={Boolean(selected)}
                        data-testid="task-card-select"
                        onCheckedChange={() => selection.toggle(task._id)}
                    />
                </span>
                {cardButton}
            </div>
        );
    }
);

TaskCard.displayName = "TaskCard";

/**
 * Column props extend the native `<div>` HTML attributes so the Drag
 * wrapper (which spreads its `draggableProps` / `dragHandleProps` onto the
 * cloned child) and the BoardMinimap (which threads a
 * `data-minimap-column-id` identifier through) can both attach data-attrs
 * without per-attr forwarding plumbing.
 */
type ColumnComponentProps = React.HTMLAttributes<HTMLDivElement> & {
    tasks: ITask[];
    column: IColumn;
    param: TaskSearchParam;
    /** Disables inline task creation while a reorder mutation is in flight. */
    isDragDisabled: boolean;
    /**
     * When set, controls row drag only (e.g. filters active). Defaults to
     * `isDragDisabled` so a single flag still disables both behaviors.
     */
    taskDragDisabled?: boolean;
    /**
     * True when row drag is disabled SOLELY because filters are active.
     * Surfaces a tooltip + affordance on the cards so the user understands
     * why reordering is paused. Does not itself disable drag.
     */
    dragDisabledByFilters?: boolean;
    boardAiOn?: boolean;
    members?: IMember[];
    /** Project labels, threaded down to each card to resolve `labelIds`. */
    labels?: ILabel[];
    /** Project milestones, threaded down to each card to resolve `milestoneId`. */
    milestones?: IMilestone[];
    onResetFilters?: () => void;
    suppressFilteredEmptyHint?: boolean;
};

const ColumnComponent = React.forwardRef<HTMLDivElement, ColumnComponentProps>(
    (
        {
            column,
            param,
            tasks,
            isDragDisabled,
            taskDragDisabled = isDragDisabled,
            dragDisabledByFilters = false,
            boardAiOn = true,
            members = [],
            labels = [],
            milestones = [],
            onResetFilters,
            suppressFilteredEmptyHint = false,
            className,
            style,
            ...props
        },
        ref
    ) => {
        /*
         * Routed vs. modal task open. When `environment.taskPanelRouted` is
         * on, the card click navigates to a deep-linkable URL via
         * `useTaskPanelNavigation`; off, it dispatches the Redux overlay
         * action through `useTaskModal`.
         */
        const { startEditing: openViaModal } = useTaskModal();
        const { openTask: openViaPanel } = useTaskPanelNavigation();
        const startEditing = environment.taskPanelRouted
            ? openViaPanel
            : openViaModal;
        const columnDragHandleProps = useDetachedDragHandleProps();
        /*
         * Phase 4.2 — apply the user's board-density preference. The
         * `densityVars` helper writes the density-aware CSS custom
         * properties onto the container root; descendants reference them,
         * so no per-child threading is needed. The hook subscribes to Redux
         * so a toggle re-renders every column in lockstep.
         */
        const { density } = useBoardDensity();
        const filteredTasks = tasks.filter(
            (task) =>
                (!param.type || task.type === param.type) &&
                (!param.coordinatorId ||
                    task.coordinatorId === param.coordinatorId) &&
                (!param.taskName || task.taskName.includes(param.taskName)) &&
                (!param.semanticIds ||
                    param.semanticIds
                        .split(",")
                        .filter(Boolean)
                        .includes(task._id))
        );
        const hasTasksHiddenByFilter =
            tasks.length > 0 && filteredTasks.length === 0;
        /*
         * WIP limit (PRD §5.5). The over-limit verdict is a property of the
         * column's REAL load, so it reads the unfiltered `tasks.length`.
         * `wipLimit === 0` (or absent) means "no limit".
         */
        const wipLimit = column.wipLimit ?? 0;
        const wipCount = tasks.length;
        const overLimit = wipLimit > 0 && wipCount > wipLimit;
        /*
         * Column-readiness batch (Phase 4 W3). Runs the deterministic
         * readiness engine over the (unfiltered) task list. Short-circuits
         * to a neutral report when the env flag is off; the pill renders
         * nothing for the neutral state.
         */
        const readinessReport = useColumnReadiness({
            tasks,
            columnId: column._id,
            enabled: environment.aiColumnReadinessEnabled
        });
        return (
            <div
                className={cn(COLUMN_CONTAINER_CLASS, className)}
                data-density={density}
                ref={ref}
                style={{ ...densityVars(density), ...style }}
                {...props}
            >
                {/*
                 * Phase 4.6 — the ColumnHeader renders *inside* TaskContainer
                 * so its sticky positioning pins against that scroll port.
                 */}
                <div
                    className={TASK_CONTAINER_CLASS}
                    data-testid="column-task-container"
                >
                    <TooltipProvider>
                        <Row
                            between
                            className={cn(
                                "rounded-[2px] bg-card/85 px-xs py-xxs",
                                "[backdrop-filter:var(--pulse-backdrop-filter-glass-subtle)] [-webkit-backdrop-filter:var(--pulse-backdrop-filter-glass-subtle)]",
                                "before:pointer-events-none before:absolute before:inset-0 before:z-0 before:rounded-[inherit] before:content-[''] before:[background:var(--glass-specular-top)]",
                                "after:pointer-events-none after:absolute after:inset-0 after:z-0 after:rounded-[inherit] after:content-[''] after:[background:var(--glass-specular-bottom)]",
                                "[&>*]:relative [&>*]:z-[1]",
                                "[@media(prefers-reduced-transparency:reduce)]:bg-card [@media(prefers-reduced-transparency:reduce)]:[backdrop-filter:none] [@media(prefers-reduced-transparency:reduce)]:[-webkit-backdrop-filter:none] [@media(prefers-reduced-transparency:reduce)]:before:[background:none] [@media(prefers-reduced-transparency:reduce)]:after:[background:none]",
                                "forced-colors:bg-[Canvas] forced-colors:[backdrop-filter:none] forced-colors:[-webkit-backdrop-filter:none] forced-colors:before:[background:none] forced-colors:after:[background:none]",
                                "coarse:[&>button:last-child]:min-h-[44px] coarse:[&>button:last-child]:min-w-[44px] coarse:[&>div:last-child>button]:min-h-[44px] coarse:[&>div:last-child>button]:min-w-[44px]"
                            )}
                            data-glass-context="true"
                            data-testid="column-header"
                            style={{
                                position: "sticky",
                                top: 0,
                                zIndex: 10
                            }}
                        >
                            <span className="inline-flex min-w-0 items-center gap-xs">
                                {columnDragHandleProps ? (
                                    <button
                                        type="button"
                                        {...columnDragHandleProps}
                                        aria-label={
                                            microcopy.dragHints.columnDragHandle
                                        }
                                        className={cn(
                                            "mr-xxs inline-flex min-h-[24px] min-w-[24px] flex-none cursor-grab items-center justify-center rounded-sm border-0 bg-transparent p-xxs text-muted-foreground",
                                            "active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                            "coarse:min-h-[44px] coarse:min-w-[44px] [&_svg]:size-4"
                                        )}
                                    >
                                        <GripVertical aria-hidden />
                                    </button>
                                ) : null}
                                <span
                                    aria-hidden
                                    className="inline-block size-2 flex-none rounded-full"
                                    style={{
                                        background: dotForColumn(column._id),
                                        boxShadow: `0 0 0 4px ${dotForColumn(
                                            column._id
                                        )}33`
                                    }}
                                />
                                <Title
                                    className="m-0 text-xs font-semibold tracking-wide text-muted-foreground"
                                    level={4}
                                >
                                    {column.columnName}
                                </Title>
                                <Badge
                                    aria-label={`${filteredTasks.length} tasks in ${column.columnName}`}
                                    className="font-semibold"
                                    variant="secondary"
                                >
                                    {filteredTasks.length}
                                </Badge>
                                {wipLimit > 0 ? (
                                    <span
                                        aria-label={formatTemplate(
                                            (overLimit
                                                ? microcopy.a11y.columnOverLimit
                                                : microcopy.a11y
                                                      .columnWipCount) as string,
                                            {
                                                count: wipCount,
                                                limit: wipLimit,
                                                over: wipCount - wipLimit
                                            }
                                        )}
                                        className={cn(
                                            "inline-flex items-center gap-xxs whitespace-nowrap text-xs tabular-nums",
                                            overLimit
                                                ? "font-semibold text-destructive"
                                                : "font-medium text-muted-foreground"
                                        )}
                                        data-testid="column-wip-badge"
                                    >
                                        {wipCount} / {wipLimit}
                                    </span>
                                ) : null}
                                {overLimit ? (
                                    <span
                                        aria-hidden
                                        className="inline-flex items-center gap-xxs whitespace-nowrap text-xs font-semibold text-destructive [&_svg]:size-4"
                                        data-testid="column-wip-over"
                                    >
                                        <AlertTriangle aria-hidden />
                                        <span>
                                            {microcopy.column.overLimit}
                                        </span>
                                    </span>
                                ) : null}
                                <ColumnReadinessPill report={readinessReport} />
                            </span>
                            <DeleteDropDown
                                column={column}
                                columnId={column._id}
                                columnName={column.columnName}
                                hasTasks={tasks.length > 0}
                            />
                        </Row>
                        <Drop
                            type="ROW"
                            direction="vertical"
                            droppableId={String(column._id)}
                        >
                            <DropChild>
                                {filteredTasks.map((task, index) => {
                                    const hasPersistedTaskId =
                                        Boolean(task._id) &&
                                        !isOptimisticPlaceholderId(task._id);
                                    const taskDragId = task._id
                                        ? `task${task._id}`
                                        : `task-unsaved-${index}`;
                                    const showFilterPausedHint =
                                        dragDisabledByFilters &&
                                        hasPersistedTaskId;

                                    const card = (
                                        <TaskCard
                                            className="task-card-lift-surface"
                                            dragDisabledByFilters={
                                                showFilterPausedHint
                                            }
                                            isMock={!hasPersistedTaskId}
                                            labels={labels}
                                            members={members}
                                            milestones={milestones}
                                            onOpen={
                                                hasPersistedTaskId
                                                    ? () =>
                                                          startEditing(task._id)
                                                    : undefined
                                            }
                                            task={task}
                                        />
                                    );

                                    return (
                                        <Drag
                                            key={task._id || taskDragId}
                                            index={index}
                                            draggableId={taskDragId}
                                            isDragDisabled={
                                                taskDragDisabled ||
                                                !hasPersistedTaskId
                                            }
                                            // TaskCard renders a <button>, which
                                            // @hello-pangea/dnd refuses to drag
                                            // from by default; opt out of that
                                            // block.
                                            disableInteractiveElementBlocking
                                        >
                                            {/*
                                             * The drag shell stays the direct
                                             * child of <Drag> so dnd attaches
                                             * its ref / draggable props to the
                                             * real DOM node; the tooltip only
                                             * wraps the inner card.
                                             */}
                                            <div
                                                className={
                                                    TASK_ROW_DRAG_SHELL_CLASS
                                                }
                                                data-optimistic={
                                                    hasPersistedTaskId
                                                        ? undefined
                                                        : "true"
                                                }
                                            >
                                                {showFilterPausedHint ? (
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            {card}
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            {
                                                                microcopy
                                                                    .dragHints
                                                                    .reorderDisabledByFilters
                                                            }
                                                        </TooltipContent>
                                                    </Tooltip>
                                                ) : (
                                                    card
                                                )}
                                            </div>
                                        </Drag>
                                    );
                                })}
                                <TaskCreator
                                    boardAiOn={boardAiOn}
                                    columnId={column._id}
                                    disabled={isDragDisabled}
                                />
                                {hasTasksHiddenByFilter &&
                                !suppressFilteredEmptyHint ? (
                                    <div
                                        aria-live="polite"
                                        className={FILTERED_EMPTY_CLASS}
                                        role="status"
                                    >
                                        <span>
                                            {
                                                microcopy.empty.filteredColumn
                                                    .title
                                            }
                                        </span>
                                        {onResetFilters ? (
                                            <button
                                                className={
                                                    FILTERED_EMPTY_BUTTON_CLASS
                                                }
                                                onClick={onResetFilters}
                                                type="button"
                                            >
                                                {
                                                    microcopy.empty
                                                        .filteredColumn.cta
                                                }
                                            </button>
                                        ) : null}
                                    </div>
                                ) : null}
                            </DropChild>
                        </Drop>
                    </TooltipProvider>
                </div>
            </div>
        );
    }
);

ColumnComponent.displayName = "Column";

/**
 * Memoized so board-level state changes that don't touch a column's own
 * props don't re-render every column (and, transitively, every task card).
 * The board hands each column stable prop refs; a real change (search
 * keystroke, drag reorder, member load) still flows through because those
 * refs genuinely change.
 */
const Column = React.memo(ColumnComponent);
Column.displayName = "Column";

export default Column;
