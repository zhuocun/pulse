import { Drawer, Space, Tabs, Tag, Typography } from "antd";

import { microcopy } from "../../constants/microcopy";
import { fontWeight, space } from "../../theme/tokens";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import type { MutationProposal, TriageNudge } from "../../interfaces/agent";
import AiSparkleIcon from "../aiSparkleIcon";

import BriefTabBody from "./BriefTabBody";
import ChatTabBody from "./ChatTabBody";

export type CopilotDockTab = "chat" | "brief";

/**
 * Phase 4 A8 — body slot for the dock surface (tabs + active tab body).
 *
 * Lifted out of the Drawer shell so the host can keep the Drawer mount
 * stable across `projectId` changes (Lane A caveat fix): the dock body
 * carries `key={projectId}` to reset per-project state (chat hook, brief
 * cache, triage-agent thread), while the Drawer container stays mounted
 * continuously so AntD does NOT animate a close/open transition on
 * project switch.
 *
 * Used by:
 *   - `CopilotDockHost` (production) — wraps this in a host-owned Drawer
 *     and keys it on projectId so the body remounts cleanly per project.
 *   - `<CopilotDock>` below (legacy single-mount tests) — wraps it in
 *     its own Drawer so the public component contract stays unchanged
 *     for tests that compose the dock outside of `CopilotDockHost`.
 */
export interface CopilotDockBodyProps {
    /**
     * Whether the host Drawer is currently open. Mirrors the legacy
     * `dockOpen` semantics in `ChatTabBody`/`BriefTabBody`:
     *   - `open` flips false → bodies abort in-flight streams + clear
     *     transient state (R1-H1 / R1-H2).
     *   - `open` flips true → bodies re-establish focus / dispatch
     *     pending prompt / request the first brief.
     */
    open: boolean;
    activeTab: CopilotDockTab;
    onTabChange: (tab: CopilotDockTab) => void;
    project: IProject | null;
    columns: IColumn[];
    tasks: ITask[];
    members: IMember[];
    knownProjectIds: string[];
    initialPrompt?: string;
    onInitialPromptConsumed?: () => void;
    pendingProposal?: MutationProposal;
    pendingNudges?: TriageNudge[];
    onAcceptProposal?: (proposal: MutationProposal) => void;
    onRejectProposal?: (proposal: MutationProposal) => void;
    onUndoProposal?: (proposal: MutationProposal) => void;
    onActionNudge?: (nudge: TriageNudge) => void;
    onDismissNudge?: (nudge: TriageNudge) => void;
    /**
     * Optional slot rendered at the bottom of the dock body, below the
     * active tab pane. Phase 4 A8 uses this to mount the AI activity
     * ledger pill so it stays visible across both chat + brief tabs
     * without intruding on the input composer (which lives inside the
     * chat tab's body). Pass `null`/omit to skip the slot — the dock
     * still renders flush against its footer.
     */
    footerSlot?: React.ReactNode;
}

export const CopilotDockBody: React.FC<CopilotDockBodyProps> = ({
    open,
    activeTab,
    onTabChange,
    project,
    columns,
    tasks,
    members,
    knownProjectIds,
    initialPrompt,
    onInitialPromptConsumed,
    pendingProposal,
    pendingNudges,
    onAcceptProposal,
    onRejectProposal,
    onUndoProposal,
    onActionNudge,
    onDismissNudge,
    footerSlot
}) => {
    // Both bodies stay mounted across tab switches (`destroyOnHidden={false}`
    // below). `dockOpen` drives close-side teardown ONLY; `tabActive`
    // drives focus/dispatch/initial requests/etc. This split is the
    // R1-H1 / R1-H2 fix — passing a single `open` collapsed to `dockOpen
    // && activeTab === "<self>"` aborted in-flight work on every tab
    // switch.
    const tabItems = [
        {
            key: "chat",
            label: microcopy.copilotDock.tabChat,
            children: (
                <ChatTabBody
                    columns={columns}
                    dockOpen={open}
                    initialPrompt={initialPrompt}
                    knownProjectIds={knownProjectIds}
                    members={members}
                    onAcceptProposal={onAcceptProposal}
                    onActionNudge={onActionNudge}
                    onDismissNudge={onDismissNudge}
                    onInitialPromptConsumed={onInitialPromptConsumed}
                    onRejectProposal={onRejectProposal}
                    onUndoProposal={onUndoProposal}
                    pendingNudges={pendingNudges}
                    pendingProposal={pendingProposal}
                    project={project}
                    tabActive={activeTab === "chat"}
                    tasks={tasks}
                />
            )
        },
        {
            key: "brief",
            label: microcopy.copilotDock.tabBrief,
            children: (
                <BriefTabBody
                    columns={columns}
                    dockOpen={open}
                    members={members}
                    project={project ?? undefined}
                    tabActive={activeTab === "brief"}
                    tasks={tasks}
                />
            )
        }
    ];

    return (
        <>
            <Tabs
                activeKey={activeTab}
                aria-label={microcopy.copilotDock.tabListLabel}
                data-testid="copilot-dock-tabs"
                /*
                 * `destroyOnHidden={false}` keeps inactive tabs mounted
                 * so chat history + the brief cache survive a tab switch
                 * — both bodies own their own state and teardown via
                 * their `dockOpen` prop. Replaces the deprecated
                 * `destroyInactiveTabPane` (AntD 5.18+).
                 */
                destroyOnHidden={false}
                items={tabItems}
                onChange={(key) => onTabChange(key as CopilotDockTab)}
                size="small"
                style={{
                    display: "flex",
                    flex: "1 1 auto",
                    flexDirection: "column",
                    minHeight: 0
                }}
            />
            {footerSlot ? (
                <div
                    data-testid="copilot-dock-footer-slot"
                    style={{
                        display: "flex",
                        flexShrink: 0,
                        marginTop: space.xs
                    }}
                >
                    {footerSlot}
                </div>
            ) : null}
        </>
    );
};

