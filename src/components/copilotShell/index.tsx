import { ArrowRightOutlined } from "@ant-design/icons";
import { Button, Drawer, Grid, Space, Tabs, Typography } from "antd";
import { type FC, useEffect, useState } from "react";

import { microcopy } from "../../constants/microcopy";
import { fontSize, fontWeight, space } from "../../theme/tokens";
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
    const [activeTab, setActiveTab] = useState<CopilotShellTab>(defaultTab);

    // Sync the active tab whenever the caller changes defaultTab (e.g. on
    // re-open with a different target tab).
    useEffect(() => {
        setActiveTab(defaultTab);
    }, [defaultTab]);

    const screens = Grid.useBreakpoint();
    const drawerWidth = screens.md ? 520 : "100%";

    const titleNode = (
        <Space align="center" size={space.xs}>
            <AiSparkleIcon aria-hidden size="sm" />
            <span style={{ fontWeight: fontWeight.semibold }}>
                {microcopy.copilotShell.title}
            </span>
        </Space>
    );

    const tabItems = [
        {
            key: "chat",
            label: microcopy.copilotShell.tabs.chat,
            children: (
                <PlaceholderTab
                    description={microcopy.copilotShell.placeholders.chat}
                    ctaLabel={microcopy.copilotShell.ctaOpenChat}
                    onCta={onOpenChat}
                />
            )
        },
        {
            key: "brief",
            label: microcopy.copilotShell.tabs.brief,
            children: (
                <PlaceholderTab
                    description={microcopy.copilotShell.placeholders.brief}
                    ctaLabel={microcopy.copilotShell.ctaOpenBrief}
                    onCta={onOpenBrief}
                />
            )
        },
        {
            key: "activity",
            label: microcopy.copilotShell.tabs.activity,
            children: (
                <PlaceholderTab
                    description={microcopy.copilotShell.placeholders.activity}
                />
            )
        },
        {
            key: "settings",
            label: microcopy.copilotShell.tabs.settings,
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
                        {microcopy.copilotShell.settingsBody}
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
            styles={{ wrapper: { width: drawerWidth } }}
            title={titleNode}
        >
            <Tabs
                activeKey={activeTab}
                items={tabItems}
                onChange={(key) => setActiveTab(key as CopilotShellTab)}
                style={{ height: "100%" }}
            />
        </Drawer>
    );
};

export default CopilotShell;
