import { PlusOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Input, InputNumber, Select } from "antd";
import type { InputRef } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { microcopy, microcopyString } from "../../constants/microcopy";
import {
    breakpoints,
    fontWeight,
    motion,
    radius,
    space
} from "../../theme/tokens";
import useActivityFeed from "../../utils/hooks/useActivityFeed";
import useReactMutation from "../../utils/hooks/useReactMutation";
import newColumnCallback from "../../utils/optimisticUpdate/createColumn";
import deleteColumnCallback from "../../utils/optimisticUpdate/deleteColumn";

// Persisted "done" semantics for a column. ``category`` is the stored
// source of truth for done-ness (the board echoes a derived ``isDone``);
// a freshly created column defaults to ``"todo"``.
type ColumnCategory = NonNullable<IColumn["category"]>;

const DEFAULT_CATEGORY: ColumnCategory = "todo";

const CATEGORY_OPTIONS: ColumnCategory[] = ["todo", "in_progress", "done"];

const Slot = styled.div<{ $editing?: boolean }>`
    align-self: flex-start;
    display: flex;
    flex: 0 0 auto;
    margin-right: ${space.md}px;
    min-width: min(16rem, calc(100vw - ${space.md * 3}px));
    min-width: min(16rem, calc(100dvw - ${space.md * 3}px));
    padding: ${space.xs}px 0;

    @media (min-width: ${breakpoints.md}px) {
        min-width: ${(props) => (props.$editing ? "16rem" : "9rem")};
    }
`;

// Stacks the name input above the category picker while the creator is
// expanded. The parent ``Slot`` is a row flex container, so the fields
// need their own column wrapper to sit one above the other and stretch to
// the slot width.
const EditingFields = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${space.xs}px;
    width: 100%;
`;

const AddColumnButton = styled.button`
    align-items: center;
    background: var(--ant-color-fill-quaternary, rgba(15, 23, 42, 0.04));
    border: 1px dashed var(--ant-color-border, rgba(15, 23, 42, 0.15));
    border-radius: ${radius.lg}px;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
    cursor: pointer;
    display: inline-flex;
    font: inherit;
    font-weight: ${fontWeight.medium};
    gap: ${space.xs}px;
    height: 100%;
    justify-content: center;
    min-height: 3rem;
    padding: ${space.sm}px ${space.md}px;
    transition:
        background-color ${motion.short}ms ease-out,
        border-color ${motion.short}ms ease-out,
        color ${motion.short}ms ease-out;
    width: 100%;

    &:hover:not(:disabled),
    &:focus-visible:not(:disabled) {
        background: var(--ant-color-primary-bg, rgba(234, 88, 12, 0.08));
        border-color: var(--ant-color-primary, #ea580c);
        border-style: solid;
        color: var(--ant-color-primary, #ea580c);
    }

    &:disabled {
        cursor: default;
        opacity: 0.6;
    }
`;

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

const ColumnCreator: React.FC = () => {
    const [columnName, setColumnName] = useState("");
    const [category, setCategory] = useState<ColumnCategory>(DEFAULT_CATEGORY);
    const [wipLimit, setWipLimit] = useState<number>(DEFAULT_WIP_LIMIT);
    const [editing, setEditing] = useState(false);
    const inputRef = useRef<InputRef>(null);
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

    const collapse = useCallback(() => {
        setEditing(false);
        setColumnName("");
        setCategory(DEFAULT_CATEGORY);
        setWipLimit(DEFAULT_WIP_LIMIT);
    }, []);

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
    };

    useEffect(() => {
        if (editing) {
            inputRef.current?.focus();
        }
    }, [editing]);

    if (!editing) {
        return (
            <Slot>
                <AddColumnButton
                    aria-label={microcopy.actions.addColumn}
                    disabled={isLoading}
                    onClick={() => setEditing(true)}
                    type="button"
                >
                    <PlusOutlined aria-hidden /> {microcopy.actions.addColumn}
                </AddColumnButton>
            </Slot>
        );
    }

    return (
        <Slot $editing>
            <EditingFields>
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
                        }
                    }}
                    onPressEnter={submit}
                    placeholder={microcopy.placeholders.createColumnName}
                    ref={inputRef}
                    size="large"
                    value={columnName}
                />
                <Select<ColumnCategory>
                    aria-label={microcopy.a11y.newColumnCategory}
                    disabled={isLoading}
                    onChange={setCategory}
                    options={CATEGORY_OPTIONS.map((value) => ({
                        label: microcopy.options.columnCategories[value],
                        value
                    }))}
                    size="large"
                    value={category}
                />
                <InputNumber
                    aria-label={microcopy.fields.wipLimit}
                    disabled={isLoading}
                    inputMode="numeric"
                    min={0}
                    onChange={(value) =>
                        setWipLimit(typeof value === "number" ? value : 0)
                    }
                    placeholder={microcopy.column.wipLimitPlaceholder}
                    size="large"
                    step={1}
                    style={{ width: "100%" }}
                    value={wipLimit}
                />
            </EditingFields>
        </Slot>
    );
};

export default ColumnCreator;
