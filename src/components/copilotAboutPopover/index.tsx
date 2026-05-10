import { InfoCircleOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Button, Popover, Tag, Typography } from "antd";
import React from "react";

import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import { fontSize, fontWeight, space } from "../../theme/tokens";
import { resolveAiKnowledgeCutoffForUi } from "../../utils/ai/agentClient";
import useChatAgentMetadata from "../../utils/hooks/useChatAgentMetadata";

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
    const showServerLimits =
        isRemote && environment.aiEnabled && environment.aiBaseUrl.length > 0;
    const chatMeta = useChatAgentMetadata();

    const knowledgeWire =
        chatMeta.status === "ready" ? chatMeta.data : undefined;
    const knowledgeCutoffLine = microcopy.about.knowledgeCutoffTemplate.replace(
        "{date}",
        resolveAiKnowledgeCutoffForUi(knowledgeWire)
    );

    const modelInfo = isRemote
        ? microcopy.about.remoteModeDescription
        : microcopy.about.localModeDescription;

    const serverLimitsSection =
        showServerLimits &&
        (() => {
            if (chatMeta.status === "idle") {
                return (
                    <Typography.Paragraph
                        style={{ marginBottom: 0, marginTop: space.xs }}
                        type="secondary"
                    >
                        {microcopy.about.serverMetadataLoading}
                    </Typography.Paragraph>
                );
            }
            if (chatMeta.status === "loading") {
                return (
                    <Typography.Paragraph
                        style={{ marginBottom: 0, marginTop: space.xs }}
                        type="secondary"
                    >
                        {microcopy.about.serverMetadataLoading}
                    </Typography.Paragraph>
                );
            }
            if (chatMeta.status === "error") {
                return (
                    <Typography.Paragraph
                        style={{ marginBottom: 0, marginTop: space.xs }}
                        type="secondary"
                    >
                        {microcopy.about.serverMetadataUnavailable}
                    </Typography.Paragraph>
                );
            }
            const { rate_limit: rate, allowed_autonomy: levels } =
                chatMeta.data;
            const rateLine =
                rate &&
                microcopy.about.rateLimitLine
                    .replace("{perMinute}", String(rate.per_minute))
                    .replace("{perHour}", String(rate.per_hour));
            return (
                <>
                    {rateLine ? (
                        <Typography.Paragraph
                            style={{
                                marginBottom: space.xxs,
                                marginTop: space.xs
                            }}
                            type="secondary"
                        >
                            {rateLine}
                        </Typography.Paragraph>
                    ) : null}
                    {levels.length > 0 ? (
                        <>
                            <Typography.Paragraph
                                style={{
                                    marginBottom: space.xxs,
                                    marginTop: 0
                                }}
                                type="secondary"
                            >
                                {microcopy.about.allowedAutonomyLabel}:
                            </Typography.Paragraph>
                            <div
                                style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: 6,
                                    marginBottom: space.xs
                                }}
                            >
                                {levels.map((level) => (
                                    <Tag key={level}>{level}</Tag>
                                ))}
                            </div>
                        </>
                    ) : null}
                </>
            );
        })();

    const content = (
        <div style={{ maxWidth: "22rem" }}>
            <Typography.Title level={5} style={{ marginTop: 0 }}>
                {microcopy.about.title}
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
                    {microcopy.about.canHelpTitle}
                </Typography.Title>
                <List>
                    {microcopy.about.canHelpItems.map((item) => (
                        <li key={item}>{item}</li>
                    ))}
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
                    {microcopy.about.limitationsTitle}
                </Typography.Title>
                <List>
                    {microcopy.about.limitationsItems.map((item) => (
                        <li key={item}>{item}</li>
                    ))}
                </List>
            </Section>

            {showServerLimits ? (
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
                        {microcopy.about.serverLimitsTitle}
                    </Typography.Title>
                    {serverLimitsSection}
                </Section>
            ) : null}

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
                    {isRemote
                        ? microcopy.about.remoteModeTag
                        : microcopy.about.localModeTag}
                </Tag>
                <span>{modelInfo}</span>
            </Typography.Paragraph>

            <Typography.Paragraph
                style={{ marginBottom: 0, marginTop: 0 }}
                type="secondary"
            >
                {knowledgeCutoffLine}
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
                aria-label={microcopy.a11y.aboutBoardCopilot}
                icon={<InfoCircleOutlined />}
                size="small"
                type="text"
            />
        </Popover>
    );
};

export default CopilotAboutPopover;
