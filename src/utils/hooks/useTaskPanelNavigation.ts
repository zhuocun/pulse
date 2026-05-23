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
 * Sibling navigation (`goToNext` / `goToPrev`) lives in the separate
 * `useTaskPanelSiblings` hook — only `TaskDetailPanel` itself needs
 * those, and they pull in React Query subscriptions that would
 * otherwise fire app-wide just because the command palette calls
 * `useTaskPanelNavigation` to get `openTask`.
 */
const useTaskPanelNavigation = () => {
    const navigate = useNavigate();
    const { projectId: currentProjectId } = useParams<{
        projectId: string;
    }>();

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

    return { openTask, closeTask };
};

export default useTaskPanelNavigation;
