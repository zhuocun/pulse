import { Drawer, Grid, Space, Tag, Typography } from "antd";

import { microcopy } from "../../constants/microcopy";
import { fontWeight, space } from "../../theme/tokens";
import type { MutationProposal, TriageNudge } from "../../interfaces/agent";
import AiSparkleIcon from "../aiSparkleIcon";
import ChatTabBody from "../copilotDock/ChatTabBody";

export interface AiChatDrawerProps {
    open: boolean;
    onClose: () => void;
    /** Current project when on a board; omit or null on the project list */
    project: IProject | null;
    columns: IColumn[];
    tasks: ITask[];
    members: IMember[];
    /** Every project id the user may reference (e.g. list query + current) */
    knownProjectIds: string[];
    /**
     * Optional pre-populated prompt (e.g. dispatched from the command
     * palette in AI mode). The drawer auto-sends this when it opens with
     * a non-empty value.
     */
    initialPrompt?: string;
    pendingProposal?: MutationProposal;
    pendingNudges?: TriageNudge[];
    onAcceptProposal?: (proposal: MutationProposal) => void;
    onRejectProposal?: (proposal: MutationProposal) => void;
    onUndoProposal?: (proposal: MutationProposal) => void;
    onActionNudge?: (nudge: TriageNudge) => void;
    onDismissNudge?: (nudge: TriageNudge) => void;
}

const AiChatDrawer: React.FC<AiChatDrawerProps> = ({
    open,
    onClose,
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
    const screens = Grid.useBreakpoint();
    const drawerWidth = screens.md ? 420 : "100%";

    return (
        <Drawer
            onClose={onClose}
            open={open}
            size={drawerWidth}
            styles={{
                body: {
                    /* Quiet brand-accent breath at the top of the drawer
                     * body so the AI surface reads as distinct from a
                     * generic dialog. Uses `--aurora-blob-faint` so a
                     * palette swap re-tints in one shot. */
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
                        {microcopy.ai.askCopilot}
                    </Typography.Text>
                    {screens.md && (
                        <Tag color="purple">{microcopy.a11y.aiBadge}</Tag>
                    )}
                </Space>
            }
        >
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
                open={open}
                pendingNudges={pendingNudges}
                pendingProposal={pendingProposal}
                project={project}
                tasks={tasks}
            />
        </Drawer>
    );
};

export default AiChatDrawer;
