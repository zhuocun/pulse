import { History } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@/components/ui/popover";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@/components/ui/tooltip";
import { Typography } from "@/components/ui/typography";

import { microcopy, microcopyString } from "../../constants/microcopy";
import { fontSize } from "../../theme/tokens";
import { formatRelativeTime } from "../../utils/formatRelativeTime";
import useAiLedger, { type LedgerEntry } from "../../utils/hooks/useAiLedger";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import Sheet from "../sheet";

/**
 * AI activity ledger pill + expandable list (Phase 4 A8).
 *
 * The pill renders inline (counts AI mutations recorded this session)
 * and expands into a popover on desktop / bottom drawer on phone chrome.
 * Each row shows the description, a relative timestamp, and a Revert
 * button — the button is hidden when the entry's undo closure isn't
 * alive in this process (post-reload state where Redux survives but
 * function references don't). The whole component returns `null` when
 * there are no entries to keep the dock footer area uncluttered.
 *
 * The pill is `position: sticky` against the dock body so it never
 * blocks the underlying input composer; the dock body is a flex column
 * and the pill sits between the tab pane and the composer.
 */

/*
 * Inline relative-time formatter. Delegates to the shared
 * `formatRelativeTime` util but reads from the dedicated
 * `aiActivityLog.relative*` keys (through `microcopyString`) so future
 * tuning ("just now" vs "moments ago") stays local to this surface. The
 * Proxy reads stay here so a locale switch propagates on the next tick.
 */
const formatRelative = (then: number, now: number): string =>
    formatRelativeTime(then, now, {
        justNow: microcopyString(microcopy.aiActivityLog.relativeJustNow),
        oneMinute: microcopyString(microcopy.aiActivityLog.relativeOneMinute),
        minutes: microcopyString(microcopy.aiActivityLog.relativeMinutes),
        oneHour: microcopyString(microcopy.aiActivityLog.relativeOneHour),
        hours: microcopyString(microcopy.aiActivityLog.relativeHours),
        oneDay: microcopyString(microcopy.aiActivityLog.relativeOneDay),
        days: microcopyString(microcopy.aiActivityLog.relativeDays)
    });

interface LedgerListBodyProps {
    entries: LedgerEntry[];
    isRevertable: (id: string) => boolean;
    onRevert: (id: string) => Promise<void>;
    onRequestClearAll: () => void;
}

