import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { cn } from "@/lib/utils";

import { microcopy, microcopyString } from "../../constants/microcopy";
import useActivityFeed from "../../utils/hooks/useActivityFeed";
import useAiDraftModal from "../../utils/hooks/useAiDraftModal";
import useAiEnabled from "../../utils/hooks/useAiEnabled";
import useAuth from "../../utils/hooks/useAuth";
import useReactMutation from "../../utils/hooks/useReactMutation";
import useUndoToast from "../../utils/hooks/useUndoToast";
import newTaskCallback from "../../utils/optimisticUpdate/createTask";
import deleteTaskCallback from "../../utils/optimisticUpdate/deleteTask";
import AiSparkleIcon from "../aiSparkleIcon";
import AiTaskDraftModal from "../aiTaskDraftModal";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { TOUCH_TARGET } from "../ui/touchTarget";

const CREATE_LINK_CLASS = cn(
    "inline-flex min-h-[32px] items-center gap-xxs rounded-md border border-dashed border-transparent px-sm py-xs font-medium text-muted-foreground transition-colors",
    "enabled:hover:bg-primary/[0.06] enabled:hover:text-primary",
    "enabled:focus-visible:bg-primary/[0.06] enabled:focus-visible:text-primary",
    "disabled:cursor-default disabled:opacity-50",
    TOUCH_TARGET
);

const TaskCreator: React.FC<{
    columnId?: string;
    disabled: boolean;
    boardAiOn?: boolean;
}> = ({ columnId, disabled, boardAiOn = true }) => {
    const { user } = useAuth();
    const [taskName, setTaskName] = useState("");
    const [inputMode, setInputMode] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    // The AI draft modal opens via a URL query param so the system back
    // button dismisses it. The query value is the column id so multiple
    // per-column triggers on the same board don't cross-talk.
    const {
        activeColumnId: aiDraftColumnId,
        openModal: openAiDraft,
        closeModal: closeAiDraft
    } = useAiDraftModal();
    const aiOpen =
        aiDraftColumnId !== undefined && aiDraftColumnId === columnId;
    const { enabled: aiEnabled } = useAiEnabled();
    const { projectId } = useParams<{ projectId: string }>();
    const { mutateAsync, isLoading } = useReactMutation<ITask>(
        "tasks",
        "POST",
        ["tasks", { projectId }],
        newTaskCallback
    );
    // Companion DELETE mutation used purely as the undo closure for
    // the activity-feed Undo button. Shares the cache key so the
    // optimistic remove + invalidation lands in the same list the
    // board is reading. Errors are swallowed: the undo path is fire-
    // and-forget and the auto-revert toast would feel like an extra
    // surprise on top of the user already clicking Undo.
    const { mutateAsync: undoCreate } = useReactMutation(
        "tasks",
        "DELETE",
        ["tasks", { projectId }],
        deleteTaskCallback,
        () => {}
    );
    const { record: recordActivity } = useActivityFeed();
    const { show: showUndoToast } = useUndoToast();
    const submit = async () => {
        const trimmed = taskName.trim();
        if (!trimmed) {
            // Empty / whitespace-only input is the user collapsing the
            // editor — never POST a "   " task to the board.
            setInputMode(false);
            return;
        }
        setInputMode(false);
        const created = await mutateAsync({
            taskName: trimmed,
            projectId,
            columnId,
            coordinatorId: user?._id
        });
        /*
         * Phase 4.3 — record the create event into the activity feed
         * so the bell icon surfaces it. The mutation has resolved by
         * this point so the event reflects an actually-persisted task;
         * if `mutateAsync` rejects, the error bubbles and `record()`
         * is skipped (the optimistic React Query update rolls back via
         * `useReactMutation`'s `onError` handler).
         *
         * Undo closure: the 10s-window button in the activity drawer
         * deletes the just-created task by id. Bail out if the
         * response doesn't carry an id (defensive — every persisted
         * task has one in practice) so a malformed payload doesn't
         * trip the drawer's Undo button.
         */
        const createdId = created?._id;
        recordActivity({
            kind: "task",
            action: "create",
            summary: microcopyString(
                microcopy.activityFeed.descriptions.taskCreated
            ).replace("{name}", trimmed),
            undo: createdId
                ? () => {
                      void undoCreate({ taskId: createdId });
                  }
                : undefined
        });
        // Transient Undo toast — the immediate recovery path alongside the
        // longer-lived activity-feed entry (same inverse: DELETE the
        // just-created task by id). Skipped when the response carried no
        // id so we never render an Undo the closure can't honor.
        if (createdId) {
            showUndoToast({
                description: microcopy.feedback.taskCreated,
                analyticsTag: "task.create",
                undo: async () => {
                    await undoCreate({ taskId: createdId });
                }
            });
        }
    };
    const toggle = () => {
        setInputMode(!inputMode);
    };

    useEffect(() => {
        if (!inputMode) {
            setTaskName("");
        } else {
            inputRef.current?.focus();
        }
    }, [inputMode]);

    if (!inputMode) {
        return (
            <div className="mt-xxs flex w-full flex-wrap items-center gap-xxs px-xs">
                <button
                    aria-label={microcopy.actions.createTask}
                    className={CREATE_LINK_CLASS}
                    disabled={disabled}
                    onClick={toggle}
                    type="button"
                >
                    <Plus aria-hidden /> {microcopy.actions.createTask}
                </button>
                {aiEnabled && boardAiOn && (
                    <>
                        <Button
                            aria-label={microcopy.actions.draftWithAi}
                            disabled={disabled}
                            onClick={() => columnId && openAiDraft(columnId)}
                            size="sm"
                            variant="link"
                        >
                            <AiSparkleIcon aria-hidden />
                            {microcopy.actions.draftWithAi}
                        </Button>
                        {aiOpen && (
                            <AiTaskDraftModal
                                columnId={columnId}
                                onClose={closeAiDraft}
                                open
                            />
                        )}
                    </>
                )}
            </div>
        );
    }
    return (
        <Input
            aria-label={microcopy.a11y.newTaskName}
            autoComplete="off"
            className="mt-xxs"
            disabled={isLoading || disabled}
            enterKeyHint="done"
            inputMode="text"
            onBlur={toggle}
            onChange={(e) => {
                setTaskName(e.target.value);
            }}
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    setInputMode(false);
                } else if (event.key === "Enter") {
                    event.preventDefault();
                    void submit();
                }
            }}
            placeholder={microcopy.placeholders.whatNeedsToBeDone}
            ref={inputRef}
            value={taskName}
        />
    );
};

export default TaskCreator;
