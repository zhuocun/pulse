import { ChevronDown, FileText, MessageSquare } from "lucide-react";
import React from "react";

import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";

import { microcopy } from "../../constants/microcopy";
import AiSparkleIcon from "../aiSparkleIcon";

interface CopilotMenuProps {
    /** Opens the AI chat ("Ask") drawer — the primary-button action. */
    onAsk: () => void;
    /** Opens the board brief drawer. */
    onBrief: () => void;
    /** Disables Board Copilot for the current project. */
    onProjectOff: () => void;
    /** Unread Inbox-nudge count surfaced as a launcher badge. */
    inboxUnread: number;
    /** Pre-formatted accessible label for the unread badge (omit when 0). */
    unreadAriaLabel?: string;
}

/**
 * Consolidated Board Copilot launcher (ui-todo §1.2 item 7). Replaces the
 * separate Brief / Ask buttons with a single split control: the primary
 * button runs the most common action (open chat / Ask), and the trailing
 * caret opens a menu with Brief, Ask, and a "Project AI off" quick toggle.
 *
 * Accessible names are intentionally stable: the caret trigger keeps the
 * `boardCopilotMenu` label and the menu items keep the `Ask Copilot` /
 * `Board brief` strings the AI test suites assert against.
 *
 * The visible launcher label collapses to icon-only under a coarse pointer
 * (phone chrome) where the launcher lives inside the board's Liquid Glass
 * capsule and the text would push the four-segment toolbar past a 390 px
 * viewport. The button keeps an explicit `aria-label` so the accessible
 * name stays "Copilot" even when the text is hidden.
 */
const CopilotMenu: React.FC<CopilotMenuProps> = ({
    onAsk,
    onBrief,
    onProjectOff,
    inboxUnread,
    unreadAriaLabel
}) => (
    <div
        aria-label={unreadAriaLabel}
        className="relative inline-flex"
        data-testid="copilot-launcher-badge"
    >
        <div className="inline-flex">
            <Button
                aria-label={microcopy.labels.copilotShort}
                className="rounded-r-none"
                onClick={onAsk}
                variant="default"
            >
                <AiSparkleIcon aria-hidden />
                <span className="coarse:hidden">
                    {microcopy.labels.copilotShort}
                </span>
            </Button>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        aria-label={microcopy.a11y.boardCopilotMenu}
                        className="-ml-px rounded-l-none px-sm"
                        variant="default"
                    >
                        <ChevronDown aria-hidden />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={onBrief}>
                        <FileText aria-hidden />
                        {microcopy.board.copilotMenuBrief}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={onAsk}>
                        <MessageSquare aria-hidden />
                        {microcopy.board.copilotMenuAsk}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={onProjectOff}
                    >
                        {microcopy.board.copilotMenuProjectOff}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
        {inboxUnread > 0 ? (
            <span
                aria-hidden
                className="pointer-events-none absolute -right-xxs -top-xxs inline-flex min-w-4 items-center justify-center rounded-pill bg-destructive px-[4px] text-[10px] font-semibold leading-4 text-destructive-foreground"
            >
                {inboxUnread > 99 ? "99+" : inboxUnread}
            </span>
        ) : null}
    </div>
);

export default CopilotMenu;
