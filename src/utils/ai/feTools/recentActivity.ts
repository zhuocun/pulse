import type { FeTool } from "./types";

interface RecentActivityEntry {
    timestamp: number;
    kind: string;
    description: string;
}

/**
 * `fe.recentActivity` — last-24h log of optimistic updates. Phase A has no
 * dedicated activity slice yet, so this returns `{activity: []}`. A future
 * Phase E landing of the toast-based action history will populate this from
 * the Redux slice; the agent already understands an empty result as "no
 * recent activity".
 */
export const recentActivityTool: FeTool<
    {
        sinceMs?: number;
    } | void,
    { activity: RecentActivityEntry[] }
> = {
    name: "fe.recentActivity",
    description:
        "Return optimistic-update activity in the last 24h (empty until the action history slice lands).",
    run: () => {
        return { activity: [] };
    }
};
