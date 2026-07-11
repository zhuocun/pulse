import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

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
 *   - Desktop / tablet / fine pointer → the shadcn `<Dialog>` (Radix), so
 *     the existing focused-edit experience is preserved.
 *
 * Exactly one of the two renders per platform — never both — so the two
 * focus traps (the Sheet's `useFocusTrap` on the animated branch, the
 * Dialog's own trap) can't fight over the same dialog.
 *
 * Mount behavior caveat: BOTH branches now unmount their children when
 * `open=false` (the phone Sheet always did; the Radix `<Dialog>` unmounts
 * on close too). `forceRender` / `destroyOnHidden` are still accepted for
 * source compatibility but no longer keep the subtree mounted while
 * hidden. For create/edit forms that reset their fields on every open (the
 * `projectModal` pattern) this is unobservable — the form is repopulated on
 * open either way. Do NOT route a form that relies on persisted-across-close
 * field state through this wrapper without revisiting that assumption.
 */
export interface ResponsiveFormSheetProps {
    open: boolean;
    /** Wired to BOTH the Dialog close and the Sheet `onClose`. */
    onClose: () => void;
    title?: React.ReactNode;
    children: React.ReactNode;
    /**
     * Footer slot — a plain node forwarded verbatim to both branches.
     * (Pass already-rendered buttons; a render-prop footer is intentionally
     * NOT supported so the same node serves the Sheet.)
     */
    footer?: React.ReactNode;

    /* -- Desktop-Dialog-only (ignored on phone) ------------------------ */
    width?: number | string;
    /** Accepted for source compatibility; the Dialog is always centered. */
    centered?: boolean;
    /** Accepted for source compatibility; see the mount-behavior caveat. */
    forceRender?: boolean;
    /** Accepted for source compatibility; see the mount-behavior caveat. */
    destroyOnHidden?: boolean;
    /** Desktop Dialog only; the phone Sheet is styled via `rootClassName`. */
    className?: string;

    /* -- Phone-Sheet-only (ignored on desktop) ------------------------- */
    /** Snap detents the Sheet may rest at. Defaults to `["medium", "large"]`. */
    detents?: readonly SheetDetent[];
    /** Detent the Sheet opens at. Defaults to `"medium"`. */
    defaultDetent?: SheetDetent;
    showGrabber?: boolean;

    /* -- Shared -------------------------------------------------------- */
    closable?: boolean;
    closeAriaLabel?: string;
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
    detents = DEFAULT_FORM_DETENTS,
    defaultDetent = "medium",
    showGrabber,
    closable,
    closeAriaLabel,
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
                ariaLabelledBy={ariaLabelledBy}
                closable={closable}
                closeAriaLabel={closeAriaLabel}
                data-testid={dataTestid}
                defaultDetent={defaultDetent}
                detents={detents}
                footer={footer}
                maskClosable={maskClosable}
                onClose={onClose}
                open={open}
                rootClassName={rootClassName}
                showGrabber={showGrabber}
                styles={styles}
                title={title}
            >
                {children}
            </Sheet>
        );
    }

    const labelledByProps = ariaLabelledBy
        ? { "aria-labelledby": ariaLabelledBy }
        : {};

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
        >
            <DialogContent
                {...labelledByProps}
                className={cn(className, rootClassName)}
                data-testid={dataTestid}
                hideClose={closable === false}
                // `maskClosable=false` mirrors AntD's non-dismissible mask:
                // block outside-click close while Escape / the close button
                // still dismiss.
                onInteractOutside={
                    maskClosable === false
                        ? (event) => event.preventDefault()
                        : undefined
                }
                style={
                    width === undefined
                        ? undefined
                        : {
                              maxWidth:
                                  typeof width === "number"
                                      ? `${width}px`
                                      : width
                          }
                }
            >
                {title ? (
                    <DialogHeader>
                        <DialogTitle>{title}</DialogTitle>
                    </DialogHeader>
                ) : null}
                <div style={styles?.body}>{children}</div>
                {footer ? <DialogFooter>{footer}</DialogFooter> : null}
            </DialogContent>
        </Dialog>
    );
};

export { ResponsiveFormSheet };
export default ResponsiveFormSheet;
