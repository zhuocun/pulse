import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMatch } from "react-router-dom";

import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import type { TriageNudge } from "../../interfaces/agent";
import useAgent from "../../utils/hooks/useAgent";
import useAiChatDrawer from "../../utils/hooks/useAiChatDrawer";
import useAiEnabled from "../../utils/hooks/useAiEnabled";
import useAiProjectDisabled from "../../utils/hooks/useAiProjectDisabled";
import useBoardBriefDrawer from "../../utils/hooks/useBoardBriefDrawer";
import useCopilotDock from "../../utils/hooks/useCopilotDock";
import useMembersList from "../../utils/hooks/useMembersList";
import useReactQuery from "../../utils/hooks/useReactQuery";
import useTaskModal from "../../utils/hooks/useTaskModal";
import useTaskPanelNavigation from "../../utils/hooks/useTaskPanelNavigation";
import AiActivityLog from "../aiActivityLog";

import { CopilotDockBody, CopilotDockShell } from "./index";

/**
 * Persistent host for the CopilotDock (Phase 4 R-A M1).
 *
 * Lives inside `MainLayout` (above the routed `<Outlet />`) so the dock
 * itself never unmounts when the user switches projects. The previous
 * mount inside `BoardPage` tore the dock down on every
 * `/projects/p1/board` → `/projects/p2/board` navigation, which lost
 * chat history, the brief cache, the active tab, and the open/closed
 * flag — all the things the single-Copilot dock model relies on.
 *
 * Hidden / no-op when:
 *   - The `REACT_APP_COPILOT_DOCK_ENABLED` flag is off (rollback path —
 *     the BoardPage continues to render the legacy `<AiChatDrawer>` +
 *     `<BoardBriefDrawer>` overlays).
 *   - AI is globally disabled (env or per-user opt-out).
 *   - The current URL does not match a board route (no `projectId` to
 *     scope chat / brief context to).
 *   - The current project has AI opted out per-project.
 *
 * Phase 4 A8 — Drawer-lift architecture:
 *   - The `<CopilotDockShell>` (the AntD Drawer + chrome) is owned by
 *     this host and stays mounted across projectId changes — AntD does
 *     NOT animate a close/open transition because the Drawer's `open`
 *     prop never flips false during the navigation.
 *   - The project-scoped body (`<ProjectScopedDockBody key={projectId}>`)
 *     is rendered AS A CHILD of the shell. The keyed remount tears down
 *     per-project state (chat hook's `messages` buffer, the triage
 *     agent's threadId + nudges, the brief cache) so cross-project
 *     leaks (#1, #3, #7) stay fixed — see the original `key={projectId}`
 *     placement history below.
 *
 * Inputs flow:
 *   - `projectId` from `useMatch("/projects/:projectId/board/*")` so the
 *     dock stays alive across the `BoardRouteShell` task-overlay child
 *     route too. Switching projects re-derives every input on the next
 *     render without unmounting the dock.
 *   - `currentProject` / `board` / `tasks` from `useReactQuery` using the
 *     SAME query keys `BoardPage` uses (`["projects", { projectId }]`,
 *     `["boards", { projectId }]`, `["tasks", { projectId }]`). React
 *     Query dedupes the concurrent calls onto a single fetch, so the
 *     dock host shares the BoardPage's in-flight queries when both are
 *     mounted.
 *   - `members` from `useMembersList()` (global cached list).
 *
 * Legacy-callsite bridge:
 *   - The existing `useAiChatDrawer` / `useBoardBriefDrawer` Redux flags
 *     stay live. A sync effect in `BridgeLegacyOverlayFlags` flips the
 *     dock state when either flag opens — that's how
 *     `pages/copilotLanding.tsx`'s `openChatDrawer()`, the CopilotMenu
 *     in `board.tsx`, the welcome banner CTA, and the command-palette
 *     `boardCopilot:openChat` event keep working unchanged.
 */

interface ProjectScopedDockBodyProps {
    projectId: string;
}

