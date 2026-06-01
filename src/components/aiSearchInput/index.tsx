import { CloseCircleFilled, InfoCircleOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Alert, Button, Input, Space, Tag, Tooltip, Typography } from "antd";
import React, {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState
} from "react";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import {
    breakpoints,
    maxLineLengthCh,
    space as themeSpace
} from "../../theme/tokens";
import {
    clearAiSearchStrengths,
    setAiSearchStrengths
} from "../../utils/ai/aiSearchStrength";
import { useRemoteAiConsent } from "../../utils/ai/remoteAiConsent";
import {
    AiContextProject,
    AiSearchProjectsContext,
    semanticSearch
} from "../../utils/ai/engine";
import SrOnlyLive from "../../utils/a11y/SrOnlyLive";
import { aiErrorView } from "../../utils/ai/errorTemplate";
import { isProjectAiDisabled } from "../../utils/ai/projectAiStorage";
import { validateSearch } from "../../utils/ai/validate";
import useAi, {
    assertRunPayloadProjectsAiAllowed
} from "../../utils/hooks/useAi";
import useAgent from "../../utils/hooks/useAgent";
import useAiEnabled from "../../utils/hooks/useAiEnabled";
import AiSparkleIcon from "../aiSparkleIcon";
import CopilotRemoteConsentNotice from "../copilotRemoteConsentNotice";

type TaskSearchProps = {
    kind: "tasks";
    projectContext: AiContextProject;
    semanticIds: string | null | undefined;
    setSemanticIds: (value: string | undefined) => void;
};

type ProjectSearchProps = {
    kind: "projects";
    projectsContext: AiSearchProjectsContext;
    semanticIds: string | null | undefined;
    setSemanticIds: (value: string | undefined) => void;
};

type Props = TaskSearchProps | ProjectSearchProps;

/** URL search params use `null` for missing keys; treat like unset. */
const hasActiveSemanticFilter = (semanticIds: string | null | undefined) =>
    Boolean(semanticIds?.trim());

/**
 * Minimal-effort "Did you mean?" reformulator. Generates up to three
 * rephrasings the user can click to retry — synonyms, broader scope,
 * and a verb shift. The output is intentionally lo-fi: when the agent
 * server adds real reformulation we'll swap the implementation but the
 * surface stays the same.
 */