const LedgerListBody: React.FC<LedgerListBodyProps> = ({
    entries,
    isRevertable,
    onRevert,
    onRequestClearAll
}) => {
    const [reverting, setReverting] = useState<string | null>(null);
    /*
     * `now` ticks every 30 s so the "2 min ago" labels stay fresh while
     * the list is open. The interval is cheap — it touches a single
     * setState and the rows re-render against the same data.
     */
    const [now, setNow] = useState<number>(() => Date.now());
    useEffect(() => {
        const id = window.setInterval(() => setNow(Date.now()), 30_000);
        return () => window.clearInterval(id);
    }, []);

    const handleRevert = useCallback(
        async (id: string) => {
            setReverting(id);
            try {
                await onRevert(id);
            } finally {
                setReverting(null);
            }
        },
        [onRevert]
    );

    return (
        <TooltipProvider>
            <div
                className="flex max-h-[60dvh] min-w-[280px] flex-col gap-xs overflow-y-auto [overscroll-behavior:contain]"
                data-testid="ai-activity-log-list"
            >
                <div className="flex items-center justify-between pb-xs">
                    <Typography.Text strong style={{ fontSize: fontSize.sm }}>
                        {microcopyString(microcopy.aiActivityLog.listTitle)}
                    </Typography.Text>
                    <Button
                        disabled={entries.length === 0}
                        onClick={onRequestClearAll}
                        size="sm"
                        variant="ghost"
                    >
                        {microcopyString(microcopy.aiActivityLog.clearAll)}
                    </Button>
                </div>
                {entries.length === 0 ? (
                    <Typography.Paragraph
                        style={{ margin: 0 }}
                        type="secondary"
                    >
                        {microcopyString(microcopy.aiActivityLog.emptyState)}
                    </Typography.Paragraph>
                ) : (
                    <ul className="m-0 flex list-none flex-col gap-xs p-0">
                        {[...entries].reverse().map((entry) => {
                            const revertable = isRevertable(entry.id);
                            const isBusy = reverting === entry.id;
                            return (
                                <li
                                    className="m-0 p-0"
                                    data-entry-id={entry.id}
                                    data-testid="ai-activity-log-row"
                                    key={entry.id}
                                >
                                    <div className="flex w-full items-start justify-between gap-xs">
                                        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Typography.Text className="line-clamp-2 break-words">
                                                        {entry.description}
                                                    </Typography.Text>
                                                </TooltipTrigger>
                                                <TooltipContent side="top">
                                                    {entry.description}
                                                </TooltipContent>
                                            </Tooltip>
                                            <Typography.Text
                                                className="text-xs"
                                                type="secondary"
                                            >
                                                {formatRelative(
                                                    entry.timestamp,
                                                    now
                                                )}
                                            </Typography.Text>
                                        </div>
                                        {revertable ? (
                                            <Button
                                                aria-label={microcopyString(
                                                    microcopy.aiActivityLog
                                                        .revertAriaLabel
                                                ).replace(
                                                    "{description}",
                                                    entry.description
                                                )}
                                                data-testid="ai-activity-log-revert"
                                                loading={isBusy}
                                                onClick={() =>
                                                    void handleRevert(entry.id)
                                                }
                                                size="sm"
                                            >
                                                {microcopyString(
                                                    microcopy.aiActivityLog
                                                        .revert
                                                )}
                                            </Button>
                                        ) : (
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <span
                                                        className="text-muted-foreground"
                                                        aria-hidden
                                                    >
                                                        —
                                                    </span>
                                                </TooltipTrigger>
                                                <TooltipContent side="left">
                                                    {microcopyString(
                                                        microcopy.aiActivityLog
                                                            .revertUnavailable
                                                    )}
                                                </TooltipContent>
                                            </Tooltip>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </TooltipProvider>
    );
};

const AiActivityLog: React.FC = () => {
    const { entries, revert, clear, isRevertable } = useAiLedger();
    const isPhone = useIsPhoneChrome();
    const [open, setOpen] = useState(false);
    const [confirmClearOpen, setConfirmClearOpen] = useState(false);

    /*
     * Auto-close the surface when the list goes empty so the dock body
     * snaps back to its default layout without leaving an empty popover
     * hovering over the composer.
     */
    useEffect(() => {
        if (entries.length === 0 && open) setOpen(false);
    }, [entries.length, open]);

    if (entries.length === 0) return null;

    const pillLabelTemplate =
        entries.length === 1
            ? microcopy.aiActivityLog.pillLabel
            : microcopy.aiActivityLog.pillLabelPlural;
    const pillLabel = microcopyString(pillLabelTemplate).replace(
        "{count}",
        String(entries.length)
    );

    const pillAriaLabel = open
        ? microcopyString(microcopy.aiActivityLog.pillAriaExpanded)
        : microcopyString(microcopy.aiActivityLog.pillAriaCollapsed);

    /*
     * On desktop the pill is a Radix `PopoverTrigger` (`asChild`), which
     * owns the open toggle — so we must NOT also attach our own onClick
     * there or the two handlers would cancel each other out. On phone the
     * pill drives the Sheet directly and takes an explicit onClick.
     */
    const renderPill = (onClick?: () => void) => (
        <button
            aria-expanded={open}
            aria-label={pillAriaLabel}
            className="inline-flex max-h-8 items-center gap-xs whitespace-nowrap rounded-pill border border-border bg-card px-sm py-[4px] text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid="ai-activity-log-pill"
            onClick={onClick}
            type="button"
        >
            <span className="relative inline-flex">
                <History aria-hidden className="size-4" />
                <span
                    aria-hidden
                    className="pointer-events-none absolute -right-[6px] -top-[6px] inline-flex min-w-4 items-center justify-center rounded-pill bg-primary px-[3px] text-[10px] font-semibold leading-4 text-primary-foreground"
                >
                    {entries.length}
                </span>
            </span>
            <span>{pillLabel}</span>
        </button>
    );

    const listBody = (
        <LedgerListBody
            entries={entries}
            isRevertable={isRevertable}
            onRequestClearAll={() => setConfirmClearOpen(true)}
            onRevert={revert}
        />
    );

    const confirmDialog = (
        <Dialog onOpenChange={setConfirmClearOpen} open={confirmClearOpen}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>
                        {microcopyString(
                            microcopy.aiActivityLog.clearConfirmTitle
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        {microcopyString(
                            microcopy.aiActivityLog.clearConfirmBody
                        )}
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button
                        onClick={() => setConfirmClearOpen(false)}
                        variant="default"
                    >
                        {microcopyString(
                            microcopy.aiActivityLog.clearConfirmCancel
                        )}
                    </Button>
                    <Button
                        onClick={() => {
                            clear();
                            setConfirmClearOpen(false);
                        }}
                        variant="primary"
                    >
                        {microcopyString(
                            microcopy.aiActivityLog.clearConfirmOk
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );

    if (isPhone) {
        return (
            <div data-testid="ai-activity-log">
                {renderPill(() => setOpen((prev) => !prev))}
                <Sheet
                    closable
                    data-testid="ai-activity-log-drawer"
                    desktopPlacement="bottom"
                    onClose={() => setOpen(false)}
                    open={open}
                    title={microcopyString(microcopy.aiActivityLog.listTitle)}
                >
                    {listBody}
                </Sheet>
                {confirmDialog}
            </div>
        );
    }

    return (
        <div data-testid="ai-activity-log">
            <Popover onOpenChange={setOpen} open={open}>
                <PopoverTrigger asChild>{renderPill()}</PopoverTrigger>
                <PopoverContent
                    align="start"
                    className="w-[360px] max-w-[360px]"
                    side="top"
                >
                    {listBody}
                </PopoverContent>
            </Popover>
            {confirmDialog}
        </div>
    );
};

export default AiActivityLog;
