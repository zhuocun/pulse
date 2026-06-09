import styled from "@emotion/styled";
import { Space, Segmented, Tabs, Typography } from "antd";

import { microcopy } from "../../constants/microcopy";
import { fontWeight, space } from "../../theme/tokens";
import type { MutationProposal, TriageNudge } from "../../interfaces/agent";
import AiSparkleIcon from "../aiSparkleIcon";
import GlassPanel from "../glassPanel";
import Sheet from "../sheet";

import BriefTabBody from "./BriefTabBody";
import ChatTabBody from "./ChatTabBody";
import InboxTabBody, { type InboxTabBodyProps } from "./InboxTabBody";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";

export type CopilotDockTab = "chat" | "brief" | "inbox";

const DockTabPane = styled.div<{ $active: boolean }>`
    display: ${({ $active }) => ($active ? "flex" : "none")};
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
`;

const DockTabs = styled(Tabs)`
    && {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        min-height: 0;
    }

    && .ant-tabs-content-holder,
    && .ant-tabs-content {
        display: flex;
        flex: 1 1 auto;
        min-height: 0;
    }

    && .ant-tabs-tabpane-active {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        min-height: 0;
    }
`;

/**
 * Phase 4 A8 — body slot for the dock surface (tabs + active tab body).
 *
 * Lifted out of the Drawer shell so the host can keep the Drawer mount
 * stable across `projectId` changes (Lane A caveat fix): the dock body
 * carries `key={projectId}` to reset per-project state (chat hook, brief
 * cache, triage-agent thread, nudge inbox), while the Drawer container
 * stays mounted continuously so AntD does NOT animate a close/open
 * transition on project switch.
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
    /**
     * Phase 4 A8 — inbox surface props. Optional so legacy callers
     * (tests that compose `<CopilotDock>` directly without an inbox
     * wiring) keep working without forcing them to supply a stub.
     */
    inboxNudges?: InboxTabBodyProps["nudges"];
    onActionInboxNudge?: InboxTabBodyProps["onActionNudge"];
    onDismissInboxNudge?: InboxTabBodyProps["onDismissNudge"];
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
    footerSlot,
    inboxNudges,
    onActionInboxNudge,
    onDismissInboxNudge
}) => {
    const isPhone = useIsPhoneChrome();
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
        },
        {
            key: "inbox",
            label: microcopy.copilotDock.inboxTab.title,
            children: (
                <InboxTabBody
                    dockOpen={open}
                    nudges={inboxNudges ?? []}
                    onActionNudge={onActionInboxNudge}
                    onDismissNudge={onDismissInboxNudge}
                    tabActive={activeTab === "inbox"}
                />
            )
        }
    ];

    const segmentedOptions = tabItems.map((item) => ({
        label: item.label,
        value: item.key
    }));

    return (
        <>
            {isPhone ? (
                <>
                    <Segmented
                        aria-label={microcopy.copilotDock.tabListLabel}
                        block
                        data-testid="copilot-dock-segmented"
                        onChange={(key) => onTabChange(key as CopilotDockTab)}
                        options={segmentedOptions}
                        style={{ marginBottom: space.xs }}
                        value={activeTab}
                    />
                    {tabItems.map((item) => (
                        <DockTabPane
                            $active={activeTab === item.key}
                            data-testid={`copilot-dock-pane-${item.key}`}
                            key={item.key}
                        >
                            {item.children}
                        </DockTabPane>
                    ))}
                </>
            ) : (
                <DockTabs
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
                />
            )}
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
 * Phase 4 A8 — dock shell separated from the body so the host can keep
 * it mounted across `projectId` changes. Owns the placement, title
 * chrome, accessible name, and close handling. Renders its children
 * inside the surface body — those children are the project-scoped tab
 * content keyed on `projectId` in the host.
 *
 * Phase 6 Wave 3 — the placement / chrome split previously inlined here
 * (phone bottom Drawer vs desktop right Drawer) now ships via the shared
 * `<Sheet>` primitive. On phone the Sheet renders a multi-detent
 * animated surface; on desktop / tablet / reduced-motion it falls back
 * to the AntD `<Drawer>` with `desktopPlacement="right"` and a 420 px
 * shelf so the dock keeps its prior visual footprint.
 */
export interface CopilotDockShellProps {
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
}

/*
 * Legibility-first glass: the GlassPanel root carries `backdrop-filter`,
 * which on macOS Safari forces a compositing layer that disables
 * sub-pixel antialiasing on descendant text. Per the GlassPanel contract
 * (its header note), text must live in an isolated content child so the
 * tab bodies paint on their own stacking context instead of the filtered
 * root. `isolation: isolate` + `position: relative` establish that
 * context; the flex props mirror the GlassPanel's own layout so the inner
 * Tabs (`flex: 1 1 auto`) + footer slot stay full-bleed — visually inert
 * on Chrome / Firefox.
 */
const DockContentLayer = styled.div`
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    isolation: isolate;
    min-height: 0;
    position: relative;
`;

export const CopilotDockShell: React.FC<CopilotDockShellProps> = ({
    open,
    onClose,
    children
}) => {
    return (
        <Sheet
            closable
            // The dialog's accessible name is the visible "Copilot" title.
            // Linking via `aria-labelledby` (the actual heading element)
            // is stronger than `aria-label` because it stays in sync with
            // any future copy change and announces the same string the
            // user sees (R1-M3). Sheet's P1.2 fix means the consumer's
            // <Typography.Title id="copilot-dock-title"> below is the
            // sole carrier of this id in the DOM — Sheet does NOT stamp
            // its own duplicate id on the title slot when we supply
            // `ariaLabelledBy` here.
            ariaLabelledBy="copilot-dock-title"
            data-testid="copilot-dock"
            // Phase 6 Wave 3 — the dock opens at its full visible height
            // on phone (matches the prior `size: "100%"` Drawer). Allow
            // medium as a secondary detent so the user can shrink the
            // surface back down without dismissing the chat thread.
            defaultDetent="large"
            detents={["medium", "large"]}
            // Desktop / tablet / reduced-motion path: the dock keeps its
            // 420 px right shelf (Phase 3 A1, doc §A1 lines 153-166).
            desktopPlacement="right"
            desktopSize={420}
            closeAriaLabel={microcopy.copilotDock.closeLabel}
            mask
            maskClosable
            onClose={onClose}
            open={open}
            styles={{
                /*
                 * Wave 1 T2: the radial aurora wash that used to live
                 * inline here ships via the shared `<GlassPanel>` mounted
                 * directly inside the dock body. The Sheet body slot
                 * keeps the layout-only props (flex column + zero
                 * padding) so the GlassPanel inside still owns the
                 * padding budget (including the
                 * `env(keyboard-inset-height)` / safe-area math the
                 * legacy Drawer body used to consume).
                 */
                body: {
                    display: "flex",
                    flexDirection: "column",
                    padding: 0
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
                </Space>
            }
        >
            <GlassPanel
                intensity="subtle"
                tone="aurora"
                /*
                 * Dock body wash, NOT a full glass card: the surrounding
                 * Sheet (whether animated or AntD-Drawer fallback)
                 * already owns the chrome, so we strip the panel's own
                 * border + radius so it reads as a wash rather than an
                 * inset card. The aurora dome (radial gradient anchored
                 * at top-centre) is preserved via the background override
                 * so the migration is pixel-stable; Wave 2+ will lift
                 * the dome shape into a GlassPanel tone variant when
                 * more surfaces share it. The flex layout the Drawer
                 * body used to own moves onto this wrapper so the inner
                 * tabs + footer slot stay full-bleed.
                 */
                style={{
                    background:
                        "radial-gradient(60% 30% at 50% 0%, var(--aurora-blob-faint) 0%, transparent 70%), transparent",
                    border: "none",
                    borderRadius: 0,
                    display: "flex",
                    flex: "1 1 auto",
                    flexDirection: "column",
                    minHeight: 0,
                    paddingBottom: `max(${space.md}px, env(keyboard-inset-height, 0px), env(safe-area-inset-bottom))`,
                    paddingInlineEnd: `max(${space.lg}px, env(safe-area-inset-right))`,
                    paddingInlineStart: `max(${space.lg}px, env(safe-area-inset-left))`,
                    paddingTop: space.lg
                }}
            >
                <DockContentLayer>{children}</DockContentLayer>
            </GlassPanel>
        </Sheet>
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
