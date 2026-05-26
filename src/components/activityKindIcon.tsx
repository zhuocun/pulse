import {
    FolderOpenOutlined,
    ProjectOutlined,
    RobotOutlined,
    UnorderedListOutlined
} from "@ant-design/icons";
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
    task: <UnorderedListOutlined aria-hidden />,
    column: <FolderOpenOutlined aria-hidden />,
    project: <ProjectOutlined aria-hidden />,
    ai: <RobotOutlined aria-hidden />
};
