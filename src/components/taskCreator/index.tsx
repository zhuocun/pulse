import { PlusOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Button, Input } from "antd";
import type { InputRef } from "antd";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { microcopy, microcopyString } from "../../constants/microcopy";
import { fontWeight, radius, space } from "../../theme/tokens";
import useActivityFeed from "../../utils/hooks/useActivityFeed";
import useAiDraftModal from "../../utils/hooks/useAiDraftModal";
import useAiEnabled from "../../utils/hooks/useAiEnabled";
import useAuth from "../../utils/hooks/useAuth";
import useReactMutation from "../../utils/hooks/useReactMutation";
import newTaskCallback from "../../utils/optimisticUpdate/createTask";
import AiSparkleIcon from "../aiSparkleIcon";
import AiTaskDraftModal from "../aiTaskDraftModal";

const CreatorRow = styled.div`
    align-items: center;
    /*
     * Stretch to the column width so the two affordances ("Create task" and
     * "Draft with AI") do not crowd each other inside a narrow column. The
     * row still wraps cleanly when both labels exceed the available width.
     */
    display: flex;
    flex-wrap: wrap;
    gap: ${space.xxs}px;
    margin-top: ${space.xxs}px;
    padding: 0 ${space.xs}px;
    width: 100%;
`;

const CreateLink = styled.button`
    align-items: center;
    background: transparent;
    border: 1px dashed transparent;
    border-radius: ${radius.md}px;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
    cursor: pointer;
    display: inline-flex;
    font: inherit;
    font-weight: ${fontWeight.medium};
    gap: ${space.xxs}px;
    /*
     * 32 px keeps the affordance comfortably tappable on a fine-pointer
     * desktop. On coarse pointers (touch) we lift to 44 px to satisfy
     * WCAG 2.5.8 (target size, AA recommendation) so a thumb can land
     * the link without zoom.
     */
    min-height: 32px;
    padding: ${space.xs}px ${space.sm}px;
    transition:
        background-color 120ms ease-out,
        color 120ms ease-out,
        border-color 120ms ease-out;

    &:hover:not(:disabled),
    &:focus-visible:not(:disabled) {
        background: var(--ant-color-primary-bg, rgba(234, 88, 12, 0.06));
        color: var(--ant-color-primary, #ea580c);
    }

    /* Keyboard focus ring is handled globally in App.css; this rule
     * just adds the brand-tinted hover background so the focused state
     * matches the hover state visually. */

    &:disabled {
        cursor: default;
        opacity: 0.5;
    }

    @media (pointer: coarse) {
        min-height: 44px;
    }
`;

const TaskCreator: React.FC<{
    columnId?: string;
    disabled: boolean;
    boardAiOn?: boolean;
}> = ({ columnId, disabled, boardAiOn = true }) => {
    const { user } = useAuth();
    const [taskName, setTaskName] = useState("");
    const [inputMode, setInputMode] = useState(false);
    const inputRef = useRef<InputRef>(null);
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
    const { mutateAsync, isLoading } = useReactMutation(
        "tasks",
        "POST",
        ["tasks", { projectId }],
        newTaskCallback
    );
    const { record: recordActivity } = useActivityFeed();
    const submit = async () => {
        const trimmed = taskName.trim();
        if (!trimmed) {
            // Empty / whitespace-only input is the user collapsing the
            // editor — never POST a "   " task to the board.
            setInputMode(false);
            return;
        }
        setInputMode(false);
        await mutateAsync({
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
         */
        recordActivity({
            kind: "task",
            action: "create",
            summary: microcopyString(
                microcopy.activityFeed.descriptions.taskCreated
            ).replace("{name}", trimmed)
        });
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
            <CreatorRow>
                <CreateLink
                    aria-label={microcopy.actions.createTask}
                    disabled={disabled}
                    onClick={toggle}
                    type="button"
                >
                    <PlusOutlined aria-hidden /> {microcopy.actions.createTask}
                </CreateLink>
                {aiEnabled && boardAiOn && (
                    <>
                        <Button
                            aria-label={microcopy.actions.draftWithAi}
                            disabled={disabled}
                            icon={<AiSparkleIcon aria-hidden />}
                            onClick={() => columnId && openAiDraft(columnId)}
                            size="small"
                            type="link"
                        >
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
            </CreatorRow>
        );
    }
    return (
        <Input
            aria-label={microcopy.a11y.newTaskName}
            disabled={isLoading || disabled}
            enterKeyHint="done"
            inputMode="text"
            onBlur={toggle}
            placeholder={microcopy.placeholders.whatNeedsToBeDone}
            autoComplete="off"
            ref={inputRef}
            onPressEnter={submit}
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    setInputMode(false);
                }
            }}
            value={taskName}
            onChange={(e) => {
                setTaskName(e.target.value);
            }}
            style={{ marginTop: space.xxs }}
        />
    );
};

export default TaskCreator;