const reformulate = (query: string): string[] => {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    const words = trimmed.split(/\s+/);
    const head = words[0];
    const lowerHead = head?.toLowerCase() ?? "";
    // Guard rails so we don't spit back nonsense like "open open the door"
    // or "tasks about tasks about X" when the user already prefixed with
    // a verb the templates also use. Each candidate template is only
    // appended when its leading verb isn't already the first word.
    const startsWith = (prefix: string): boolean =>
        lowerHead === prefix.toLowerCase();
    const candidates: string[] = [];
    if (words.length > 2) {
        candidates.push(words.slice(0, 2).join(" "));
    }
    if (head && head.length > 3 && !startsWith("tasks")) {
        candidates.push(`tasks about ${trimmed}`);
    }
    if (!startsWith("open")) {
        candidates.push(`open ${trimmed}`);
    }
    // Dedupe while preserving order, drop self-matches.
    const seen = new Set<string>([trimmed.toLowerCase()]);
    return candidates
        .filter((candidate) => {
            const key = candidate.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, 3);
};

interface MatchStrengthSummary {
    strong: number;
    moderate: number;
    weak: number;
    total: number;
}

/**
 * Phone-sized viewports can't fit "Find related tasks" / "Find related
 * projects" beside the input on the same row, so the wrap pushed the
 * submit button onto its own line where it sat at its natural ~140 px
 * width — looking like an orphaned half-control. Below sm the input takes
 * the full row, and the submit + optional Clear stretch full-width on the
 * next row so the AI block reads as a single cohesive unit (mirrors
 * `ResetButtonSlot` in `taskSearchPanel`).
 */
const SearchRow = styled.div`
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: ${themeSpace.xs}px;

    .ai-search-input {
        flex: 1 1 14rem;
        min-width: 0;
    }

    .ai-search-submit,
    .ai-search-clear {
        flex: 0 0 auto;
    }

    @media (max-width: ${breakpoints.sm - 1}px) {
        .ai-search-input {
            flex-basis: 100%;
        }
        .ai-search-submit,
        .ai-search-clear {
            flex: 1 1 0;
        }
    }
`;

const ReformulationTag =
    Tag.CheckableTag as unknown as React.ForwardRefExoticComponent<
        Omit<React.HTMLAttributes<HTMLSpanElement>, "onChange"> & {
            checked: boolean;
            onChange?: (checked: boolean) => void;
            children?: React.ReactNode;
        } & React.RefAttributes<HTMLSpanElement>
    >;

const summarizeMatches = (
    matches: IAiSearchMatch[] | undefined
): MatchStrengthSummary | null => {
    if (!matches || matches.length === 0) return null;
    const summary: MatchStrengthSummary = {
        strong: 0,
        moderate: 0,
        weak: 0,
        total: matches.length
    };
    for (const match of matches) {
        if (match.strength === "strong") summary.strong += 1;
        else if (match.strength === "moderate") summary.moderate += 1;
        else summary.weak += 1;
    }
    return summary;
};

const AiSearchInput: React.FC<Props> = (props) => {
    const { enabled: aiEnabled } = useAiEnabled();
    const searchAi = useAi<ISearchResult>({ route: "search" });
    const projectId =
        props.kind === "tasks" ? props.projectContext.project._id : undefined;
    const remoteAgent = useAgent("search-agent", { projectId });
    const startRemoteSearch = remoteAgent.start;
    const abortRemoteSearch = remoteAgent.abort;
    const clearRemoteSuggestion = remoteAgent.clearSuggestion;
    const remoteLastSuggestion = remoteAgent.lastSuggestion;
    const remoteError = remoteAgent.error;
    const remoteIsStreaming = remoteAgent.isStreaming;
    const isRemote = !environment.aiUseLocalEngine;
    const remoteAiConsentGranted = useRemoteAiConsent(environment.aiBaseUrl);
    const [draft, setDraft] = useState("");
    const [noMatchHint, setNoMatchHint] = useState<string | null>(null);
    const [reformulations, setReformulations] = useState<string[]>([]);
    const [matchRationale, setMatchRationale] = useState<string | null>(null);
    const [matchSummary, setMatchSummary] =
        useState<MatchStrengthSummary | null>(null);
    const [expandedTerms, setExpandedTerms] = useState<string[]>([]);
    const [boardHasItems, setBoardHasItems] = useState(true);
    const announcerId = useId();
    const semanticActive = hasActiveSemanticFilter(props.semanticIds);
    const abortRef = useRef<AbortController | null>(null);
    const lastSubmittedQueryRef = useRef("");

    useEffect(() => {
        if (!semanticActive) {
            setNoMatchHint(null);
            setReformulations([]);
            setMatchRationale(null);
            setMatchSummary(null);
            setExpandedTerms([]);
            // Filter cleared externally (chip removed, navigation away).
            // Drop the band cache too so cards stop showing strength chips.
            clearAiSearchStrengths(props.kind);
        }
    }, [props.kind, semanticActive]);

    // Abort any in-flight remote search if the component unmounts so the
    // resolved/rejected promise doesn't try to setState on an unmounted tree.
    useEffect(
        () => () => {
            abortRef.current?.abort();
            abortRemoteSearch();
            clearRemoteSuggestion();
        },
        [abortRemoteSearch, clearRemoteSuggestion]
    );

    // Compute agent suggestion payload; effect is placed after applyResult.
    const agentSearchPayload = useMemo(() => {
        const s = remoteLastSuggestion;
        if (!s || s.surface !== "search") return null;
        return s.payload as {
            ids: string[];
            matches?: IAiSearchMatch[];
            rationale: string;
            expandedTerms?: string[];
        };
    }, [remoteLastSuggestion]);

    /**
     * Track whether the underlying scope has any data at all so the
     * empty-state copy can disambiguate between "no AI hits" and "no
     * tasks at all".
     */
    useEffect(() => {
        if (props.kind === "tasks") {
            setBoardHasItems((props.projectContext.tasks?.length ?? 0) > 0);
        } else {
            setBoardHasItems((props.projectsContext.projects?.length ?? 0) > 0);
        }
    }, [props]);

    const applyResult = useCallback(
        (result: ISearchResult, query: string) => {
            if ((result.ids?.length ?? 0) === 0) {
                props.setSemanticIds(undefined);
                setMatchRationale(null);
                setMatchSummary(null);
                setExpandedTerms(result.expandedTerms ?? []);
                // Clear any stale per-result bands from a previous query so
                // an incoming empty result doesn't leave old chips on cards
                // that may still be visible from the underlying list.
                clearAiSearchStrengths(props.kind);
                setNoMatchHint(
                    result.rationale?.trim() ||
                        (boardHasItems
                            ? microcopy.feedback.noTasksMatched
                            : microcopy.feedback.boardEmpty)
                );
                setReformulations(reformulate(query));
                return;
            }
            setNoMatchHint(null);
            setReformulations([]);
            setMatchRationale(result.rationale?.trim() || null);
            setMatchSummary(summarizeMatches(result.matches));
            setExpandedTerms(result.expandedTerms ?? []);
            // Stash per-result bands so the card layer can render a small
            // strength chip on each filtered task/project.
            setAiSearchStrengths(props.kind, result.matches);
            props.setSemanticIds((result.ids ?? []).join(","));
        },
        [boardHasItems, props]
    );

    // Consume the agent's suggestion once applyResult is stable.
    useEffect(() => {
        if (!isRemote || !agentSearchPayload) return;
        const ids = agentSearchPayload.ids ?? [];
        // matches may be absent — fall back to synthetic entries with moderate strength
        const matches: IAiSearchMatch[] = agentSearchPayload.matches?.length
            ? agentSearchPayload.matches
            : ids.map((id) => ({
                  id,
                  strength: "moderate" as const
              }));
        const result: ISearchResult = {
            ids,
            matches,
            rationale: agentSearchPayload.rationale,
            expandedTerms: agentSearchPayload.expandedTerms ?? []
        };
        applyResult(result, lastSubmittedQueryRef.current);
        clearRemoteSuggestion();
    }, [agentSearchPayload, applyResult, isRemote, clearRemoteSuggestion]);

    const performSearch = useCallback(
        async (rawQuery: string) => {
            const query = rawQuery.trim();
            if (!query) return;
            if (isRemote && !remoteAiConsentGranted) return;
            // Don't disable the input. Cancel any in-flight request so
            // the latest query wins, then start a fresh one.
            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;
            setNoMatchHint(null);
            const searchPayload =
                props.kind === "tasks"
                    ? {
                          search: {
                              kind: "tasks" as const,
                              query,
                              projectContext: (props as TaskSearchProps)
                                  .projectContext
                          }
                      }
                    : (() => {
                          const ctx = (props as ProjectSearchProps)
                              .projectsContext;
                          const filtered: AiSearchProjectsContext = {
                              ...ctx,
                              projects: (ctx.projects ?? []).filter(
                                  (p) => !isProjectAiDisabled(p._id)
                              )
                          };
                          return {
                              search: {
                                  kind: "projects" as const,
                                  query,
                                  projectsContext: filtered
                              }
                          };
                      })();
            try {
                assertRunPayloadProjectsAiAllowed(searchPayload);
            } catch {
                setNoMatchHint(microcopy.ai.projectDisabled);
                return;
            }
            if (isRemote) {
                lastSubmittedQueryRef.current = query;
                void startRemoteSearch(
                    {
                        query,
                        kind: props.kind
                    },
                    { autonomy: "suggest" }
                );
                return;
            }
            let raw: ISearchResult;
            if (props.kind === "tasks") {
                const ctx = (props as TaskSearchProps).projectContext;
                raw = semanticSearch("tasks", query, ctx);
                const valid = new Set((ctx.tasks ?? []).map((t) => t._id));
                applyResult(validateSearch(raw, valid), query);
            } else {
                const projectsCtx =
                    searchPayload.search.kind === "projects"
                        ? searchPayload.search.projectsContext!
                        : (props as ProjectSearchProps).projectsContext;
                raw = semanticSearch("projects", query, projectsCtx);
                const valid = new Set(
                    (projectsCtx.projects ?? []).map((p) => p._id)
                );
                applyResult(validateSearch(raw, valid), query);
            }
        },
        [
            applyResult,
            isRemote,
            props,
            remoteAiConsentGranted,
            startRemoteSearch
        ]
    );

    const onClear = () => {
        setDraft("");
        setNoMatchHint(null);
        setReformulations([]);
        setMatchRationale(null);
        setMatchSummary(null);
        setExpandedTerms([]);
        clearAiSearchStrengths(props.kind);
        searchAi.reset();
        abortRef.current?.abort();
        abortRemoteSearch();
        clearRemoteSuggestion();
        props.setSemanticIds(undefined);
    };

    if (!aiEnabled) return null;

    const busy = isRemote ? remoteIsStreaming : searchAi.isLoading;
    const activeError = isRemote ? remoteError : searchAi.error;
    const errorView = activeError
        ? aiErrorView(activeError, microcopy.feedback.searchFailedTitle)
        : null;
    const labels =
        props.kind === "tasks"
            ? {
                  aria: microcopy.ai.findRelatedTasksAria,
                  helper: microcopy.ai.findRelatedTasksHelper,
                  placeholder: microcopy.ai.findRelatedTasksPlaceholder,
                  submit: microcopy.ai.findRelatedTasks
              }
            : {
                  aria: microcopy.ai.findRelatedProjectsAria,
                  helper: microcopy.ai.findRelatedProjectsHelper,
                  placeholder: microcopy.ai.findRelatedProjectsPlaceholder,
                  submit: microcopy.ai.findRelatedProjects
              };

    const applyReformulation = (alt: string) => {
        setDraft(alt);
        void performSearch(alt);
    };

    return (
        <div style={{ marginBottom: themeSpace.md }}>
            <CopilotRemoteConsentNotice route="search" />
            <SearchRow>
                <Input
                    allowClear={{ clearIcon: <CloseCircleFilled /> }}
                    aria-describedby={`${announcerId}-helper`}
                    aria-label={labels.aria}
                    autoComplete="off"
                    className="ai-search-input"
                    enterKeyHint="search"
                    inputMode="search"
                    onChange={(e) => setDraft(e.target.value)}
                    onPressEnter={() => void performSearch(draft)}
                    placeholder={labels.placeholder}
                    /*
                     * Sparkle prefix is the only thing that visually separates
                     * this AI input from the plain text filter that often sits
                     * directly below it. Without it the two inputs read as
                     * duplicate search boxes and users couldn't tell which one
                     * accepts a natural-language question.
                     */
                    prefix={
                        <AiSparkleIcon
                            aria-hidden
                            style={{
                                color: "var(--ant-color-primary, #EA580C)"
                            }}
                        />
                    }
                    suffix={
                        busy ? (
                            <Tag color="processing">
                                {microcopy.feedback.searchingTag}
                            </Tag>
                        ) : null
                    }
                    value={draft}
                />
                <Button
                    className="ai-search-submit"
                    disabled={!draft.trim()}
                    icon={<AiSparkleIcon aria-hidden />}
                    loading={busy}
                    onClick={() => void performSearch(draft)}
                    type="default"
                >
                    {labels.submit}
                </Button>
                {semanticActive ? (
                    <Button
                        aria-label={microcopy.actions.clearAiSearch}
                        className="ai-search-clear"
                        onClick={onClear}
                    >
                        {microcopy.actions.clearAiSearch}
                    </Button>
                ) : null}
            </SearchRow>
            <div
                style={{
                    alignItems: "center",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: themeSpace.xs,
                    marginTop: themeSpace.xs
                }}
            >
                <Typography.Paragraph
                    id={`${announcerId}-helper`}
                    style={{ marginBottom: 0 }}
                    type="secondary"
                >
                    {labels.helper}
                </Typography.Paragraph>
            </div>
            {/*
             * Polite, not assertive — search status is non-urgent
             * background information and `assertive` interrupts whatever
             * the screen reader is currently saying (e.g. the row of
             * recently rendered results), which is hostile UX.
             */}
            <SrOnlyLive id={announcerId}>
                {busy
                    ? microcopy.feedback.searching
                    : semanticActive && matchRationale
                      ? microcopy.feedback.resultsFiltered.replace(
                            "{rationale}",
                            matchRationale
                        )
                      : (noMatchHint ?? "")}
            </SrOnlyLive>
            {matchSummary && matchSummary.total > 0 && (
                <div
                    style={{
                        alignItems: "center",
                        display: "flex",
                        flexWrap: "wrap",
                        gap: themeSpace.xs,
                        marginTop: themeSpace.xs
                    }}
                >
                    {matchSummary.strong > 0 && (
                        <Tag
                            aria-label={microcopy.ai.searchMatchStrengthAria.replace(
                                "{strength}",
                                microcopy.ai.searchMatchStrength.strong
                            )}
                            color="green"
                            style={{ marginInlineEnd: 0 }}
                        >
                            {`${microcopy.ai.searchMatchStrength.strong}: ${matchSummary.strong}`}
                        </Tag>
                    )}
                    {matchSummary.moderate > 0 && (
                        <Tag
                            aria-label={microcopy.ai.searchMatchStrengthAria.replace(
                                "{strength}",
                                microcopy.ai.searchMatchStrength.moderate
                            )}
                            color="orange"
                            style={{ marginInlineEnd: 0 }}
                        >
                            {`${microcopy.ai.searchMatchStrength.moderate}: ${matchSummary.moderate}`}
                        </Tag>
                    )}
                    {matchSummary.weak > 0 && (
                        <Tag
                            aria-label={microcopy.ai.searchMatchStrengthAria.replace(
                                "{strength}",
                                microcopy.ai.searchMatchStrength.weak
                            )}
                            color="default"
                            style={{ marginInlineEnd: 0 }}
                        >
                            {`${microcopy.ai.searchMatchStrength.weak}: ${matchSummary.weak}`}
                        </Tag>
                    )}
                </div>
            )}
            {expandedTerms.length > 0 && (
                <Typography.Paragraph
                    style={{
                        fontSize: 12,
                        marginBottom: 0,
                        marginTop: themeSpace.xs,
                        maxWidth: `${maxLineLengthCh}ch` // Applied to expanded-terms prose
                    }}
                    type="secondary"
                >
                    {microcopy.ai.searchSynonymExpanded
                        .replace(
                            "{original}",
                            expandedTerms[0].split(" → ")[0] ?? ""
                        )
                        .replace(
                            "{expansions}",
                            expandedTerms
                                .map((line) => line.split(" → ")[1] ?? line)
                                .join("; ")
                        )}
                </Typography.Paragraph>
            )}
            {matchRationale && (
                <Tooltip title={matchRationale}>
                    <Typography.Paragraph
                        style={{
                            marginBottom: 0,
                            marginTop: themeSpace.xs,
                            maxWidth: `${maxLineLengthCh}ch` // Applied to rationale prose
                        }}
                        type="secondary"
                    >
                        <InfoCircleOutlined
                            aria-hidden
                            style={{ marginInlineEnd: 4 }}
                        />
                        {microcopy.ai.whyThisResult}{" "}
                        <Button
                            onClick={() =>
                                track(
                                    ANALYTICS_EVENTS.SEARCH_RESULT_RATIONALE_VIEWED
                                )
                            }
                            size="small"
                            style={{
                                borderBottom: "1px dotted currentColor",
                                borderRadius: 0,
                                height: "auto",
                                padding: 0
                            }}
                            type="link"
                        >
                            {microcopy.actions.showReasoning}
                        </Button>
                    </Typography.Paragraph>
                </Tooltip>
            )}
            {noMatchHint ? (
                <Alert
                    action={
                        <Button
                            onClick={() => void performSearch(draft)}
                            size="small"
                            type="link"
                        >
                            {microcopy.ai.retryLabel}
                        </Button>
                    }
                    closable
                    description={
                        reformulations.length > 0 ? (
                            <Space size={themeSpace.xs} wrap>
                                <span>{microcopy.ai.didYouMean}</span>
                                {reformulations.map((alt) => (
                                    <ReformulationTag
                                        checked={false}
                                        key={alt}
                                        onChange={() => applyReformulation(alt)}
                                        onKeyDown={(
                                            event: React.KeyboardEvent<HTMLSpanElement>
                                        ) => {
                                            if (
                                                event.key === "Enter" ||
                                                event.key === " "
                                            ) {
                                                event.preventDefault();
                                                applyReformulation(alt);
                                            }
                                        }}
                                        role="button"
                                        tabIndex={0}
                                    >
                                        {alt}
                                    </ReformulationTag>
                                ))}
                            </Space>
                        ) : null
                    }
                    onClose={() => setNoMatchHint(null)}
                    showIcon
                    style={{
                        marginTop: themeSpace.sm,
                        maxWidth: "40rem"
                    }}
                    title={noMatchHint}
                    type="info"
                />
            ) : null}
            {errorView ? (
                <Alert
                    action={
                        errorView.retryable ? (
                            <Button
                                onClick={() => void performSearch(draft)}
                                size="small"
                                type="link"
                            >
                                {microcopy.ai.retryLabel}
                            </Button>
                        ) : null
                    }
                    closable
                    onClose={() => {
                        if (isRemote) {
                            remoteAgent.abort();
                            remoteAgent.clearSuggestion();
                        } else {
                            searchAi.reset();
                        }
                    }}
                    style={{
                        marginTop: themeSpace.sm,
                        maxWidth: "40rem"
                    }}
                    title={errorView.heading}
                    description={errorView.body || undefined}
                    type={errorView.severity}
                />
            ) : null}
        </div>
    );
};

export default AiSearchInput;

// Exported for unit tests — the "Did you mean?" reformulator is a pure
// function and easier to pin behaviorally with a small table than via a
// full DOM harness.
export { reformulate as __testing_reformulate };
