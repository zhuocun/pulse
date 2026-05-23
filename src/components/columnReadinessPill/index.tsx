/**
 * Column-readiness pill (Phase 4 Wave 3 — Ambition 5 of
 * `docs/design/_review-2026-05/04-ai-copilot.md`).
 *
 * Surfaces the deterministic readiness engine's verdict on a column's
 * tasks as a small chip in the column header. When ≥80 % of the column's
 * tasks pass the check we render "Ready to ship"; when <60 % pass we
 * render "Needs grooming"; in between (or below the 3-task floor) the
 * pill returns `null` so columns don't develop a "neutral" indicator
 * that means nothing.
 *
 * Click → popover lists the individual blocker tasks plus the engine's
 * `message` for each one (e.g. "No coordinator assigned."), so the
 * board user can spot which task is dragging the column's score and
 * groom it without leaving the board.
 *
 * Design constraint: we intentionally render an AntD `Tag` directly
 * instead of importing the shared `<CopilotChip>` that Lane H is
 * shipping in parallel. The two lanes are wave-3 siblings; cross-lane
 * coupling here would force a serial dependency we don't need. If the
 * shared chip ships in the same release we'll migrate this surface in
 * a follow-up; in the meantime the visual is intentionally restrained
 * (Tag + sparkle + label) so a swap is a one-import refactor.
 */

import styled from "@emotion/styled";
import { Popover, Tag } from "antd";
import React, { useState } from "react";

import { microcopy } from "../../constants/microcopy";
import { aiTokens } from "../../theme/aiTokens";
import { fontSize, fontWeight, radius, space } from "../../theme/tokens";
import type { ColumnReadinessReport } from "../../utils/hooks/useColumnReadiness";
import AiSparkleIcon from "../aiSparkleIcon";

/**
 * Touch hit-area expander (PR #308 review — Followup B). On `pointer:
 * coarse` viewports we bump the pill's hit area to the WCAG 2.1 SC 2.5.5
 * recommended 44×44 minimum *without* changing the visible chip size —
 * a `::before` pseudo-element pads out the click target using a
 * negative inset margin so the parent layout stays unchanged. The
 * visible pill still measures whatever the inline styles spec (so the
 * column header doesn't bloat for fine-pointer users), but a tap
 * anywhere inside the 44-square activates the popover. The rule is
 * gated on `(pointer: coarse)` so desktop precision pointing isn't
 * affected.
 */
const PillRoot = styled.span`
    position: relative;
    @media (pointer: coarse) {
        &::before {
            content: "";
            position: absolute;
            inset: 50% auto auto 50%;
            min-block-size: 44px;
            min-inline-size: 44px;
            transform: translate(-50%, -50%);
            /*
             * Negative z-index keeps the expander behind the visible
             * pill so it doesn't sit on top of the sparkle / label.
             * Pointer events still reach it because the parent is the
             * Popover trigger.
             */
            z-index: -1;
        }
    }
`;

const formatTemplate = (
    template: string,
    values: Record<string, string | number>
): string =>
    Object.entries(values).reduce(
        (acc, [key, value]) => acc.replace(`{${key}}`, String(value)),
        template
    );

interface ColumnReadinessPillProps {
    report: ColumnReadinessReport;
}

const asMicrocopyString = (value: unknown): string =>
    typeof value === "string" ? value : String(value ?? "");

/**
 * The pill body. Pulled out so we can `aria-label` the outer span
 * without duplicating the visible-text logic and so the test harness
 * has a single render path to assert against.
 */
const PillBody: React.FC<{
    status: "ready" | "needs-grooming";
    ariaLabel: string;
    onKeyDown: (event: React.KeyboardEvent<HTMLSpanElement>) => void;
}> = ({ status, ariaLabel, onKeyDown }) => {
    const copy = microcopy.ai.columnReadiness;
    const label =
        status === "ready"
            ? asMicrocopyString(copy.readyLabel)
            : asMicrocopyString(copy.groomingLabel);
    return (
        <PillRoot
            aria-label={ariaLabel}
            data-status={status}
            data-testid="column-readiness-pill"
            onKeyDown={onKeyDown}
            role="button"
            style={{
                alignItems: "center",
                background: aiTokens.bgSubtle,
                borderRadius: radius.sm,
                color:
                    status === "ready"
                        ? "var(--ant-color-success-text, #15803D)"
                        : "var(--ant-color-warning-text, #B45309)",
                cursor: "pointer",
                display: "inline-flex",
                fontSize: fontSize.xs,
                fontWeight: fontWeight.medium,
                gap: space.xxs,
                lineHeight: 1.2,
                paddingBlock: 2,
                paddingInline: space.xs
            }}
            tabIndex={0}
        >
            <AiSparkleIcon aria-hidden size="sm" />
            <span>{label}</span>
        </PillRoot>
    );
};

