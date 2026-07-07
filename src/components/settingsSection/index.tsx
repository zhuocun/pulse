import { RightOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import React from "react";
import { Link } from "react-router";

import {
    easing,
    fontSize,
    fontWeight,
    letterSpacing,
    motion,
    radius,
    space,
    touchTargetCoarse
} from "../../theme/tokens";
import useReducedMotion from "../../utils/hooks/useReducedMotion";
import { flattenSlots } from "../../utils/flattenSlots";

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
 * Leading inset for the row content AND the hairline divider. The divider
 * is inset from the leading edge (never full-bleed) so it aligns under the
 * label text rather than running to the group's edge — the iOS grouped-
 * table look.
 */
const LEADING_INSET = space.md;

const Group = styled.div`
    /* Opaque subtle fill, distinct from the page background, so the group
     * reads as a contained surface. */
    background: var(--ant-color-bg-container, #fff);
    /* Round the OUTER corners only — clipping the children squares the
     * inner row joints so the first row's top corners and last row's
     * bottom corners are the only rounded edges. */
    border-radius: ${radius.lg}px;
    overflow: hidden;

    /* Horizontal hairline on the BOTTOM edge of every row except the last,
     * inset from the leading edge to align under the label. */
    > *:not(:last-child) {
        position: relative;
    }

    > *:not(:last-child)::after {
        content: "";
        position: absolute;
        inset-inline-start: ${LEADING_INSET}px;
        inset-inline-end: 0;
        inset-block-end: 0;
        height: 1px;
        background: var(--ant-color-text, rgba(15, 23, 42, 0.9));
        opacity: 0.15;
        pointer-events: none;
    }

    @media (forced-colors: active) {
        background: Canvas;

        > *:not(:last-child)::after {
            background: CanvasText;
            opacity: 1;
        }
    }
`;

const Header = styled.div`
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
    font-size: ${fontSize.sm}px;
    font-weight: ${fontWeight.semibold};
    letter-spacing: ${letterSpacing.wide};
    margin: ${space.lg}px 0 ${space.xs}px;
    padding-inline-start: ${space.md}px;
    text-transform: uppercase;
`;

const Footer = styled.div`
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
    font-size: ${fontSize.sm}px;
    margin: ${space.xs}px 0 0;
    padding-inline-start: ${space.md}px;
    padding-inline-end: ${space.md}px;
`;

/*
 * Row shells. The three element flavours (static container, router Link,
 * button) share one set of layout rules — flex space-between, the touch-
 * target floor, the row padding, and a press highlight on the interactive
 * variants. The shared declarations live in a string the styled factories
 * splice in so the three stay byte-for-byte aligned.
 */
const rowLayout = `
    align-items: center;
    display: flex;
    /* Wide trailing controls (the Theme / Language Segmented pickers)
     * drop to their own line on narrow phones instead of crushing the
     * leading icon + label — Trailing never shrinks (flex: 0 0 auto),
     * so without wrap the only give in the row was the Leading slot. */
    flex-wrap: wrap;
    gap: ${space.sm}px;
    justify-content: space-between;
    min-height: ${touchTargetCoarse}px;
    /* Block padding only matters once a row wraps to two lines (the
     * 44px min-height dominates single-line rows); it keeps a wrapped
     * control from kissing the hairline divider. */
    padding: ${space.xxs}px ${space.md}px;
    position: relative;
    width: 100%;
`;

const StaticRow = styled.div`
    ${rowLayout}
`;

interface InteractiveRowProps {
    $reducedMotion: boolean;
}

const LinkRow = styled(Link, {
    // `Link` forwards unknown props to its underlying `<a>`; React 19
    // warns on the non-standard `$reducedMotion` DOM attribute. Filter the
    // transient prop so it drives styling only. (Host-element styled
    // factories strip `$`-prefixed props automatically; wrapped components
    // do not.)
    shouldForwardProp: (prop) => prop !== "$reducedMotion"
})<InteractiveRowProps>`
    ${rowLayout}
    /* Strip the anchor chrome so the row reads as a table cell, not a
     * link. The chevron + label carry the affordance. */
    color: inherit;
    text-align: start;
    text-decoration: none;
    transition: ${(p) =>
        p.$reducedMotion
            ? "none"
            : `background ${motion.short}ms ${easing.standard}`};

    &:active {
        background: var(--ant-color-fill-tertiary, rgba(15, 23, 42, 0.08));
    }
`;

const ButtonRow = styled.button<InteractiveRowProps>`
    ${rowLayout}
    appearance: none;
    background: transparent;
    border: 0;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: start;
    transition: ${(p) =>
        p.$reducedMotion
            ? "none"
            : `background ${motion.short}ms ${easing.standard}`};

    &:active {
        background: var(--ant-color-fill-tertiary, rgba(15, 23, 42, 0.08));
    }
`;

const Leading = styled.span`
    align-items: center;
    display: inline-flex;
    gap: ${space.sm}px;
    min-width: 0;
`;

/*
 * The icon never shrinks. Leading is the row's only shrinkable slot
 * (min-width: 0), and without this guard a wide trailing control
 * squeezed the icon glyph before the label ellipsized.
 */
const IconSlot = styled.span`
    align-items: center;
    display: inline-flex;
    flex: 0 0 auto;
`;

const Trailing = styled.span`
    align-items: center;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
    display: inline-flex;
    flex: 0 0 auto;
    gap: ${space.xs}px;
`;

const Chevron = styled(RightOutlined)`
    color: var(--ant-color-text-quaternary, rgba(15, 23, 42, 0.35));
`;

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
     * Destructive actions are not drill-ins, so they get no chevron; any
     * danger tint comes from the caller's `control` (e.g. a danger Button),
     * not from this prop.
     */
    const navigates =
        !control &&
        (to !== undefined || (onActivate !== undefined && !destructive));

    const leading = (
        <Leading>
            {icon ? <IconSlot>{icon}</IconSlot> : null}
            {label}
        </Leading>
    );

    const trailing = (
        <Trailing>
            {control ?? value}
            {navigates ? <Chevron aria-hidden /> : null}
        </Trailing>
    );

    if (to !== undefined && !control) {
        return (
            <LinkRow
                $reducedMotion={reducedMotion}
                className={className}
                data-testid={dataTestid}
                to={to}
            >
                {leading}
                {trailing}
            </LinkRow>
        );
    }

    if (onActivate !== undefined && !control) {
        return (
            <ButtonRow
                $reducedMotion={reducedMotion}
                className={className}
                data-testid={dataTestid}
                onClick={onActivate}
                type="button"
            >
                {leading}
                {trailing}
            </ButtonRow>
        );
    }

    return (
        <StaticRow className={className} data-testid={dataTestid}>
            {leading}
            {trailing}
        </StaticRow>
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
                <Header>{header}</Header>
            ) : null}
            <Group>
                {slots.map((child, index) => (
                    // Slots are positional decoration around a stable,
                    // ordered row set; the index is the correct identity.
                    <div className="pulse-settings-slot" key={index}>
                        {child}
                    </div>
                ))}
            </Group>
            {footer !== undefined && footer !== null ? (
                <Footer>{footer}</Footer>
            ) : null}
        </section>
    );
};

export default SettingsSection;
