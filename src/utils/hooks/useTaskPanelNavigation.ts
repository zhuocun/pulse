import { useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router";

import useReactQuery from "./useReactQuery";

/**
 * Phase 3 A2 — navigation hook for the routed task panel.
 *
 * Sibling to `useTaskModal` so the two surfaces can coexist behind the
 * `environment.taskPanelRouted` flag. When the flag is OFF, callsites
 * keep using `useTaskModal`; when ON, the same callsites can swap in
 * this hook to navigate to the new route at
 * `/projects/:projectId/board/task/:taskId` instead of dispatching the
 * Redux overlay action.
 *
 * Doesn't touch Redux, doesn't read the flag itself — the flag check
 * lives at the callsite so the test surface is one tier higher and
 * easier to assert on. Returns a stable `openTask(taskId)` and
 * `closeTask()` pair so callers can pass them through `useCallback`
 * dependencies without retriggering renders.
 *
 * `projectId` is read from the current URL via `useParams`. If the
 * caller is rendered outside any `:projectId` route (rare; only
 * happens in the `/projects` list page), the hook will refuse to
 * navigate — there's no board context to land in. Callers that need
 * to navigate with an explicit projectId can pass one to `openTask`
 * as the second arg.
 *
 * `goToNext` / `goToPrev` (Phase 3 A2 — swipe-between-tasks): compute
 * the sibling task IDs from the current board's column-task order
 * (columns by `index`, then tasks within each column by `index`) and
 * navigate to them. The hook reads the same cache keys as `BoardPage`
 * (`["boards", { projectId }]` and `["tasks", { projectId }]`) so the
 * sibling list is in-sync without props threading — when a deep-link
 * visitor opens the panel directly, the query fetches and the next/
 * prev IDs resolve once data arrives. Returns `null` from the
 * accessors when no sibling exists (first/last/only task), and a
 * no-op `goToNext`/`goToPrev` when called outside `:taskId`.
 */
const useTaskPanelNavigation = () => {
    const navigate = useNavigate();
    const { projectId: currentProjectId, taskId: currentTaskId } = useParams<{
        projectId: string;
        taskId: string;
    }>();

    // Subscribe to the same cache keys BoardPage uses; when neither
    // exists yet (no opened board), `data` is undefined and the
    // sibling computation bails. `enabled` flips off when projectId
    // is unresolvable so unrelated routes (e.g. `/projects`) don't
    // fire a phantom request.
    const queryEnabled = Boolean(currentProjectId);
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

    /*
     * Ordered task IDs across the whole board: columns sorted by
     * `index`, then tasks within each column sorted by `index`. This
     * mirrors the visual top-to-bottom-left-to-right reading order
     * the user sees on the kanban so a "next" swipe moves to the next
     * card they would naturally jump to. Computed off the live cache
     * snapshot so a reorder/move-task mutation flows into the sibling
     * pointers on the next render.
     */
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

    const openTask = useCallback(
        (taskId: string, projectId?: string) => {
            const pid = projectId ?? currentProjectId;
            if (!pid || !taskId) return;
            navigate(`/projects/${pid}/board/task/${taskId}`, {
                viewTransition: true
            });
        },
        [currentProjectId, navigate]
    );

    const closeTask = useCallback(
        (projectId?: string) => {
            const pid = projectId ?? currentProjectId;
            if (!pid) {
                // Deep-link visitors have one history entry, so
                // `navigate(-1)` is a no-op or exits the app. Land
                // on the project list as a safe default (B-M3).
                navigate("/projects", { viewTransition: true });
                return;
            }
            navigate(`/projects/${pid}/board`, { viewTransition: true });
        },
        [currentProjectId, navigate]
    );

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

    return {
        openTask,
        closeTask,
        goToNext,
        goToPrev,
        nextTaskId,
        prevTaskId
    };
};

export default useTaskPanelNavigation;
