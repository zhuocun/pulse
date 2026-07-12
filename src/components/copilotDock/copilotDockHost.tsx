import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMatch } from "react-router-dom";

import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import type { TriageNudge } from "../../interfaces/agent";
import { useRemoteAiConsent } from "../../utils/ai/remoteAiConsent";
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
 *   - The `REACT_APP_COPILOT_DOCK_ENABLED` flag is off (kill-switch —
 *     no unified dock mounts; set the flag to restore the Copilot surface).
 *   - AI is globally disabled (env or per-user opt-out).
 *   - The current URL does not match a board route (no `projectId` to
 *     scope chat / brief context to).
 *   - The current project has AI opted out per-project.
 *
 * Phase 4 A8 — shell-lift architecture:
 *   - The `<CopilotDockShell>` (the Sheet surface + chrome) is owned by
 *     this host and stays mounted across projectId changes — it does
 *     NOT animate a close/open transition because the Sheet's `open`
 *     prop never flips false during the navigation.
 *   - The project-scoped body (`<ProjectScopedDockBody key={projectId}>`)
 *     is rendered AS A CHILD of the shell. The keyed remount tears down
 *     per-project state (chat hook's `messages` buffer, the triage
 *     agent's threadId + nudges, the brief cache, the inbox-nudge list)
 *     so cross-project leaks (#1, #3, #7) stay fixed — see the original
 *     `key={projectId}` placement history below.
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
    const {
        activeTab,
        open,
        pendingPrompt,
        setActiveTab,
        clearInitialPrompt,
        setInboxUnread
    } = useCopilotDock();

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
     *     OR the inbox tab must be active (so the inbox surface gets
     *     the same triage run even when the user opens it directly)
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
    const remoteAiConsentGranted = useRemoteAiConsent(environment.aiBaseUrl);
    const triagedProjectsRef = useRef<Set<string>>(new Set());

    const triageTabActive =
        open && (activeTab === "chat" || activeTab === "inbox");
    useEffect(() => {
        if (!triageTabActive) return;
        if (!projectId) return;
        if (environment.aiUseLocalEngine) return;
        if (!remoteAiConsentGranted) return;
        if (triagedProjectsRef.current.has(projectId)) return;

        triagedProjectsRef.current.add(projectId);
        try {
            void startTriageAgent(
                {
                    messages: [
                        {
                            role: "user",
                            content: microcopy.ai.runBoardTriagePrompt
                        }
                    ]
                },
                { autonomy: "suggest" }
            );
        } catch {
            // AgentForbiddenError (per-project AI opt-out) — fail silently;
            // surfaced via triageAgent.error if needed.
        }
    }, [triageTabActive, projectId, remoteAiConsentGranted, startTriageAgent]);

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
        (tab: "chat" | "brief" | "inbox") => {
            setActiveTab(tab);
        },
        [setActiveTab]
    );

    /*
     * Phase 4 A8 — projection sync for the launcher badge. The Inbox-
     * read path zeros the count via `markInboxRead`; this effect bumps
     * it back up ONLY when the agent's nudge buffer actually grows
     * past the last-seen high-water mark, so the user's "I read it"
     * gesture isn't immediately undone by a re-fire on the next
     * render. Without the high-water gate, leaving the Inbox tab
     * (`inboxSurfaceVisible` flips false) re-runs this effect, sees
     * `nudgeCount = N` (unchanged), and dispatches `setInboxUnread(N)`
     * — restoring the badge the user just dismissed.
     *
     * `prevCountRef` tracks the latest count the projection accepted
     * (initialized to 0 to match the slice's initial state):
     *   - If the surface is visible, we keep the ref in sync with the
     *     current count but do not dispatch — the read transition
     *     owns the count while the user is looking at the Inbox.
     *   - If the surface is hidden and the count went UP, we dispatch
     *     the new count (a fresh nudge arrived while the user wasn't
     *     looking) and advance the ref.
     *   - If the count went DOWN or stayed flat while hidden, we just
     *     advance the ref (e.g. a nudge expired or was dismissed) —
     *     the Redux value is whatever the read transition left
     *     (typically 0), so the badge stays quiet.
     *
     * The local-engine guard short-circuits before any ref movement
     * so the local-engine-only test harness behaves identically to
     * production (the original effect had the same guard).
     */
    const inboxSurfaceVisible = open && activeTab === "inbox";
    const nudgeCount = triageAgent.nudges.length;
    const prevNudgeCountRef = useRef(0);
    useEffect(() => {
        if (environment.aiUseLocalEngine) return;
        if (inboxSurfaceVisible) {
            prevNudgeCountRef.current = nudgeCount;
            return;
        }
        if (nudgeCount > prevNudgeCountRef.current) {
            setInboxUnread(nudgeCount);
        }
        prevNudgeCountRef.current = nudgeCount;
    }, [inboxSurfaceVisible, nudgeCount, setInboxUnread]);

    /*
     * Phase 4 A8 — inbox tab data source. The triage agent's `nudges`
     * array (which wraps `useNudgeInbox` internally) is the canonical
     * source — passed in unconditionally so the inbox surface shows
     * whatever the agent has produced. The `pendingNudges` chat-tab
     * path stays gated on `!aiUseLocalEngine` (legacy contract with
     * the in-chat NudgeCard list) so we don't change the chat-rail
     * rendering, but the inbox surface deliberately treats the empty
     * array as "nothing to triage" instead of hiding the tab — local
     * engine users see the same inbox shape, just always empty until
     * the remote backend wires in.
     */
    return (
        <CopilotDockBody
            activeTab={activeTab}
            columns={board ?? []}
            footerSlot={<AiActivityLog />}
            inboxNudges={triageAgent.nudges}
            initialPrompt={pendingPrompt ?? undefined}
            knownProjectIds={[projectId]}
            members={members ?? []}
            onActionInboxNudge={handleTriageNudgeAction}
            onActionNudge={
                !environment.aiUseLocalEngine
                    ? handleTriageNudgeAction
                    : undefined
            }
            onDismissInboxNudge={handleTriageNudgeDismiss}
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
 * shape and move the unified close-handler / inbox-read effect into
 * this inner shell.
 */
const CopilotDockHostInner: React.FC<{
    projectId: string | null;
    boardAiOn: boolean;
}> = ({ projectId, boardAiOn }) => {
    const { activeTab, open, closeDock, markInboxRead } = useCopilotDock();
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
     * Phase 4 A8 — mark the Inbox as "read" when the user opens it.
     * A single transition (false → true on `inboxSurfaceVisible`)
     * stamps the timestamp once per open; subsequent re-renders while
     * the surface stays open are no-ops. Without the ref gate, every
     * useAgent stream-update re-render would re-stamp the timestamp,
     * which would correctly leave unreadCount = 0 but would burn
     * dispatches unnecessarily.
     */
    const inboxSurfaceVisible = open && activeTab === "inbox";
    const prevInboxVisibleRef = useRef(false);
    useEffect(() => {
        const wasVisible = prevInboxVisibleRef.current;
        prevInboxVisibleRef.current = inboxSurfaceVisible;
        if (!inboxSurfaceVisible || wasVisible) return;
        markInboxRead();
    }, [inboxSurfaceVisible, markInboxRead]);

    /*
     * Shell-lift (Phase 4 A8 — Lane A caveat fix): the
     * `<CopilotDockShell>` owns the Sheet surface mount and stays
     * mounted continuously while the dock flag is on, so a project
     * switch with the dock open does NOT animate a surface close/open
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
    // Flag gate is the kill-switch: when off, no unified dock mounts.
    // Hooks below depend on Redux + react-router context — running them
    // when the flag is off would break tests that render `MainLayout`
    // without those providers (the host is supposed to be a no-op).
    if (!environment.copilotDockEnabled) return null;
    return <CopilotDockHostFlagged />;
};

export default CopilotDockHost;