const ProjectScopedDockBody: React.FC<ProjectScopedDockBodyProps> = ({
    projectId
}) => {
    const { activeTab, open, pendingPrompt, setActiveTab, clearInitialPrompt } =
        useCopilotDock();

    const { data: currentProject } = useReactQuery<IProject>(
        "projects",
        { projectId },
        undefined,
        undefined,
        undefined,
        Boolean(projectId)
    );
    const { data: board } = useReactQuery<IColumn[]>(
        "boards",
        { projectId },
        undefined,
        undefined,
        undefined,
        Boolean(projectId)
    );
    const { data: tasks } = useReactQuery<ITask[]>(
        "tasks",
        { projectId },
        undefined,
        undefined,
        undefined,
        Boolean(projectId) && Boolean(board)
    );
    const { data: members } = useMembersList();

    const { startEditing: openTaskModal } = useTaskModal();
    const { openTask: openTaskPanel } = useTaskPanelNavigation();

    /*
     * Background triage-agent mount (mirrors `pages/board.tsx`). The
     * agent is always called to keep hook ordering stable; the
     * effect below decides whether to start it. Behaviour parity with
     * the original board-page wiring:
     *   - chat must be the active surface (dock open on chat tab)
     *   - AI must be on for this project
     *   - remote backend must be available (`!aiUseLocalEngine`)
     *   - the project hasn't been triaged this app session yet
     */
    const triageAgent = useAgent("triage-agent", {
        projectId,
        feToolContext: { projectId }
    });
    const startTriageAgent = triageAgent.start;
    const dismissTriageNudge = triageAgent.dismissNudge;
    const triagedProjectsRef = useRef<Set<string>>(new Set());

    const chatTabActive = open && activeTab === "chat";
    useEffect(() => {
        if (!chatTabActive) return;
        if (!projectId) return;
        if (environment.aiUseLocalEngine) return;
        if (triagedProjectsRef.current.has(projectId)) return;

        triagedProjectsRef.current.add(projectId);
        try {
            void startTriageAgent({
                messages: [
                    {
                        role: "user",
                        content: microcopy.ai.runBoardTriagePrompt
                    }
                ]
            });
        } catch {
            // AgentForbiddenError (per-project AI opt-out) — fail silently;
            // surfaced via triageAgent.error if needed.
        }
    }, [chatTabActive, projectId, startTriageAgent]);

    const visibleTasks = useMemo(() => tasks ?? [], [tasks]);

    /*
     * Triage-nudge primary CTA. Mirrors the board-page handler so a
     * nudge opens the underlying task through whichever surface is
     * enabled by the task-panel routing flag. Resolves the first
     * `target_id` against the in-cache task list and no-ops when the
     * id is a column/member ref (e.g. `wip_overflow`).
     */
    const handleTriageNudgeAction = useCallback(
        (nudge: TriageNudge) => {
            const taskId = nudge.target_ids.find((id) =>
                visibleTasks.some((t) => t._id === id)
            );
            if (!taskId) return;
            if (environment.taskPanelRouted) openTaskPanel(taskId, projectId);
            else openTaskModal(taskId);
        },
        [openTaskModal, openTaskPanel, projectId, visibleTasks]
    );

    const handleTriageNudgeDismiss = useCallback(
        (nudge: TriageNudge) => {
            dismissTriageNudge(nudge.nudge_id);
        },
        [dismissTriageNudge]
    );

    const handleTabChange = useCallback(
        (tab: "chat" | "brief") => {
            setActiveTab(tab);
        },
        [setActiveTab]
    );

    return (
        <CopilotDockBody
            activeTab={activeTab}
            columns={board ?? []}
            footerSlot={<AiActivityLog />}
            initialPrompt={pendingPrompt ?? undefined}
            knownProjectIds={[projectId]}
            members={members ?? []}
            onActionNudge={
                !environment.aiUseLocalEngine
                    ? handleTriageNudgeAction
                    : undefined
            }
            onDismissNudge={
                !environment.aiUseLocalEngine
                    ? handleTriageNudgeDismiss
                    : undefined
            }
            onInitialPromptConsumed={clearInitialPrompt}
            onTabChange={handleTabChange}
            open={open}
            pendingNudges={
                !environment.aiUseLocalEngine ? triageAgent.nudges : undefined
            }
            project={currentProject ?? null}
            tasks={visibleTasks}
        />
    );
};

