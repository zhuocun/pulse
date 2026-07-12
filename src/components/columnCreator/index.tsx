import { Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { cn } from "@/lib/utils";

import { microcopy, microcopyString } from "../../constants/microcopy";
import useActivityFeed from "../../utils/hooks/useActivityFeed";
import useReactMutation from "../../utils/hooks/useReactMutation";
import useUndoToast from "../../utils/hooks/useUndoToast";
import newColumnCallback from "../../utils/optimisticUpdate/createColumn";
import deleteColumnCallback from "../../utils/optimisticUpdate/deleteColumn";
import { Input } from "../ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "../ui/select";

// Persisted "done" semantics for a column. ``category`` is the stored
// source of truth for done-ness (the board echoes a derived ``isDone``);
// a freshly created column defaults to ``"todo"``.
type ColumnCategory = NonNullable<IColumn["category"]>;

const DEFAULT_CATEGORY: ColumnCategory = "todo";

const CATEGORY_OPTIONS: ColumnCategory[] = ["todo", "in_progress", "done"];

// The collapsed slot is compact (9rem) on md+; the editing slot widens to
// 16rem to hold the stacked fields. Below md both fall back to the shared
// mobile-safe min-width formula (space.md * 3 = 48px gutter).
const SLOT_BASE_CLASS =
    "flex flex-[0_0_auto] self-start mr-md py-xs min-w-[min(16rem,calc(100dvw-48px))]";

const ADD_COLUMN_BUTTON_CLASS = cn(
    "flex h-full min-h-[3rem] w-full items-center justify-center gap-xs rounded-lg border border-dashed border-border bg-muted px-md py-sm font-medium text-muted-foreground transition-colors",
    "enabled:hover:border-solid enabled:hover:border-primary enabled:hover:bg-primary/10 enabled:hover:text-primary",
    "enabled:focus-visible:border-solid enabled:focus-visible:border-primary enabled:focus-visible:bg-primary/10 enabled:focus-visible:text-primary",
    "disabled:cursor-default disabled:opacity-60"
);

/**
 * Adds a new column to the current board.
 *
 * Replaces the previous always-on faux column (an `Input` styled to look
 * like an empty column) with a collapsed-button affordance: the canvas is
 * only "polluted" once the user opts in. Pressing Esc, blurring, or
 * submitting an empty value collapses the input back to the button
 * without firing the mutation. Blur only collapses empty drafts; Enter is
 * the explicit commit gesture so tabbing away does not create a column.
 */
// A freshly created column has no WIP limit. ``0`` is the persisted
// "no limit" sentinel per the drift-detector contract (PRD §5.2), so the
// input starts there and only a deliberate positive value enforces a cap.
const DEFAULT_WIP_LIMIT = 0;

interface ColumnCreatorProps {
    editing?: boolean;
    onEditingChange?: (editing: boolean) => void;
}

const ColumnCreator: React.FC<ColumnCreatorProps> = ({
    editing: controlledEditing,
    onEditingChange
}) => {
    const [columnName, setColumnName] = useState("");
    const [category, setCategory] = useState<ColumnCategory>(DEFAULT_CATEGORY);
    const [wipLimit, setWipLimit] = useState<number>(DEFAULT_WIP_LIMIT);
    const [uncontrolledEditing, setUncontrolledEditing] = useState(false);
    const editing = controlledEditing ?? uncontrolledEditing;
    const setEditing = useCallback(
        (next: boolean) => {
            if (controlledEditing === undefined) {
                setUncontrolledEditing(next);
            }
            onEditingChange?.(next);
        },
        [controlledEditing, onEditingChange]
    );
    const inputRef = useRef<HTMLInputElement>(null);
    const { projectId } = useParams<{ projectId: string }>();
    const { mutateAsync, isLoading } = useReactMutation<IColumn>(
        "boards",
        "POST",
        ["boards", { projectId }],
        newColumnCallback
    );
    // Companion DELETE mutation used purely as the undo closure for
    // the activity-feed Undo button. Fire-and-forget — errors are
    // swallowed because the auto-revert toast would surface on top of
    // the user's deliberate Undo gesture.
    const { mutateAsync: undoCreate } = useReactMutation(
        "boards",
        "DELETE",
        ["boards", { projectId }],
        deleteColumnCallback,
        () => {}
    );
    const { record: recordActivity } = useActivityFeed();
    const { show: showUndoToast } = useUndoToast();

    const collapse = useCallback(() => {
        setEditing(false);
        setColumnName("");
        setCategory(DEFAULT_CATEGORY);
        setWipLimit(DEFAULT_WIP_LIMIT);
    }, [setEditing]);

    const submit = async () => {
        const trimmed = columnName.trim();
        if (!trimmed) {
            collapse();
            return;
        }
        setColumnName("");
        // ``wipLimit`` is always sent (default 0 = no limit), mirroring how
        // ``category`` is always sent with its own default; the backend
        // validates it as a non-negative int (AC-C11).
        const created = await mutateAsync({
            category,
            columnName: trimmed,
            projectId,
            wipLimit
        });
        setCategory(DEFAULT_CATEGORY);
        setWipLimit(DEFAULT_WIP_LIMIT);
        setEditing(false);
        // Phase 4.3 — record column create into the activity feed.
        // The 10s-window Undo closure DELETEs the just-created column
        // by id; we bail out if the response is missing an id so a
        // malformed payload doesn't render a broken Undo button.
        const createdId = created?._id;
        recordActivity({
            kind: "column",
            action: "create",
            summary: microcopyString(
                microcopy.activityFeed.descriptions.columnCreated
            ).replace("{name}", trimmed),
            undo: createdId
                ? () => {
                      void undoCreate({ columnId: createdId });
                  }
                : undefined
        });
        // Transient Undo toast — the immediate recovery path alongside the
        // activity-feed entry (same inverse: DELETE the just-created column
        // by id). Skipped when the response carried no id so we never
        // render an Undo the closure can't honor.
        if (createdId) {
            showUndoToast({
                description: microcopy.feedback.columnCreated,
                analyticsTag: "column.create",
                undo: async () => {
                    await undoCreate({ columnId: createdId });
                }
            });
        }
    };

    useEffect(() => {
        if (editing) {
            inputRef.current?.focus();
        }
    }, [editing]);

    if (!editing) {
        return (
            <div className={cn(SLOT_BASE_CLASS, "md:min-w-[9rem]")}>
                <button
                    aria-label={microcopy.actions.addColumn}
                    className={ADD_COLUMN_BUTTON_CLASS}
                    disabled={isLoading}
                    onClick={() => setEditing(true)}
                    type="button"
                >
                    <Plus aria-hidden /> {microcopy.actions.addColumn}
                </button>
            </div>
        );
    }

    return (
        <div className={cn(SLOT_BASE_CLASS, "md:min-w-[16rem]")}>
            <div className="flex w-full flex-col gap-xs">
                <Input
                    aria-label={microcopy.a11y.newColumnName}
                    autoComplete="off"
                    disabled={isLoading}
                    enterKeyHint="done"
                    inputMode="text"
                    onBlur={() => {
                        if (!columnName.trim()) collapse();
                    }}
                    onChange={(e) => setColumnName(e.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") {
                            event.preventDefault();
                            collapse();
                        } else if (event.key === "Enter") {
                            event.preventDefault();
                            void submit();
                        }
                    }}
                    placeholder={microcopy.placeholders.createColumnName}
                    ref={inputRef}
                    value={columnName}
                />
                <Select
                    disabled={isLoading}
                    onValueChange={(value) =>
                        setCategory(value as ColumnCategory)
                    }
                    value={category}
                >
                    <SelectTrigger
                        aria-label={microcopy.a11y.newColumnCategory}
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {CATEGORY_OPTIONS.map((value) => (
                            <SelectItem key={value} value={value}>
                                {microcopy.options.columnCategories[value]}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Input
                    aria-label={microcopy.fields.wipLimit}
                    className="w-full"
                    disabled={isLoading}
                    inputMode="numeric"
                    min={0}
                    onChange={(e) => {
                        const parsed = Number(e.target.value);
                        setWipLimit(
                            e.target.value === "" || Number.isNaN(parsed)
                                ? 0
                                : parsed
                        );
                    }}
                    placeholder={microcopy.column.wipLimitPlaceholder}
                    step={1}
                    type="number"
                    value={wipLimit}
                />
            </div>
        </div>
    );
};

export default ColumnCreator;
