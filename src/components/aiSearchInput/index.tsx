import { Info, X } from "lucide-react";
import React, {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState
} from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@/components/ui/tooltip";
import { Typography } from "@/components/ui/typography";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import { maxLineLengthCh, space as themeSpace } from "../../theme/tokens";
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
const SEARCH_ROW_CLASS = "flex flex-wrap items-center gap-xs";
const SEARCH_INPUT_SLOT_CLASS =
    "ai-search-input relative flex min-w-0 basis-[14rem] grow items-center max-sm:basis-full";
const SEARCH_ACTION_CLASS = "flex-none max-sm:flex-1";

type ErrorSeverity = "error" | "warning" | "info";
const severityVariant = (
    severity: ErrorSeverity
): "destructive" | "warning" | "info" =>
    severity === "error" ? "destructive" : severity;

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
    // The Alert primitive has no internal dismiss state, so track the
    // dismissed error's message here and re-show when a distinct error
    // arrives.
    const [dismissedError, setDismissedError] = useState<string | null>(null);
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
    const activeErrorKey = activeError
        ? String((activeError as Error).message ?? activeError)
        : null;
    const errorView =
        activeError && activeErrorKey !== dismissedError
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
            <div className={SEARCH_ROW_CLASS}>
                <div className={SEARCH_INPUT_SLOT_CLASS}>
                    {/*
                     * Sparkle prefix is the only thing that visually separates
                     * this AI input from the plain text filter that often sits
                     * directly below it. Without it the two inputs read as
                     * duplicate search boxes and users couldn't tell which one
                     * accepts a natural-language question.
                     */}
                    <span className="pointer-events-none absolute left-sm inline-flex text-primary">
                        <AiSparkleIcon aria-hidden />
                    </span>
                    <Input
                        aria-describedby={`${announcerId}-helper`}
                        aria-label={labels.aria}
                        autoComplete="off"
                        className="pl-[2rem] pr-[6rem]"
                        enterKeyHint="search"
                        inputMode="search"
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                void performSearch(draft);
                            }
                        }}
                        placeholder={labels.placeholder}
                        value={draft}
                    />
                    <div className="absolute right-sm flex items-center gap-xxs">
                        {busy ? (
                            <Badge variant="info">
                                {microcopy.feedback.searchingTag}
                            </Badge>
                        ) : null}
                        {draft ? (
                            <button
                                aria-label={microcopy.actions.clear}
                                className="inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                onClick={() => setDraft("")}
                                type="button"
                            >
                                <X aria-hidden className="size-4" />
                            </button>
                        ) : null}
                    </div>
                </div>
                <Button
                    className={SEARCH_ACTION_CLASS}
                    disabled={!draft.trim()}
                    loading={busy}
                    onClick={() => void performSearch(draft)}
                    variant="default"
                >
                    <AiSparkleIcon aria-hidden />
                    {labels.submit}
                </Button>
                {semanticActive ? (
                    <Button
                        aria-label={microcopy.actions.clearAiSearch}
                        className={SEARCH_ACTION_CLASS}
                        onClick={onClear}
                    >
                        {microcopy.actions.clearAiSearch}
                    </Button>
                ) : null}
            </div>
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
                <div className="mt-xs flex flex-wrap items-center gap-xs">
                    {matchSummary.strong > 0 && (
                        <Badge
                            aria-label={microcopy.ai.searchMatchStrengthAria.replace(
                                "{strength}",
                                microcopy.ai.searchMatchStrength.strong
                            )}
                            variant="success"
                        >
                            {`${microcopy.ai.searchMatchStrength.strong}: ${matchSummary.strong}`}
                        </Badge>
                    )}
                    {matchSummary.moderate > 0 && (
                        <Badge
                            aria-label={microcopy.ai.searchMatchStrengthAria.replace(
                                "{strength}",
                                microcopy.ai.searchMatchStrength.moderate
                            )}
                            variant="warning"
                        >
                            {`${microcopy.ai.searchMatchStrength.moderate}: ${matchSummary.moderate}`}
                        </Badge>
                    )}
                    {matchSummary.weak > 0 && (
                        <Badge
                            aria-label={microcopy.ai.searchMatchStrengthAria.replace(
                                "{strength}",
                                microcopy.ai.searchMatchStrength.weak
                            )}
                            variant="secondary"
                        >
                            {`${microcopy.ai.searchMatchStrength.weak}: ${matchSummary.weak}`}
                        </Badge>
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
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Typography.Paragraph
                                style={{
                                    marginBottom: 0,
                                    marginTop: themeSpace.xs,
                                    maxWidth: `${maxLineLengthCh}ch` // Applied to rationale prose
                                }}
                                type="secondary"
                            >
                                <Info
                                    aria-hidden
                                    className="mr-[4px] inline size-4 align-text-bottom"
                                />
                                {microcopy.ai.whyThisResult}{" "}
                                <Button
                                    className="h-auto rounded-none border-b border-dotted border-current p-0"
                                    onClick={() =>
                                        track(
                                            ANALYTICS_EVENTS.SEARCH_RESULT_RATIONALE_VIEWED
                                        )
                                    }
                                    size="sm"
                                    variant="link"
                                >
                                    {microcopy.actions.showReasoning}
                                </Button>
                            </Typography.Paragraph>
                        </TooltipTrigger>
                        <TooltipContent>{matchRationale}</TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}
            {noMatchHint ? (
                <Alert className="relative mt-sm max-w-[40rem]" variant="info">
                    <Info aria-hidden />
                    <AlertTitle>{noMatchHint}</AlertTitle>
                    <AlertDescription>
                        {reformulations.length > 0 ? (
                            <div className="mt-xxs flex flex-wrap items-center gap-xs">
                                <span>{microcopy.ai.didYouMean}</span>
                                {reformulations.map((alt) => (
                                    <button
                                        className="inline-flex items-center rounded-pill border border-border bg-muted px-xs py-[1px] text-xs text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                        key={alt}
                                        onClick={() => applyReformulation(alt)}
                                        onKeyDown={(event) => {
                                            if (
                                                event.key === "Enter" ||
                                                event.key === " "
                                            ) {
                                                event.preventDefault();
                                                applyReformulation(alt);
                                            }
                                        }}
                                        tabIndex={0}
                                        type="button"
                                    >
                                        {alt}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                        <div className="mt-xs flex items-center gap-xs">
                            <Button
                                className="h-auto p-0"
                                onClick={() => void performSearch(draft)}
                                size="sm"
                                variant="link"
                            >
                                {microcopy.ai.retryLabel}
                            </Button>
                        </div>
                    </AlertDescription>
                    <button
                        aria-label={microcopy.actions.close}
                        className="absolute right-md top-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setNoMatchHint(null)}
                        type="button"
                    >
                        <X aria-hidden className="size-4" />
                    </button>
                </Alert>
            ) : null}
            {errorView ? (
                <Alert
                    className="relative mt-sm max-w-[40rem]"
                    variant={severityVariant(errorView.severity)}
                >
                    <Info aria-hidden />
                    <AlertTitle>{errorView.heading}</AlertTitle>
                    {errorView.body ? (
                        <AlertDescription>{errorView.body}</AlertDescription>
                    ) : null}
                    {errorView.retryable ? (
                        <AlertDescription>
                            <Button
                                className="h-auto p-0"
                                onClick={() => void performSearch(draft)}
                                size="sm"
                                variant="link"
                            >
                                {microcopy.ai.retryLabel}
                            </Button>
                        </AlertDescription>
                    ) : null}
                    <button
                        aria-label={microcopy.actions.close}
                        className="absolute right-md top-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => {
                            setDismissedError(activeErrorKey);
                            if (isRemote) {
                                remoteAgent.abort();
                                remoteAgent.clearSuggestion();
                            } else {
                                searchAi.reset();
                            }
                        }}
                        type="button"
                    >
                        <X aria-hidden className="size-4" />
                    </button>
                </Alert>
            ) : null}
        </div>
    );
};

export default AiSearchInput;

// Exported for unit tests — the "Did you mean?" reformulator is a pure
// function and easier to pin behaviorally with a small table than via a
// full DOM harness.
export { reformulate as __testing_reformulate };
