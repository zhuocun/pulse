import { useCallback } from "react";
import { useNavigate, useParams } from "react-router";

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
 */
const useTaskPanelNavigation = () => {
    const navigate = useNavigate();
    const { projectId: currentProjectId } = useParams<{ projectId: string }>();

    const openTask = useCallback(
        (taskId: string, projectId?: string) => {
            const pid = projectId ?? currentProjectId;
            if (!pid || !taskId) return;
            navigate(`/projects/${pid}/board/task/${taskId}`);
        },
        [currentProjectId, navigate]
    );

    const closeTask = useCallback(
        (projectId?: string) => {
            const pid = projectId ?? currentProjectId;
            if (!pid) {
                // Fall back to a normal "back one step" if we can't
                // resolve the board URL — better than navigating to
                // a non-existent route.
                navigate(-1);
                return;
            }
            navigate(`/projects/${pid}/board`);
        },
        [currentProjectId, navigate]
    );

    return { openTask, closeTask };
};

export default useTaskPanelNavigation;