const ColumnReadinessPill: React.FC<ColumnReadinessPillProps> = ({
    report
}) => {
    const [open, setOpen] = useState(false);
    if (report.status === "neutral") {
        return null;
    }
    const copy = microcopy.ai.columnReadiness;
    /*
     * The aria-label lives outside the visible label (the visible label
     * is the status microcopy; the screen-reader label is the
     * machine-readable ratio "<n> of <m> tasks ready"). Per the spec.
     */
    const ariaTemplate =
        report.status === "ready"
            ? asMicrocopyString(microcopy.a11y.columnReadinessReady)
            : asMicrocopyString(microcopy.a11y.columnReadinessGrooming);
    const ariaLabel = formatTemplate(ariaTemplate, {
        ready: report.readyCount,
        total: report.totalCount
    });

    const popoverTitle = formatTemplate(
        report.status === "ready"
            ? asMicrocopyString(copy.popoverTitleReady)
            : asMicrocopyString(copy.popoverTitleGrooming),
        { ready: report.readyCount, total: report.totalCount }
    );

    const popoverContent =
        report.blockerTasks.length === 0 ? (
            <div
                style={{
                    color: "var(--ant-color-text-secondary, rgba(15, 23, 42, 0.55))",
                    fontSize: fontSize.xs,
                    maxWidth: 280
                }}
            >
                {asMicrocopyString(copy.popoverEmptyReady)}
            </div>
        ) : (
            <ul
                aria-label={asMicrocopyString(copy.popoverBlockerListLabel)}
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: space.xs,
                    listStyle: "none",
                    margin: 0,
                    maxWidth: 320,
                    padding: 0
                }}
            >
                {report.blockerTasks.map(({ task, reasons }) => (
                    <li
                        key={task._id}
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 2
                        }}
                    >
                        <span
                            style={{
                                fontSize: fontSize.xs,
                                fontWeight: fontWeight.medium
                            }}
                        >
                            {task.taskName}
                        </span>
                        <span
                            style={{
                                color: "var(--ant-color-text-secondary, rgba(15, 23, 42, 0.55))",
                                fontSize: fontSize.xs
                            }}
                        >
                            {reasons.join(" · ")}
                        </span>
                    </li>
                ))}
            </ul>
        );

    const handleKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>) => {
        // Enter / Space activate the pill (matches role="button" axe rule).
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((prev) => !prev);
        } else if (event.key === "Escape") {
            setOpen(false);
        }
    };

    return (
        <Popover
            content={popoverContent}
            onOpenChange={setOpen}
            open={open}
            overlayStyle={{ maxWidth: 360 }}
            placement="bottomLeft"
            title={popoverTitle}
            trigger="click"
        >
            {/*
             * AntD's Popover clones its child and attaches the click /
             * keyboard handlers to the child's ROOT — the <Tag>, not
             * the inner <span>. The aria-label has to live on the Tag
             * so a screen-reader user navigating to the popover
             * trigger by role hears the readiness ratio instead of an
             * unlabelled "button". The inner PillBody keeps a copy of
             * the label so screen readers reading the focused element
             * (role=button, tabIndex=0) also announce the count — both
             * paths surface the same accessible name, no double-
             * announce because the inner span sits inside the Tag's
             * accessibility subtree.
             */}
            <Tag
                aria-label={ariaLabel}
                style={{
                    background: "transparent",
                    border: "none",
                    margin: 0,
                    padding: 0
                }}
            >
                <PillBody
                    ariaLabel={ariaLabel}
                    onKeyDown={handleKeyDown}
                    status={report.status}
                />
            </Tag>
        </Popover>
    );
};

export default ColumnReadinessPill;
