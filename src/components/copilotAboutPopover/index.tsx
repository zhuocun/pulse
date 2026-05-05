import { InfoCircleOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Button, Popover, Tag, Typography } from "antd";
import React from "react";

import environment from "../../constants/env";
import { fontSize, fontWeight, space } from "../../theme/tokens";

/**
 * "About Board Copilot" capabilities / knowledge-cutoff disclosure (P2-F).
 *
 * Surfaces what the copilot can and cannot do, along with model origin and
 * knowledge cutoff, so users can calibrate expectations before interacting.
 * Triggered by a small info icon button that renders inline wherever it is
 * placed (e.g. inside the AI chat drawer header area).
 */
const TriggerButton = styled(Button)`
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65));
    font-size: ${fontSize.xs}px;
    font-weight: ${fontWeight.medium};

    &:hover,
    &:focus-visible {
        color: var(--ant-color-text, rgba(15, 23, 42, 0.9));
    }
`;

const List = styled.ul`
    margin: ${space.xxs}px 0;
    max-width: 22rem;
    padding-inline-start: ${space.lg}px;
`;

const Section = styled.div`
    margin-top: ${space.xs}px;
`;

const CopilotAboutPopover: React.FC = () => {
    const isRemote = !environment.aiUseLocalEngine;

    const modelInfo = isRemote
        ? "Powered by a remote AI model. Your data is processed according to your privacy settings."
        : "Running on a local AI engine. Your data stays on this device.";

    const content = (
        <div style={{ maxWidth: "22rem" }}>
            <Typography.Title level={5} style={{ marginTop: 0 }}>
                About Board Copilot
            </Typography.Title>

            <Section>
                <Typography.Title
                    level={5}
                    style={{
                        fontSize: fontSize.sm,
                        fontWeight: fontWeight.semibold,
                        marginBottom: space.xxs,
                        marginTop: 0
                    }}
                >
                    What Board Copilot can help with
                </Typography.Title>
                <List>
                    <li>Search and filter tasks</li>
                    <li>Summarize board status</li>
                    <li>Draft new tasks</li>
                    <li>Estimate effort for tasks</li>
                    <li>Answer questions about your project</li>
                </List>
            </Section>

            <Section>
                <Typography.Title
                    level={5}
                    style={{
                        fontSize: fontSize.sm,
                        fontWeight: fontWeight.semibold,
                        marginBottom: space.xxs,
                        marginTop: 0
                    }}
                >
                    What it cannot do
                </Typography.Title>
                <List>
                    <li>Access the internet or external data</li>
                    <li>Modify tasks without your review (in Plan mode)</li>
                    <li>Remember conversations from previous sessions</li>
                </List>
            </Section>

            <Typography.Paragraph
                style={{
                    alignItems: "center",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    marginBottom: space.xs,
                    marginTop: space.xs
                }}
                type="secondary"
            >
                <Tag
                    color={isRemote ? "purple" : "default"}
                    style={{ marginInlineEnd: 0 }}
                >
                    {isRemote ? "Remote model" : "Local engine"}
                </Tag>
                <span>{modelInfo}</span>
            </Typography.Paragraph>

            <Typography.Paragraph
                style={{ marginBottom: 0, marginTop: 0 }}
                type="secondary"
            >
                {/* TODO: drive from config */}
                Knowledge cutoff: January 2025
            </Typography.Paragraph>
        </div>
    );

    return (
        <Popover
            content={content}
            placement="topRight"
            trigger={["click", "focus"]}
        >
            <TriggerButton
                aria-label="About Board Copilot"
                icon={<InfoCircleOutlined />}
                size="small"
                type="text"
            />
        </Popover>
    );
};

export default CopilotAboutPopover;
