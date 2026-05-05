import { ArrowRightOutlined } from "@ant-design/icons";
import { Button, Drawer, Grid, Space, Tabs, Typography } from "antd";
import type { FC } from "react";

import { fontSize, fontWeight, space } from "../../theme/tokens";
import type { MutationProposal, TriageNudge } from "../../interfaces/agent";
import AiSparkleIcon from "../aiSparkleIcon";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type CopilotShellTab = "chat" | "brief" | "activity" | "settings";

/**
 * P1-A: Unified Copilot shell — a right-rail drawer with four tabs.
 *
 * Phase-1 MVP: each tab renders a lightweight placeholder + a button that
 * opens the existing dedicated drawer/modal. Full in-shell content (Chat
 * messages, Brief sections, activity feed) is deferred to P1-A phase 2+.
 */
export interface CopilotShellProps {
    open: boolean;
    onClose: () => void;
    /** Which tab to activate when the shell opens. Defaults to "chat". */
    defaultTab?: CopilotShellTab;

    // ── Chat props (forwarded to AiChatDrawer in phase 2) ──────────────────
    project: IProject | null;
    columns: IColumn[];
    tasks: ITask[];
    members: IMember[];
    knownProjectIds: string[];
    initialPrompt?: string;
    pendingProposal?: MutationProposal;
    pendingNudges?: TriageNudge[];
    onAcceptProposal?: (proposal: MutationProposal) => void;
    onRejectProposal?: (proposal: MutationProposal) => void;
    onActionNudge?: (nudge: TriageNudge) => void;
    onDismissNudge?: (nudge: TriageNudge) => void;

    // ── Callbacks: open existing drawers (phase 1 delegation) ──────────────
    onOpenChat?: () => void;
    onOpenBrief?: () => void;
}

// ---------------------------------------------------------------------------
// Tab content placeholders
// ---------------------------------------------------------------------------

const PlaceholderTab: FC<{
    description: string;
    ctaLabel?: string;
    onCta?: () => void;
}> = ({ description, ctaLabel, onCta }) => (
    <div
        style={{
            alignItems: "center",
            display: "flex",
            flexDirection: "column",
            gap: space.md,
            justifyContent: "center",
            minHeight: 200,
            padding: `${space.xl}px ${space.lg}px`,
            textAlign: "center"
        }}
    >
        <AiSparkleIcon aria-hidden size="lg" />
        <Typography.Text type="secondary">{description}</Typography.Text>
        {ctaLabel && onCta && (
            <Button
                icon={<ArrowRightOutlined aria-hidden />}
                onClick={onCta}
                type="primary"
            >
                {ctaLabel}
            </Button>
        )}
    </div>
);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const CopilotShell: FC<CopilotShellProps> = ({
    open,
    onClose,
    defaultTab = "chat",
    onOpenChat,
    onOpenBrief
}) => {
    const screens = Grid.useBreakpoint();
    const drawerWidth = screens.md ? 520 : "100%";

    const titleNode = (
        <Space align="center" size={space.xs}>
            <AiSparkleIcon aria-hidden size="sm" />
            <span style={{ fontWeight: fontWeight.semibold }}>
                Board Copilot
            </span>
        </Space>
    );

    const tabItems = [
        {
            key: "chat",
            label: "Chat",
            children: (
                <PlaceholderTab
                    description="Ask Board Copilot anything about your board — tasks, blockers, priorities, and more."
                    ctaLabel="Open Chat"
                    onCta={onOpenChat}
                />
            )
        },
        {
            key: "brief",
            label: "Brief",
            children: (
                <PlaceholderTab
                    description="Get an AI-generated summary of board health, blockers, and workload distribution."
                    ctaLabel="Open Brief"
                    onCta={onOpenBrief}
                />
            )
        },
        {
            key: "activity",
            label: "Activity",
            children: (
                <PlaceholderTab description="Agent activity and triage nudges will appear here." />
            )
        },
        {
            key: "settings",
            label: "Settings",
            children: (
                <div
                    style={{
                        padding: `${space.lg}px ${space.md}px`
                    }}
                >
                    <Typography.Text
                        style={{ fontSize: fontSize.sm }}
                        type="secondary"
                    >
                        Copilot settings — autonomy level, privacy, and
                        per-project controls — are managed via the board
                        settings menu.
                    </Typography.Text>
                </div>
            )
        }
    ];

    return (
        <Drawer
            destroyOnClose={false}
            onClose={onClose}
            open={open}
            placement="right"
            title={titleNode}
            width={drawerWidth}
        >
            <Tabs
                defaultActiveKey={defaultTab}
                items={tabItems}
                style={{ height: "100%" }}
            />
        </Drawer>
    );
};

export default CopilotShell;
