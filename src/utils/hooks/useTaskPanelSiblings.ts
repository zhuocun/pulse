import { useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router";

import useReactQuery from "./useReactQuery";

/**
 * Phase 3 A2 — sibling task navigation for the routed task panel.
 *
 * Reads the same cache keys `BoardPage` uses (`["boards", { projectId }]`
 * and `["tasks", { projectId }]`) and derives `nextTaskId` / `prevTaskId`
 * from the visual reading order (columns by `index`, then tasks within
 * each column by `index`). `goToNext` / `goToPrev` navigate to those
 * siblings via the same `/projects/:projectId/board/task/:taskId`
 * route, so the panel's `useBlocker` dirty-guard intercepts swipes too.
 *
 * Split out from `useTaskPanelNavigation` so callers that just want to
 * open or close a task (command palette, AI assist, palette task
 * entries, etc.) don't pay for `useReactQuery` subscriptions to phantom
 * keys. Only `TaskDetailPanel` instantiates this hook, and only when
 * it's mounted (i.e. when a task is open), so the subscriptions are
 * always doing useful work.
 *
 * Returns `null` from the accessors when no sibling exists (first or
 * last task, only task on the board), and no-op `goToNext` /
 * `goToPrev` callbacks when called outside the `:taskId` route.
 */
const useTaskPanelSiblings = () => {
    const navigate = useNavigate();
    const { projectId: currentProjectId, taskId: currentTaskId } = useParams<{
        projectId: string;
        taskId: string;
    }>();

    // Only fire the cache subscriptions when a task is actually open.
    // Without a task, there's no sibling to compute — and the hook
    // might be instantiated as a side effect (e.g. via a HOC chain).
    const queryEnabled = Boolean(currentProjectId && currentTaskId);
    const { data: columns } = useReactQuery<IColumn[]>(
        "boards",
        { projectId: currentProjectId ?? "" },
        undefined,
        undefined,
        undefined,
        queryEnabled
    );
    const { data: tasks } = useReactQuery<ITask[]>(
        "tasks",
        { projectId: currentProjectId ?? "" },
        undefined,
        undefined,
        undefined,
        queryEnabled
    );

    const orderedTaskIds = useMemo<string[]>(() => {
        if (!columns?.length || !tasks?.length) return [];
        const columnIndex = new Map<string, number>();
        for (const c of columns) columnIndex.set(c._id, c.index);
        const grouped = new Map<string, ITask[]>();
        for (const t of tasks) {
            if (!columnIndex.has(t.columnId)) continue;
            const list = grouped.get(t.columnId);
            if (list) list.push(t);
            else grouped.set(t.columnId, [t]);
        }
        const sortedColumnIds = [...columnIndex.entries()]
            .sort((a, b) => a[1] - b[1])
            .map(([id]) => id);
        const ids: string[] = [];
        for (const cid of sortedColumnIds) {
            const list = grouped.get(cid);
            if (!list) continue;
            const sorted = [...list].sort((a, b) => a.index - b.index);
            for (const t of sorted) ids.push(t._id);
        }
        return ids;
    }, [columns, tasks]);

    const currentIndex = useMemo<number>(() => {
        if (!currentTaskId) return -1;
        return orderedTaskIds.indexOf(currentTaskId);
    }, [currentTaskId, orderedTaskIds]);

    const nextTaskId =
        currentIndex >= 0 && currentIndex < orderedTaskIds.length - 1
            ? orderedTaskIds[currentIndex + 1]
            : null;
    const prevTaskId =
        currentIndex > 0 ? orderedTaskIds[currentIndex - 1] : null;

    const goToNext = useCallback(() => {
        if (!currentProjectId || !nextTaskId) return;
        navigate(`/projects/${currentProjectId}/board/task/${nextTaskId}`, {
            viewTransition: true
        });
    }, [currentProjectId, navigate, nextTaskId]);

    const goToPrev = useCallback(() => {
        if (!currentProjectId || !prevTaskId) return;
        navigate(`/projects/${currentProjectId}/board/task/${prevTaskId}`, {
            viewTransition: true
        });
    }, [currentProjectId, navigate, prevTaskId]);

    return { goToNext, goToPrev, nextTaskId, prevTaskId };
};

export default useTaskPanelSiblings;