/**
 * Bridge: keep the legacy `chatDrawer.open` / `boardBriefOpen` Redux
 * flags wired to the dock state so existing callsites continue to work
 * unchanged. The hooks themselves are not flag-gated and dispatching
 * `closeChatDrawer` / `closeBoardBrief` from `ProjectScopedDockBody` will
 * fan back through here without an infinite loop because each
 * `useEffect` only fires when its watched value transitions.
 *
 * Lifted out of `ProjectScopedDockBody` so the bridge keeps running even
 * when there is no `projectId` in the URL — a `copilotLanding.tsx`
 * → `/projects` flow dispatches `openChatDrawer()` while the user is
 * still on the project list; the dock is hidden but the dock state
 * snapshot must already reflect "open + chat tab" by the time the user
 * picks a board and the URL acquires a `projectId`.
 */
const BridgeLegacyOverlayFlags: React.FC = () => {
    const {
        open: chatOpen,
        pendingPrompt: chatInitialPrompt,
        openDrawer: openChatDrawer
    } = useAiChatDrawer();
    const { open: briefOpen } = useBoardBriefDrawer();
    const { openDock } = useCopilotDock();

    const prevChatOpenRef = useRef(false);
    const prevBriefOpenRef = useRef(false);
    const prevChatPromptRef = useRef<string | null>(null);

    /*
     * R-A M1 Issue #2: under the dock flag, both `BoardPage` and
     * `ProjectPage` gate off their `boardCopilot:openChat` listeners
     * so the on-board palette → AI handoff doesn't trigger duplicate
     * dispatches. The host owns the listener instead — it always
     * runs (even when `projectId` is null) so palette submissions
     * from any route reach the dock, mirroring what `BoardPage`'s
     * listener did before the migration.
     */
    useEffect(() => {
        const onOpenChat = (event: Event) => {
            const detail = (event as CustomEvent<{ prompt?: string }>).detail;
            openChatDrawer(detail?.prompt);
        };
        window.addEventListener("boardCopilot:openChat", onOpenChat);
        return () =>
            window.removeEventListener("boardCopilot:openChat", onOpenChat);
    }, [openChatDrawer]);

    /*
     * Watch transitions, not absolute values: `chatOpen=true` triggers
     * `openDock({ tab: "chat" })` on the false→true edge so the bridge
     * does not fight a user-initiated tab switch (the user clicks Brief
     * while the legacy flag is still set true; the dock must respect
     * the user's tab choice and not snap back to chat).
     *
     * Prompt updates are forwarded EVEN when chatOpen stays true. The
     * dock-open path is otherwise lossy (Issue #5): a second palette
     * submission while the dock is already open would never reach the
     * dock state because `chatOpen` did not transition false→true. We
     * diff the prompt explicitly so the new prompt is dispatched
     * without regressing the no-loop guarantee — the close path clears
     * the prompt back to null, so a follow-up open with prompt = new
     * lands diff null→new, which is the desired behavior.
     */
    useEffect(() => {
        const prevOpen = prevChatOpenRef.current;
        const prevPrompt = prevChatPromptRef.current;
        prevChatOpenRef.current = chatOpen;
        prevChatPromptRef.current = chatInitialPrompt ?? null;
        if (!chatOpen) return;
        const openedNow = !prevOpen;
        const promptChanged =
            (chatInitialPrompt ?? null) !== prevPrompt &&
            chatInitialPrompt !== undefined &&
            chatInitialPrompt !== null;
        if (!openedNow && !promptChanged) return;
        openDock({
            tab: "chat",
            pendingPrompt: chatInitialPrompt ?? undefined
        });
    }, [chatOpen, chatInitialPrompt, openDock]);

    useEffect(() => {
        const prevOpen = prevBriefOpenRef.current;
        prevBriefOpenRef.current = briefOpen;
        if (!briefOpen || prevOpen) return;
        openDock({ tab: "brief" });
    }, [briefOpen, openDock]);

    return null;
};

