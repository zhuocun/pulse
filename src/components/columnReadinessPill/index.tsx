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
 */

import React, { useState } from "react";

import { cn } from "@/lib/utils";

import { microcopy } from "../../constants/microcopy";
import { aiTokens } from "../../theme/aiTokens";
import type { ColumnReadinessReport } from "../../utils/hooks/useColumnReadiness";
import AiSparkleIcon from "../aiSparkleIcon";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

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
 * The pill body doubles as the popover trigger. On `pointer: coarse`
 * viewports a `::before` pseudo-element pads the click target out to the
 * WCAG 2.5.5 44×44 minimum without inflating the visible chip (the
 * `coarse:before:*` utilities); `data-touch-hit-area="44"` is the stable
 * contract marker tests assert against.
 */
const PillBody = React.forwardRef<
    HTMLSpanElement,
    {
        status: "ready" | "needs-grooming";
        ariaLabel: string;
        onKeyDown: (event: React.KeyboardEvent<HTMLSpanElement>) => void;
    } & React.HTMLAttributes<HTMLSpanElement>
>(({ status, ariaLabel, onKeyDown, ...props }, ref) => {
    const copy = microcopy.ai.columnReadiness;
    const label =
        status === "ready"
            ? asMicrocopyString(copy.readyLabel)
            : asMicrocopyString(copy.groomingLabel);
    return (
        <span
            {...props}
            ref={ref}
            aria-label={ariaLabel}
            data-status={status}
            data-testid="column-readiness-pill"
            data-touch-hit-area="44"
            onKeyDown={onKeyDown}
            role="button"
            tabIndex={0}
            style={{ background: aiTokens.bgSubtle }}
            className={cn(
                "relative inline-flex cursor-pointer items-center gap-xxs rounded-sm px-xs py-[2px] text-xs font-medium leading-[1.2]",
                "coarse:before:absolute coarse:before:left-1/2 coarse:before:top-1/2 coarse:before:-z-[1] coarse:before:block coarse:before:min-h-[44px] coarse:before:min-w-[44px] coarse:before:-translate-x-1/2 coarse:before:-translate-y-1/2 coarse:before:content-['']",
                status === "ready" ? "text-success" : "text-warning"
            )}
        >
            <AiSparkleIcon aria-hidden size="sm" />
            <span>{label}</span>
        </span>
    );
});
PillBody.displayName = "PillBody";

const ColumnReadinessPill: React.FC<ColumnReadinessPillProps> = ({
    report
}) => {
    const [open, setOpen] = useState(false);
    if (report.status === "neutral") {
        return null;
    }
    const copy = microcopy.ai.columnReadiness;
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

    const popoverBody =
        report.blockerTasks.length === 0 ? (
            <div className="max-w-[280px] text-xs text-muted-foreground">
                {asMicrocopyString(copy.popoverEmptyReady)}
            </div>
        ) : (
            <ul
                aria-label={asMicrocopyString(copy.popoverBlockerListLabel)}
                className="m-0 flex max-w-[320px] list-none flex-col gap-xs p-0"
            >
                {report.blockerTasks.map(({ task, reasons }) => (
                    <li key={task._id} className="flex flex-col gap-[2px]">
                        <span className="text-xs font-medium">
                            {task.taskName}
                        </span>
                        <span className="text-xs text-muted-foreground">
                            {reasons.join(" · ")}
                        </span>
                    </li>
                ))}
            </ul>
        );

    const handleKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((prev) => !prev);
        } else if (event.key === "Escape") {
            setOpen(false);
        }
    };

    return (
        <Popover onOpenChange={setOpen} open={open}>
            <PopoverTrigger asChild>
                <PillBody
                    ariaLabel={ariaLabel}
                    onKeyDown={handleKeyDown}
                    status={report.status}
                />
            </PopoverTrigger>
            <PopoverContent
                align="start"
                aria-label={popoverTitle}
                className="max-w-[360px]"
            >
                <div className="mb-xs text-sm font-semibold text-foreground">
                    {popoverTitle}
                </div>
                {popoverBody}
            </PopoverContent>
        </Popover>
    );
};

export default ColumnReadinessPill;
