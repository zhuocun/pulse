import { useCallback, useMemo, useState } from "react";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

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
import useShortcut from "../../utils/hooks/useShortcut";

const SCOPE_HEADING_CLASS = cn(
    "m-0 mb-xs text-xs font-semibold uppercase tracking-[0.04em]",
    "[color:var(--ant-color-text-secondary,rgba(15,23,42,0.65))]"
);

const ROW_CLASS = cn(
    "flex items-center justify-between gap-md py-xs",
    "[&+&]:border-t [&+&]:border-[color:var(--ant-color-border-secondary,rgba(15,23,42,0.06))]"
);

const KEY_CLASS = cn(
    "min-w-[1.5em] rounded-sm border px-xs py-[2px] text-center font-[inherit] text-xs font-medium leading-[1.4]",
    "[background:var(--ant-color-fill-tertiary,rgba(15,23,42,0.06))]",
    "border-[color:var(--ant-color-border,rgba(15,23,42,0.12))]",
    "shadow-[0_1px_0_var(--ant-color-border,rgba(15,23,42,0.12))]",
    "[color:var(--ant-color-text,inherit)]"
);

/**
 * Render an entry's structured combo as `<kbd>` tokens. Multiple segments
 * (a typed sequence like `g p`) are separated by a "then" hint; tokens within
 * a segment are rendered side-by-side. Multi-token segments (the keyboard-drag
 * hint, which lists Space / arrows / Esc) are joined inline.
 */
const ComboKeys: React.FC<{ entry: ShortcutEntry }> = ({ entry }) => {
    const then = microcopy.shortcuts.sequenceThen;
    return (
        <span className="inline-flex flex-[0_0_auto] flex-wrap justify-end gap-xxs">
            {entry.combo.map((segment, segmentIndex) => (
                <span
                    key={`${entry.id}-seg-${segmentIndex}`}
                    className="inline-flex gap-[2px]"
                >
                    {segmentIndex > 0 ? (
                        <span className="self-center text-xs [color:var(--ant-color-text-tertiary,rgba(15,23,42,0.45))]">
                            {then}
                        </span>
                    ) : null}
                    {segment.map((token) => (
                        <kbd
                            key={`${token.key}-${token.label ?? ""}`}
                            className={KEY_CLASS}
                        >
                            {renderToken(token)}
                        </kbd>
                    ))}
                </span>
            ))}
        </span>
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
 * dismissible via Esc / close (the Dialog primitive handles focus-trapping +
 * Esc). The dialog's accessible name comes from
 * `microcopy.shortcuts.dialogTitle`.
 */
const ShortcutHelp: React.FC<ShortcutHelpProps> = ({
    open: controlledOpen,
    onClose
}) => {
    const [internalOpen, setInternalOpen] = useState(false);
    const isControlled = controlledOpen !== undefined;
    const open = isControlled ? controlledOpen : internalOpen;

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
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) handleClose();
            }}
        >
            <DialogContent className="max-w-[520px]">
                <DialogHeader>
                    <DialogTitle>{microcopy.shortcuts.dialogTitle}</DialogTitle>
                    <DialogDescription>
                        {microcopy.shortcuts.dialogDescription}
                    </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-lg">
                    {groups.map((group) => (
                        <section
                            aria-label={scopeLabel(group.scope)}
                            key={group.scope}
                        >
                            <h3 className={SCOPE_HEADING_CLASS}>
                                {scopeLabel(group.scope)}
                            </h3>
                            {group.entries.map((entry) => (
                                <div className={ROW_CLASS} key={entry.id}>
                                    <span className="min-w-0 [color:var(--ant-color-text,inherit)] [overflow-wrap:anywhere]">
                                        {describeShortcut(entry)}
                                    </span>
                                    <ComboKeys entry={entry} />
                                </div>
                            ))}
                        </section>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default ShortcutHelp;
