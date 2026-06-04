import styled from "@emotion/styled";
import { Modal, Typography } from "antd";
import { useCallback, useId, useMemo, useState } from "react";

import { microcopy } from "../../constants/microcopy";
import {
    SCOPE_ORDER,
    SHORTCUTS,
    describeShortcut,
    getShortcut,
    renderToken,
    scopeLabel,
    type ShortcutEntry,
    type ShortcutScope
} from "../../constants/shortcuts";
import { fontSize, fontWeight, radius, space } from "../../theme/tokens";
import useReducedMotion from "../../utils/hooks/useReducedMotion";
import useShortcut from "../../utils/hooks/useShortcut";

const Section = styled.section`
    & + & {
        margin-top: ${space.lg}px;
    }
`;

const ScopeHeading = styled.h3`
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65));
    font-size: ${fontSize.xs}px;
    font-weight: ${fontWeight.semibold};
    letter-spacing: 0.04em;
    margin: 0 0 ${space.xs}px;
    text-transform: uppercase;
`;

const Row = styled.div`
    align-items: center;
    display: flex;
    gap: ${space.md}px;
    justify-content: space-between;
    padding: ${space.xs}px 0;

    & + & {
        border-top: 1px solid
            var(--ant-color-border-secondary, rgba(15, 23, 42, 0.06));
    }
`;

const Description = styled.span`
    color: var(--ant-color-text, inherit);
    min-width: 0;
    overflow-wrap: anywhere;
`;

const ComboWrap = styled.span`
    display: inline-flex;
    flex: 0 0 auto;
    flex-wrap: wrap;
    gap: ${space.xxs}px;
    justify-content: flex-end;
`;

const Key = styled.kbd`
    background: var(--ant-color-fill-tertiary, rgba(15, 23, 42, 0.06));
    border: 1px solid var(--ant-color-border, rgba(15, 23, 42, 0.12));
    border-radius: ${radius.sm}px;
    box-shadow: 0 1px 0 var(--ant-color-border, rgba(15, 23, 42, 0.12));
    color: var(--ant-color-text, inherit);
    font-family: inherit;
    font-size: ${fontSize.xs}px;
    font-weight: ${fontWeight.medium};
    line-height: 1.4;
    min-width: 1.5em;
    padding: 2px ${space.xs}px;
    text-align: center;
`;

const SequenceSep = styled.span`
    color: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.45));
    font-size: ${fontSize.xs}px;
    align-self: center;
`;

/**
 * Render an entry's structured combo as `<kbd>` tokens. Multiple segments
 * (a typed sequence like `g p`) are separated by a "then" hint; tokens within
 * a segment are rendered side-by-side. Multi-token segments (the keyboard-drag
 * hint, which lists Space / arrows / Esc) are joined inline.
 */
const ComboKeys: React.FC<{ entry: ShortcutEntry }> = ({ entry }) => {
    const then = microcopy.shortcuts.sequenceThen;
    return (
        <ComboWrap>
            {entry.combo.map((segment, segmentIndex) => (
                <span
                    key={`${entry.id}-seg-${segmentIndex}`}
                    style={{ display: "inline-flex", gap: 2 }}
                >
                    {segmentIndex > 0 ? (
                        <SequenceSep>{then}</SequenceSep>
                    ) : null}
                    {segment.map((token) => (
                        <Key key={`${token.key}-${token.label ?? ""}`}>
                            {renderToken(token)}
                        </Key>
                    ))}
                </span>
            ))}
        </ComboWrap>
    );
};

interface GroupedScope {
    scope: ShortcutScope;
    entries: ShortcutEntry[];
}

const groupByScope = (): GroupedScope[] =>
    SCOPE_ORDER.map((scope) => ({
        scope,
        entries: SHORTCUTS.filter((entry) => entry.scope === scope)
    })).filter((group) => group.entries.length > 0);

export interface ShortcutHelpProps {
    /**
     * Controlled open state. When omitted, the component self-manages its
     * open state via the `?` global shortcut (the app-shell usage).
     */
    open?: boolean;
    onClose?: () => void;
}

/**
 * Keyboard-shortcut help dialog (ui-todo §2.A.9, WCAG 3.2.6 Consistent Help).
 *
 * Lists the `SHORTCUTS` catalog grouped by scope, rendering each combo as
 * `<kbd>`. Opens on `?` (global, suppressed while typing in a field) and is
 * dismissible via Esc / close (AntD Modal handles focus-trapping + Esc). The
 * dialog's accessible name comes from `microcopy.shortcuts.dialogTitle`.
 */
const ShortcutHelp: React.FC<ShortcutHelpProps> = ({
    open: controlledOpen,
    onClose
}) => {
    const [internalOpen, setInternalOpen] = useState(false);
    const isControlled = controlledOpen !== undefined;
    const open = isControlled ? controlledOpen : internalOpen;
    const reducedMotion = useReducedMotion();
    const titleId = useId();
    const descId = useId();

    const groups = useMemo(groupByScope, []);

    // The `?` toggle entry. Self-managed only; in controlled mode the parent
    // owns the open state (and may register the shortcut itself).
    const helpCombo = getShortcut("openShortcutHelp")!.combo;
    const handleOpen = useCallback(() => {
        if (!isControlled) setInternalOpen(true);
    }, [isControlled]);
    useShortcut(helpCombo, handleOpen, { enabled: !isControlled });

    const handleClose = useCallback(() => {
        if (!isControlled) setInternalOpen(false);
        onClose?.();
    }, [isControlled, onClose]);

    return (
        <Modal
            aria-describedby={descId}
            aria-labelledby={titleId}
            destroyOnHidden
            footer={null}
            onCancel={handleClose}
            open={open}
            title={<span id={titleId}>{microcopy.shortcuts.dialogTitle}</span>}
            transitionName={reducedMotion ? "" : undefined}
            maskTransitionName={reducedMotion ? "" : undefined}
            width={520}
        >
            <Typography.Paragraph id={descId} type="secondary">
                {microcopy.shortcuts.dialogDescription}
            </Typography.Paragraph>
            {groups.map((group) => (
                <Section aria-label={scopeLabel(group.scope)} key={group.scope}>
                    <ScopeHeading>{scopeLabel(group.scope)}</ScopeHeading>
                    {group.entries.map((entry) => (
                        <Row key={entry.id}>
                            <Description>{describeShortcut(entry)}</Description>
                            <ComboKeys entry={entry} />
                        </Row>
                    ))}
                </Section>
            ))}
        </Modal>
    );
};

export default ShortcutHelp;