/**
 * Phase 4 A8 — Drawer shell separated from the body so the host can
 * keep it mounted across `projectId` changes. Owns the placement,
 * title chrome, accessible name, and close handling. Renders its
 * children inside the Drawer body — those children are the project-
 * scoped tab content keyed on `projectId` in the host.
 */
export interface CopilotDockShellProps {
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
}

export const CopilotDockShell: React.FC<CopilotDockShellProps> = ({
    open,
    onClose,
    children
}) => {
    const isPhone = useIsPhoneChrome();

    // Phase 3 A1 — phone gets a full-height bottom sheet, desktop/tablet
    // gets the 420 px right shelf the doc specifies (§A1 lines 153-166).
    // `size` accepts a number/percentage for finer control than the
    // "default" | "large" literals.
    const drawerProps = isPhone
        ? { placement: "bottom" as const, size: "100%" as const }
        : { placement: "right" as const, size: 420 };

    return (
        <Drawer
            {...drawerProps}
            // The dialog's accessible name is the visible "Copilot" title.
            // Linking via `aria-labelledby` (the actual heading element)
            // is stronger than `aria-label` because it stays in sync with
            // any future copy change and announces the same string the
            // user sees (R1-M3).
            aria-labelledby="copilot-dock-title"
            data-placement={drawerProps.placement}
            data-testid="copilot-dock"
            onClose={onClose}
            open={open}
            styles={{
                body: {
                    background:
                        "radial-gradient(60% 30% at 50% 0%, var(--aurora-blob-faint) 0%, transparent 70%), transparent",
                    display: "flex",
                    flexDirection: "column",
                    paddingBottom: `max(${space.md}px, env(keyboard-inset-height, 0px), env(safe-area-inset-bottom))`,
                    paddingInlineEnd: `max(${space.lg}px, env(safe-area-inset-right))`,
                    paddingInlineStart: `max(${space.lg}px, env(safe-area-inset-left))`
                }
            }}
            title={
                <Space align="center" size={space.xs}>
                    <AiSparkleIcon aria-hidden />
                    <Typography.Title
                        id="copilot-dock-title"
                        level={4}
                        style={{
                            fontSize: "inherit",
                            fontWeight: fontWeight.semibold,
                            margin: 0
                        }}
                    >
                        {microcopy.copilotDock.title}
                    </Typography.Title>
                    <Tag color="purple">{microcopy.a11y.aiBadge}</Tag>
                </Space>
            }
        >
            {children}
        </Drawer>
    );
};

/**
 * Self-contained dock composition: `<CopilotDockShell>` + an inline
 * `<CopilotDockBody>`. Kept for compositional tests (`index.test.tsx`,
 * `index.agent.test.tsx`) that don't go through `CopilotDockHost`'s
 * lifted Drawer architecture. Production callers use `CopilotDockHost`,
 * which assembles the shell + body itself so the Drawer mount can stay
 * stable across projectId switches (Lane A caveat fix).
 */
export interface CopilotDockProps extends CopilotDockBodyProps {
    onClose: () => void;
}

const CopilotDock: React.FC<CopilotDockProps> = ({ onClose, ...bodyProps }) => (
    <CopilotDockShell onClose={onClose} open={bodyProps.open}>
        <CopilotDockBody {...bodyProps} />
    </CopilotDockShell>
);

export default CopilotDock;
