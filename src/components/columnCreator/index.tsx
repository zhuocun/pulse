import { PlusOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Input } from "antd";
import type { InputRef } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { microcopy } from "../../constants/microcopy";
import {
    breakpoints,
    fontWeight,
    motion,
    radius,
    space
} from "../../theme/tokens";
import useReactMutation from "../../utils/hooks/useReactMutation";
import newColumnCallback from "../../utils/optimisticUpdate/createColumn";

const Slot = styled.div`
    align-self: flex-start;
    display: flex;
    flex: 0 0 auto;
    margin-right: ${space.md}px;
    min-width: min(16rem, calc(100dvw - ${space.md * 3}px));
    padding: ${space.xs}px 0;

    @media (min-width: ${breakpoints.md}px) {
        min-width: 16rem;
    }
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
 * without firing the mutation.
 */
const ColumnCreator: React.FC = () => {
    const [columnName, setColumnName] = useState("");
    const [editing, setEditing] = useState(false);
    const inputRef = useRef<InputRef>(null);
    const { projectId } = useParams<{ projectId: string }>();
    const { mutateAsync, isLoading } = useReactMutation(
        "boards",
        "POST",
        ["boards", { projectId }],
        newColumnCallback
    );

    const collapse = useCallback(() => {
        setEditing(false);
        setColumnName("");
    }, []);

    const submit = async () => {
        const trimmed = columnName.trim();
        if (!trimmed) {
            collapse();
            return;
        }
        setColumnName("");
        await mutateAsync({ columnName: trimmed, projectId });
        setEditing(false);
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
        <Slot>
            <Input
                aria-label={microcopy.a11y.newColumnName}
                disabled={isLoading}
                enterKeyHint="done"
                inputMode="text"
                onBlur={submit}
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
        </Slot>
    );
};

export default ColumnCreator;
