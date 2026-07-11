import { Bot, FolderKanban, FolderOpen, List } from "lucide-react";
import React from "react";

import type { ActivityEvent } from "../utils/hooks/useActivityFeed";

/**
 * Per-kind leading glyph for an activity-feed event row. Shared by the
 * activity-feed drawer and the standalone Inbox page so the two surfaces
 * present the same event taxonomy (task / column / project / AI) with a
 * single source of truth. Each glyph is `aria-hidden` because the row's
 * summary text carries the accessible description.
 */
export const KIND_ICON: Record<ActivityEvent["kind"], React.ReactNode> = {
    task: <List aria-hidden />,
    column: <FolderOpen aria-hidden />,
    project: <FolderKanban aria-hidden />,
    ai: <Bot aria-hidden />
};