/**
 * Phase 4 A8 — inner host wrapper. Lives below the env-flag gate so the
 * Redux + agent hooks here NEVER run while the dock flag is off. Tests
 * that render `<MainLayout/>` without a Redux Provider (and the flag
 * off) used to crash on the host's bridge hooks when those were lifted
 * to the outer component, so we keep the gate-first / hooks-second
 * shape and move the unified close-handler into this inner shell.
 */
const CopilotDockHostInner: React.FC<{
    projectId: string | null;
    boardAiOn: boolean;
}> = ({ projectId, boardAiOn }) => {
    const { open, closeDock } = useCopilotDock();
    const { closeDrawer: closeChatDrawer } = useAiChatDrawer();
    const { closeDrawer: closeBriefDrawer } = useBoardBriefDrawer();

    /*
     * Single close handler: keep the legacy chat/brief Redux flags in
     * sync so the existing trigger callsites (CopilotMenu, welcome
     * banner CTA, copilot-landing page) flip back to "closed" too.
     * Without this, `useAiChatDrawer().open` would remain stuck `true`
     * after the user dismisses the dock, and a stale flag would
     * silently reopen the dock through the bridge on the next reroute.
     *
     * Lifted to the host (was on `ProjectScopedDock`) under the Drawer-
     * lift refactor — the shell needs the close handler and the shell
     * lives outside the keyed body. The shell mounts unconditionally
     * once the flag is on, so the handlers are stable across project
     * switches.
     */
    const handleClose = useCallback(() => {
        closeDock();
        closeChatDrawer();
        closeBriefDrawer();
    }, [closeBriefDrawer, closeChatDrawer, closeDock]);

    /*
     * Drawer-lift (Phase 4 A8 — Lane A caveat fix): the
     * `<CopilotDockShell>` owns the AntD Drawer mount and stays
     * mounted continuously while the dock flag is on, so a project
     * switch with the dock open does NOT animate a Drawer close/open
     * transition. `<ProjectScopedDockBody key={projectId}>` is the
     * body slot inside the shell — the `key={projectId}` remount tears
     * down per-project state (chat hook messages, triage agent thread,
     * brief cache) exactly like the previous `key={projectId}` on the
     * outer subtree did, resolving cross-project leaks (#1, #3, #7).
     */
    return (
        <>
            <BridgeLegacyOverlayFlags />
            {projectId && boardAiOn ? (
                <CopilotDockShell onClose={handleClose} open={open}>
                    <ProjectScopedDockBody
                        key={projectId}
                        projectId={projectId}
                    />
                </CopilotDockShell>
            ) : null}
        </>
    );
};

/**
 * Flag-gated middle layer that owns the router + AI-enabled gates so
 * the inner host (`CopilotDockHostInner`) only sees the resolved
 * `projectId` / `boardAiOn` pair. Keeps `useMatch` / `useAiEnabled`
 * out of the inner component so its hook surface stays focused on the
 * dock-state contract.
 */
const CopilotDockHostFlagged: React.FC = () => {
    const { enabled: aiEnabled } = useAiEnabled();
    const match = useMatch("/projects/:projectId/board/*");
    const projectId = match?.params.projectId ?? null;
    const { disabled: aiDisabledForProject } = useAiProjectDisabled(projectId);
    const boardAiOn = aiEnabled && !aiDisabledForProject;

    return <CopilotDockHostInner boardAiOn={boardAiOn} projectId={projectId} />;
};

const CopilotDockHost: React.FC = () => {
    // Flag gate is the hard rollback: when off, the BoardPage still
    // owns the legacy drawer mounts and we do nothing here at all.
    // Hooks below depend on Redux + react-router context — running them
    // when the flag is off would break tests that render `MainLayout`
    // without those providers (the host is supposed to be a no-op).
    if (!environment.copilotDockEnabled) return null;
    return <CopilotDockHostFlagged />;
};

export default CopilotDockHost;
