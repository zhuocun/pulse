import { ChevronRight } from "lucide-react";
import React from "react";
import { Link } from "react-router";

import { cn } from "@/lib/utils";

import { flattenSlots } from "../../utils/flattenSlots";
import useReducedMotion from "../../utils/hooks/useReducedMotion";

/**
 * SettingsSection / SettingsRow — the iOS 26 grouped-table idiom for the
 * PHONE settings surface.
 *
 * A section is one uppercase context header, an opaque rounded group that
 * clips its rows so only the OUTER corners round (inner row joints stay
 * square), and an optional footer gloss line. Each row is a single line
 * with a leading label (+ optional icon) and a trailing control / value /
 * disclosure chevron.
 *
 * These primitives ALWAYS render grouped chrome — the consumer branches
 * on chassis (phone composes these; desktop keeps its own Card layout),
 * so there is no responsive logic here.
 *
 * Children pass through `flattenSlots` so a conditionally-rendered row
 * (`{cond && <SettingsRow/>}`) still lands in its own slot — and therefore
 * gets its own divider boundary — rather than collapsing a fragment into a
 * single slot that paints no hairline.
 */

/*
 * Row shell shared by the three flavours (static container, router Link,
 * button). Flex space-between, the 44px touch-target floor, the row
 * padding, and `flex-wrap` so a wide trailing control drops to its own
 * line on narrow phones instead of crushing the leading icon + label.
 */
const ROW_LAYOUT = cn(
    "relative flex w-full flex-wrap items-center justify-between gap-sm",
    "min-h-[44px] px-md py-xxs"
);

export interface SettingsSectionProps {
    header?: React.ReactNode;
    footer?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
    "data-testid"?: string;
}

export interface SettingsRowProps {
    label: React.ReactNode;
    icon?: React.ReactNode;
    control?: React.ReactNode;
    value?: React.ReactNode;
    to?: string;
    onActivate?: () => void;
    destructive?: boolean;
    "data-testid"?: string;
    className?: string;
}

const Leading = ({
    icon,
    label
}: {
    icon?: React.ReactNode;
    label: React.ReactNode;
}) => (
    <span className="inline-flex min-w-0 items-center gap-sm">
        {icon ? (
            // The icon never shrinks — Leading is the row's only shrinkable
            // slot, so without this the icon glyph squeezes before the
            // label ellipsizes.
            <span className="inline-flex flex-none items-center">{icon}</span>
        ) : null}
        {label}
    </span>
);

const Trailing = ({ children }: { children: React.ReactNode }) => (
    <span className="inline-flex flex-none items-center gap-xs text-muted-foreground">
        {children}
    </span>
);

const Chevron = () => (
    <ChevronRight
        aria-hidden
        className="size-4 text-foreground/35"
        data-chevron
    />
);

export const SettingsRow = ({
    label,
    icon,
    control,
    value,
    to,
    onActivate,
    destructive = false,
    "data-testid": dataTestid,
    className
}: SettingsRowProps) => {
    const reducedMotion = useReducedMotion();

    /*
     * A row navigates — and so earns a disclosure chevron — when it links
     * (`to`) or fires a non-destructive `onActivate`, AND it carries no
     * trailing control (a row WITH a control is not itself clickable).
     * Destructive actions are not drill-ins, so they get no chevron.
     */
    const navigates =
        !control &&
        (to !== undefined || (onActivate !== undefined && !destructive));

    const leading = <Leading icon={icon} label={label} />;
    const trailing = (
        <Trailing>
            {control ?? value}
            {navigates ? <Chevron /> : null}
        </Trailing>
    );

    const pressTransition = reducedMotion
        ? ""
        : "transition-colors duration-short ease-standard";

    if (to !== undefined && !control) {
        return (
            <Link
                className={cn(
                    ROW_LAYOUT,
                    "text-start text-inherit no-underline",
                    "active:bg-foreground/[0.08]",
                    pressTransition,
                    className
                )}
                data-testid={dataTestid}
                to={to}
            >
                {leading}
                {trailing}
            </Link>
        );
    }

    if (onActivate !== undefined && !control) {
        return (
            <button
                className={cn(
                    ROW_LAYOUT,
                    "cursor-pointer appearance-none border-0 bg-transparent text-start font-[inherit]",
                    "active:bg-foreground/[0.08]",
                    pressTransition,
                    className
                )}
                data-testid={dataTestid}
                onClick={onActivate}
                type="button"
            >
                {leading}
                {trailing}
            </button>
        );
    }

    return (
        <div className={cn(ROW_LAYOUT, className)} data-testid={dataTestid}>
            {leading}
            {trailing}
        </div>
    );
};

export const SettingsSection = ({
    header,
    footer,
    children,
    className,
    "data-testid": dataTestid
}: SettingsSectionProps) => {
    const slots = flattenSlots(children);

    return (
        <section className={className} data-testid={dataTestid}>
            {header !== undefined && header !== null ? (
                <div className="mb-xs mt-lg ps-md text-sm font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                    {header}
                </div>
            ) : null}
            <div className="overflow-hidden rounded-lg bg-card forced-colors:bg-[Canvas]">
                {slots.map((child, index) => (
                    // Slots are positional decoration around a stable,
                    // ordered row set; the index is the correct identity.
                    // The hairline divider is inset from the leading edge
                    // to align under the label — the iOS grouped-table look.
                    <div
                        className={cn(
                            "pulse-settings-slot relative",
                            "after:pointer-events-none after:absolute after:bottom-0 after:start-md after:end-0",
                            "after:h-px after:bg-foreground/[0.15] after:content-['']",
                            "last:after:hidden",
                            "forced-colors:after:bg-[CanvasText] forced-colors:after:opacity-100"
                        )}
                        key={index}
                    >
                        {child}
                    </div>
                ))}
            </div>
            {footer !== undefined && footer !== null ? (
                <div className="mt-xs px-md text-sm text-muted-foreground">
                    {footer}
                </div>
            ) : null}
        </section>
    );
};

export default SettingsSection;
