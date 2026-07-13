import { Info } from "lucide-react";
import React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@/components/ui/popover";
import { Typography } from "@/components/ui/typography";

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
const LIST_CLASS = "my-xxs max-w-[22rem] ps-lg list-disc";
const SECTION_CLASS = "mt-xs";
const SUBTITLE_STYLE: React.CSSProperties = {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    marginBottom: space.xxs,
    marginTop: 0
};

const SERVER_METADATA_EMPTY =
    "Server did not publish additional limit details.";

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
            const {
                rate_limit: rate,
                allowed_autonomy: rawLevels,
                recursion_limit: recursionLimit,
                tags,
                context_schema: contextSchema,
                monthly_token_budget_cap: budgetCap
            } = chatMeta.data;
            const levels = Array.isArray(rawLevels) ? rawLevels : [];
            const budgetLine =
                typeof budgetCap === "number" &&
                Number.isFinite(budgetCap) &&
                budgetCap > 0
                    ? microcopy.about.monthlyBudgetCapLine.replace(
                          "{cap}",
                          String(budgetCap)
                      )
                    : null;
            const rateLine =
                rate &&
                typeof rate === "object" &&
                typeof rate.per_minute === "number" &&
                typeof rate.per_hour === "number"
                    ? microcopy.about.rateLimitLine
                          .replace("{perMinute}", String(rate.per_minute))
                          .replace("{perHour}", String(rate.per_hour))
                    : null;
            const recursionLine =
                typeof recursionLimit === "number" &&
                Number.isFinite(recursionLimit)
                    ? microcopy.about.recursionLimitLine.replace(
                          "{limit}",
                          String(recursionLimit)
                      )
                    : null;
            const normalizedTags =
                tags
                    ?.map((tag) => tag.trim())
                    .filter((tag) => tag.length > 0) ?? [];
            const contextSchemaLine =
                contextSchema &&
                typeof contextSchema === "object" &&
                !Array.isArray(contextSchema)
                    ? (() => {
                          const keys = Object.keys(contextSchema);
                          if (keys.length === 0) return null;
                          return microcopy.about.contextSchemaKeysLine.replace(
                              "{keys}",
                              keys.join(", ")
                          );
                      })()
                    : null;
            const hasDisclosedField =
                Boolean(rateLine) ||
                Boolean(budgetLine) ||
                levels.length > 0 ||
                Boolean(recursionLine) ||
                normalizedTags.length > 0 ||
                Boolean(contextSchemaLine);
            return (
                <>
                    {!hasDisclosedField ? (
                        <Typography.Paragraph
                            style={{
                                marginBottom: 0,
                                marginTop: space.xs
                            }}
                            type="secondary"
                        >
                            {SERVER_METADATA_EMPTY}
                        </Typography.Paragraph>
                    ) : null}
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
                    {budgetLine ? (
                        <Typography.Paragraph
                            style={{
                                marginBottom: space.xxs,
                                marginTop: 0
                            }}
                            type="secondary"
                        >
                            {budgetLine}
                        </Typography.Paragraph>
                    ) : null}
                    {recursionLine ? (
                        <Typography.Paragraph
                            style={{
                                marginBottom: space.xxs,
                                marginTop: 0
                            }}
                            type="secondary"
                        >
                            {recursionLine}
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
                            <div className="mb-xs flex flex-wrap gap-[6px]">
                                {levels.map((level) => (
                                    <Badge key={level} variant="secondary">
                                        {level}
                                    </Badge>
                                ))}
                            </div>
                        </>
                    ) : null}
                    {normalizedTags.length > 0 ? (
                        <>
                            <Typography.Paragraph
                                style={{
                                    marginBottom: space.xxs,
                                    marginTop: 0
                                }}
                                type="secondary"
                            >
                                Tags:
                            </Typography.Paragraph>
                            <div className="mb-xs flex flex-wrap gap-[6px]">
                                {normalizedTags.map((tag) => (
                                    <Badge key={tag} variant="secondary">
                                        {tag}
                                    </Badge>
                                ))}
                            </div>
                        </>
                    ) : null}
                    {contextSchemaLine ? (
                        <Typography.Paragraph
                            style={{
                                marginBottom: space.xs,
                                marginTop: 0
                            }}
                            type="secondary"
                        >
                            {contextSchemaLine}
                        </Typography.Paragraph>
                    ) : null}
                </>
            );
        })();

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    aria-label={microcopy.a11y.aboutBoardCopilot}
                    className="text-muted-foreground hover:text-foreground"
                    size="icon"
                    variant="ghost"
                >
                    <Info aria-hidden />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="end"
                aria-label={microcopy.about.title}
                className="max-h-[70vh] w-[22rem] max-w-[calc(100vw-2rem)] overflow-y-auto"
                side="top"
            >
                <Typography.Title level={5} style={{ marginTop: 0 }}>
                    {microcopy.about.title}
                </Typography.Title>

                <div className={SECTION_CLASS}>
                    <Typography.Title level={5} style={SUBTITLE_STYLE}>
                        {microcopy.about.canHelpTitle}
                    </Typography.Title>
                    <ul className={LIST_CLASS}>
                        {microcopy.about.canHelpItems.map((item) => (
                            <li key={item}>{item}</li>
                        ))}
                    </ul>
                </div>

                <div className={SECTION_CLASS}>
                    <Typography.Title level={5} style={SUBTITLE_STYLE}>
                        {microcopy.about.limitationsTitle}
                    </Typography.Title>
                    <ul className={LIST_CLASS}>
                        {microcopy.about.limitationsItems.map((item) => (
                            <li key={item}>{item}</li>
                        ))}
                    </ul>
                </div>

                {showServerLimits ? (
                    <div className={SECTION_CLASS}>
                        <Typography.Title level={5} style={SUBTITLE_STYLE}>
                            {microcopy.about.serverLimitsTitle}
                        </Typography.Title>
                        {serverLimitsSection}
                    </div>
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
                    <Badge variant={isRemote ? "default" : "secondary"}>
                        {isRemote
                            ? microcopy.about.remoteModeTag
                            : microcopy.about.localModeTag}
                    </Badge>
                    <span>{modelInfo}</span>
                </Typography.Paragraph>

                <Typography.Paragraph
                    style={{ marginBottom: 0, marginTop: 0 }}
                    type="secondary"
                >
                    {knowledgeCutoffLine}
                </Typography.Paragraph>
            </PopoverContent>
        </Popover>
    );
};

export default CopilotAboutPopover;
