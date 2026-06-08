import {
    DownOutlined,
    FileTextOutlined,
    MessageOutlined
} from "@ant-design/icons";
import styled from "@emotion/styled";
import { Badge, Button, Dropdown, Space } from "antd";
import type { MenuProps } from "antd";
import React from "react";

import { microcopy } from "../../constants/microcopy";
import AiSparkleIcon from "../aiSparkleIcon";

/**
 * Visible launcher label. Collapses to icon-only under a coarse pointer
 * (phone chrome) where the launcher lives inside the board's Liquid
 * Glass capsule and the text would push the four-segment toolbar past a
 * 390 px viewport. The button keeps an explicit `aria-label` so the
 * accessible name stays "Copilot" even when the text is hidden. The
 * `(pointer: coarse)` query mirrors the board's own phone-capsule gate
 * (`useIsPhoneChrome`), so the label hides exactly when the launcher is
 * inside the capsule and stays visible on the desktop bottom-tier slot.
 */
const LauncherLabel = styled.span`
    @media (pointer: coarse) {
        display: none;
    }
`;

interface CopilotMenuProps {
    /** Opens the AI chat ("Ask") drawer — the primary-button action. */
    onAsk: () => void;
    /** Opens the board brief drawer. */
    onBrief: () => void;
    /** Unread Inbox-nudge count surfaced as a launcher badge. */
    inboxUnread: number;
    /** Pre-formatted accessible label for the unread badge (omit when 0). */
    unreadAriaLabel?: string;
}

/**
 * Consolidated Board Copilot launcher (ui-todo §1.2 item 7). Replaces the
 * separate Brief / Ask buttons with a single split control: the primary
 * button runs the most common action (open chat / Ask), and the trailing
 * caret opens a menu with Brief and Ask. Per-project AI toggles live in
 * the board overflow menu so the launcher stays focused on chat actions.
 *
 * `Space.Compact` + `Dropdown` + `Button` is AntD 6's recommended pattern
 * (the legacy `Dropdown.Button` is deprecated and would log a console
 * warning the strict test harness treats as a failure).
 *
 * Accessible names are intentionally stable: the caret trigger keeps the
 * `boardCopilotMenu` label and the menu items keep the `Ask Copilot` /
 * `Board brief` strings the AI test suites assert against.
 */
const CopilotMenu: React.FC<CopilotMenuProps> = ({
    onAsk,
    onBrief,
    inboxUnread,
    unreadAriaLabel
}) => {
    const items: MenuProps["items"] = [
        {
            key: "brief",
            label: microcopy.board.copilotMenuBrief,
            icon: <FileTextOutlined aria-hidden />,
            onClick: onBrief
        },
        {
            key: "ask",
            label: microcopy.board.copilotMenuAsk,
            icon: <MessageOutlined aria-hidden />,
            onClick: onAsk
        }
    ];

    return (
        <Badge
            aria-label={unreadAriaLabel}
            count={inboxUnread}
            data-testid="copilot-launcher-badge"
            offset={[-4, 4]}
            size="small"
        >
            <Space.Compact>
                <Button
                    aria-label={microcopy.labels.copilotShort}
                    icon={<AiSparkleIcon aria-hidden />}
                    onClick={onAsk}
                    type="default"
                >
                    <LauncherLabel>
                        {microcopy.labels.copilotShort}
                    </LauncherLabel>
                </Button>
                <Dropdown
                    menu={{ items }}
                    placement="bottomRight"
                    trigger={["click"]}
                >
                    <Button
                        aria-label={microcopy.a11y.boardCopilotMenu}
                        icon={<DownOutlined aria-hidden />}
                        type="default"
                    />
                </Dropdown>
            </Space.Compact>
        </Badge>
    );
};

export default CopilotMenu;
