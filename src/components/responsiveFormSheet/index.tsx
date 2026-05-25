import { Modal } from "antd";

import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import Sheet, { type SheetDetent } from "../sheet";

export type { SheetDetent };

/**
 * Responsive form container for the iOS-26 "Liquid Glass" initiative.
 *
 * One dialog, two presentations gated on `useIsPhoneChrome()`:
 *
 *   - Phone (coarse pointer) → the multi-detent bottom `<Sheet>`, opened
 *     at the MEDIUM detent and draggable up to LARGE. The grabber, glass
 *     surface, scrim, and focus trap come from the Sheet primitive — this
 *     wrapper adds no chrome of its own.
 *   - Desktop / tablet / fine pointer → the AntD `<Modal>` unchanged, so
 *     the existing focused-edit experience is byte-for-byte preserved.
 *
 * Exactly one of the two renders per platform — never both — so the two
 * focus traps (the Sheet's `useFocusTrap` on the animated branch, the
 * Modal's own trap) can't fight over the same dialog.
 *
 * Mount behavior caveat: the phone Sheet does NOT honor `forceRender` /
 * `destroyOnHidden` and unmounts (or hides) its children when `open=false`,
 * whereas the desktop `<Modal>` honors them and can keep the subtree
 * mounted while hidden. For create/edit forms that reset
 * their fields on every open (the `projectModal` pattern) this divergence
 * is unobservable — the form is repopulated on open either way. Do NOT
 * route a form that relies on persisted-across-close field state through
 * this wrapper on phone without revisiting that assumption.
 */
export interface ResponsiveFormSheetProps {
    open: boolean;
    /** Wired to BOTH the Modal `onCancel` and the Sheet `onClose`. */
    onClose: () => void;
    title?: React.ReactNode;
    children: React.ReactNode;
    /**
     * Footer slot — a plain node forwarded verbatim to both branches.
     * (Pass already-rendered buttons; the AntD footer render-prop form
     * is intentionally NOT supported so the same node serves the Sheet.)
     */
    footer?: React.ReactNode;

    /* -- Desktop-Modal-only (ignored on phone) ------------------------- */
    width?: number | string;
    centered?: boolean;
    forceRender?: boolean;
    destroyOnHidden?: boolean;
    /** Desktop Modal only; the phone Sheet is styled via `rootClassName`. */
    className?: string;

    /* -- Phone-Sheet-only (ignored on desktop) ------------------------- */
    /** Snap detents the Sheet may rest at. Defaults to `["medium", "large"]`. */
    detents?: readonly SheetDetent[];
    /** Detent the Sheet opens at. Defaults to `"medium"`. */
    defaultDetent?: SheetDetent;
    showGrabber?: boolean;

    /* -- Shared -------------------------------------------------------- */
    closable?: boolean;
    maskClosable?: boolean;
    "data-testid"?: string;
    ariaLabelledBy?: string;
    rootClassName?: string;
    styles?: { body?: React.CSSProperties };
}

const DEFAULT_FORM_DETENTS: readonly SheetDetent[] = ["medium", "large"];

const ResponsiveFormSheet: React.FC<ResponsiveFormSheetProps> = ({
    open,
    onClose,
    title,
    children,
    footer,
    width,
    centered,
    forceRender,
    destroyOnHidden,
    detents = DEFAULT_FORM_DETENTS,
    defaultDetent = "medium",
    showGrabber,
    closable,
    maskClosable,
    "data-testid": dataTestid,
    ariaLabelledBy,
    className,
    rootClassName,
    styles
}) => {
    const isPhone = useIsPhoneChrome();

    if (isPhone) {
        return (
            <Sheet
                open={open}
                onClose={onClose}
                detents={detents}
                defaultDetent={defaultDetent}
                showGrabber={showGrabber}
                title={title}
                footer={footer}
                closable={closable}
                maskClosable={maskClosable}
                data-testid={dataTestid}
                ariaLabelledBy={ariaLabelledBy}
                rootClassName={rootClassName}
                styles={styles}
            >
                {children}
            </Sheet>
        );
    }

    return (
        <Modal
            open={open}
            onCancel={onClose}
            title={title}
            footer={footer}
            width={width}
            centered={centered}
            forceRender={forceRender}
            destroyOnHidden={destroyOnHidden}
            closable={closable}
            /*
             * AntD v6 deprecated the flat `maskClosable` prop in favour
             * of `mask.closable`, and its deprecation check keys off the
             * prop's PRESENCE (`'maskClosable' in props`), not its value —
             * so forwarding `maskClosable={undefined}` would still emit a
             * console warning. Route through the `mask` object shape and
             * only when the consumer actually set it; otherwise omit it so
             * AntD's default (mask shown, closable) stands untouched.
             */
            {...(maskClosable === undefined
                ? {}
                : { mask: { closable: maskClosable } })}
            data-testid={dataTestid}
            aria-labelledby={ariaLabelledBy}
            className={className}
            rootClassName={rootClassName}
            styles={styles}
        >
            {children}
        </Modal>
    );
};

export { ResponsiveFormSheet };
export default ResponsiveFormSheet;
