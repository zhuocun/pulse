import { Drawer, Space, Tabs, Tag, Typography } from "antd";

import { microcopy } from "../../constants/microcopy";
import { fontWeight, space } from "../../theme/tokens";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import type { MutationProposal, TriageNudge } from "../../interfaces/agent";
import AiSparkleIcon from "../aiSparkleIcon";

import BriefTabBody from "./BriefTabBody";
import ChatTabBody from "./ChatTabBody";

export type CopilotDockTab = "chat" | "brief";

export interface CopilotDockProps {
    open: boolean;
    onClose: () => void;
    activeTab: CopilotDockTab;
    onTabChange: (tab: CopilotDockTab) => void;
    project: IProject | null;
    columns: IColumn[];
    tasks: ITask[];
    members: IMember[];
    knownProjectIds: string[];
    /** Chat-only: pre-populated prompt dispatched from the command palette. */
    initialPrompt?: string;
    /** Chat-only: active MutationProposal emitted by the agent stream. */
    pendingProposal?: MutationProposal;
    pendingNudges?: TriageNudge[];
    onAcceptProposal?: (proposal: MutationProposal) => void;
    onRejectProposal?: (proposal: MutationProposal) => void;
    onUndoProposal?: (proposal: MutationProposal) => void;
    onActionNudge?: (nudge: TriageNudge) => void;
    onDismissNudge?: (nudge: TriageNudge) => void;
}

const CopilotDock: React.FC<CopilotDockProps> = ({
    open,
    onClose,
    activeTab,
    onTabChange,
    project,
    columns,
    tasks,
    members,
    knownProjectIds,
    initialPrompt,
    pendingProposal,
    pendingNudges,
    onAcceptProposal,
    onRejectProposal,
    onUndoProposal,
    onActionNudge,
    onDismissNudge
}) => {
    const isPhone = useIsPhoneChrome();

    // Phase 3 A1 — phone gets a full-height bottom sheet, desktop/tablet
    // gets the 420 px right shelf the doc specifies (§A1 lines 153-166).
    // `size` accepts a number/percentage for finer control than the
    // "default" | "large" literals.
    const drawerProps = isPhone
        ? { placement: "bottom" as const, size: "100%" as const }
        : { placement: "right" as const, size: 420 };

    const tabItems = [
        {
            key: "chat",
            label: microcopy.copilotDock.tabChat,
            children: (
                <ChatTabBody
                    columns={columns}
                    initialPrompt={initialPrompt}
                    knownProjectIds={knownProjectIds}
                    members={members}
                    onAcceptProposal={onAcceptProposal}
                    onActionNudge={onActionNudge}
                    onDismissNudge={onDismissNudge}
                    onRejectProposal={onRejectProposal}
                    onUndoProposal={onUndoProposal}
                    open={open && activeTab === "chat"}
                    pendingNudges={pendingNudges}
                    pendingProposal={pendingProposal}
                    project={project}
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
                    members={members}
                    open={open && activeTab === "brief"}
                    project={project ?? undefined}
                    tasks={tasks}
                />
            )
        }
    ];

    return (
        <Drawer
            {...drawerProps}
            aria-label={microcopy.copilotDock.ariaLabel}
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
                    <Typography.Text
                        style={{ fontWeight: fontWeight.semibold }}
                    >
                        {microcopy.copilotDock.title}
                    </Typography.Text>
                    <Tag color="purple">{microcopy.a11y.aiBadge}</Tag>
                </Space>
            }
        >
            <Tabs
                activeKey={activeTab}
                aria-label={microcopy.copilotDock.tabListLabel}
                data-testid="copilot-dock-tabs"
                /*
                 * `destroyInactiveTabPane={false}` keeps inactive tabs
                 * mounted so chat history + the brief cache survive a
                 * tab switch — both bodies own their own state and
                 * teardown via their `open` prop.
                 */
                destroyInactiveTabPane={false}
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
        </Drawer>
    );
};

export default CopilotDock;
