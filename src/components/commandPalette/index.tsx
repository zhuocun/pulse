import { useIsFetching } from "@tanstack/react-query";
import {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState
} from "react";
import { useNavigate } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle
} from "@/components/ui/sheet";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import { breakpoints } from "../../theme/tokens";
import SrOnlyLive from "../../utils/a11y/SrOnlyLive";
import useCachedQueryData, {
    useGatheredCachedList
} from "../../utils/hooks/useCachedQueryData";
import useIsPhoneChrome from "../../utils/hooks/useIsPhoneChrome";
import useKeyboardOpen from "../../utils/hooks/useKeyboardOpen";
import useTaskModal from "../../utils/hooks/useTaskModal";
import useTaskPanelNavigation from "../../utils/hooks/useTaskPanelNavigation";
import { isMacLike } from "../../utils/platform";
import AiSparkleIcon from "../aiSparkleIcon";
import GlassPanel from "../glassPanel";

interface CommandPaletteProps {
    open: boolean;
    onClose: () => void;
}

/**
 * Viewport-width predicate replacing antd `Grid.useBreakpoint().md`. The
 * palette flips to the bottom-sheet layout below the `md` (768px) token
 * breakpoint. Defaults to wide (desktop) when `matchMedia` is unavailable
 * (SSR / older jsdom), matching the legacy Grid default.
 */
const useIsWideViewport = (): boolean => {
    const query = `(min-width: ${breakpoints.md}px)`;
    const [wide, setWide] = useState<boolean>(() => {
        if (
            typeof window === "undefined" ||
            typeof window.matchMedia !== "function"
        ) {
            return true;
        }
        return window.matchMedia(query).matches;
    });
    useEffect(() => {
        if (
            typeof window === "undefined" ||
            typeof window.matchMedia !== "function"
        ) {
            return;
        }
        const media = window.matchMedia(query);
        const handler = (event: MediaQueryListEvent) => setWide(event.matches);
        if (typeof media.addEventListener === "function") {
            media.addEventListener("change", handler);
            return () => media.removeEventListener("change", handler);
        }
        media.addListener(handler);
        return () => media.removeListener(handler);
    }, [query]);
    return wide;
};

interface PaletteEntry {
    id: string;
    label: string;
    sublabel?: string;
    kind: "project" | "section" | "task" | "column" | "member";
    href?: string;
    /**
     * Task entries carry the raw taskId + projectId so the selection
     * handler can open the routed task panel (Phase 3 A2) when the
     * `taskPanelRouted` flag is on; otherwise it falls back to opening
     * the legacy modal via `useTaskModal`.
     */
    taskId?: string;
    projectId?: string;
    /** Score components used to rank fuzzy matches. */
    rankBoost?: number;
}

/* -- Surface class recipes --------------------------------------------- */

/**
 * Results list. `50dvh` cap keeps the list from jumping when the iOS
 * Safari URL bar collapses. Bottom padding + thin scrollbar so the last
 * row isn't flush-clipped against the modal edge with no scroll cue.
 */
const LIST_CONTAINER_CLASS = cn(
    "m-0 max-h-[50dvh] list-none overflow-y-auto overscroll-contain p-0 pb-sm",
    "[scrollbar-width:thin] [scrollbar-color:var(--pulse-fill-secondary)_transparent]",
    "[&::-webkit-scrollbar]:w-[8px]",
    "[&::-webkit-scrollbar-thumb]:rounded-pill [&::-webkit-scrollbar-thumb]:bg-[var(--pulse-fill-secondary)]"
);

const KIND_GROUP_CLASS = cn(
    "mb-xxs mt-xs px-sm text-xs font-semibold",
    "[color:var(--pulse-text-secondary,rgba(15,23,42,0.65))]"
);

const rowClass = (active: boolean): string =>
    cn(
        "flex min-w-0 cursor-pointer items-center gap-sm rounded-md px-sm py-xs",
        active
            ? "[background:var(--pulse-brand-primary-bg,rgba(234,88,12,0.10))]"
            : "bg-transparent"
    );

const ENTRY_TEXT_CLASS =
    "flex min-w-0 flex-[1_1_auto] flex-wrap gap-x-xs gap-y-xxs overflow-hidden";

const ENTRY_LABEL_CLASS = "min-w-0 font-medium [overflow-wrap:anywhere]";

const ENTRY_SUBLABEL_CLASS = "min-w-0 [overflow-wrap:anywhere]";

const MODE_BANNER_CLASS = cn(
    "mt-sm flex items-center gap-xs rounded-md border px-sm py-xs text-xs",
    "[background:var(--color-copilot-bg-subtle)]",
    "border-[color:var(--color-copilot-bg-medium)]",
    "[color:var(--pulse-text-secondary,rgba(15,23,42,0.65))]"
);

const SAMPLE_PROMPT_ROW_CLASS = cn(
    "block w-full cursor-pointer rounded-md border-0 bg-transparent px-sm py-xs text-left",
    "hover:[background:var(--pulse-fill-tertiary,rgba(15,23,42,0.04))]",
    "focus-visible:[background:var(--pulse-fill-tertiary,rgba(15,23,42,0.04))]"
);

/**
 * Bottom-pinned search dock. Sits above the safe-area inset and lifts
 * above the soft keyboard via `env(keyboard-inset-height)`. When the
 * keyboard owns the safe area the resting inset is dropped so the field
 * doesn't float over it.
 */
const PHONE_DOCK_CLASS = cn(
    "flex-shrink-0 pt-sm",
    "[transition:padding-bottom_var(--pulse-duration-medium)_var(--pulse-ease-standard)]",
    "motion-reduce:[transition:none]"
);

const phoneDockPaddingClass = (keyboardOpen: boolean): string =>
    keyboardOpen
        ? "[padding-bottom:max(theme(spacing.sm),env(keyboard-inset-height,0px))]"
        : "[padding-bottom:max(theme(spacing.sm),env(keyboard-inset-height,0px),env(safe-area-inset-bottom))]";

/**
 * Sparkle AI-mode toggle that sits inside the search field. Coarse-safe
 * 44px hit area; the active state tints with the copilot medium wash.
 */
const sparkleToggleClass = (aiMode: boolean): string =>
    cn(
        "inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-full border-0 p-[4px] leading-none",
        aiMode
            ? "[background:var(--color-copilot-bg-medium)]"
            : "bg-transparent"
    );

/** Strip the Input's own chrome when it nests inside the glass capsule. */
const CHROMELESS_INPUT_CLASS =
    "border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0";

/*
 * Per-project section routes indexed alongside the project itself. On
 * phone chrome the board route hides the project breadcrumb bar, so the
 * palette is the guaranteed way to reach these surfaces by touch.
 */
const PROJECT_SECTION_SEGMENTS = [
    "members",
    "milestones",
    "labels",
    "reports"
] as const;

const indexEntries = (
    projects: IProject[],
    tasks: ITask[],
    columns: IColumn[],
    members: IMember[]
): PaletteEntry[] => {
    const out: PaletteEntry[] = [];
    for (const p of projects) {
        out.push({
            id: `project:${p._id}`,
            label: p.projectName,
            sublabel: p.organization,
            kind: "project",
            href: `/projects/${p._id}`,
            rankBoost: 0
        });
    }
    for (const p of projects) {
        for (const segment of PROJECT_SECTION_SEGMENTS) {
            out.push({
                id: `section:${p._id}:${segment}`,
                label: microcopy.labels[segment],
                sublabel: p.projectName,
                kind: "section",
                href: `/projects/${p._id}/${segment}`,
                rankBoost: 1
            });
        }
    }
    for (const c of columns) {
        out.push({
            id: `column:${c._id}`,
            label: c.columnName,
            sublabel: microcopy.commandPalette.sublabelColumn,
            kind: "column",
            href: c.projectId ? `/projects/${c.projectId}` : undefined,
            rankBoost: 6
        });
    }
    for (const t of tasks) {
        out.push({
            id: `task:${t._id}`,
            label: t.taskName,
            sublabel: t.epic,
            kind: "task",
            href: t.projectId ? `/projects/${t.projectId}` : undefined,
            taskId: t._id,
            projectId: t.projectId,
            rankBoost: 3
        });
    }
    for (const m of members) {
        out.push({
            id: `member:${m._id}`,
            label: m.username,
            sublabel: m.email,
            kind: "member",
            rankBoost: 9
        });
    }
    return out;
};

/**
 * Fuzzy ranking (PRD CP-R4). Scoring rules — lower is better:
 *   - Prefix match on label: 0
 *   - Substring on label/sublabel: index in haystack + 1
 *   - Token match (any whitespace-delimited word starts with q): 50 + idx
 *   - No match: skipped
 *
 * Ties broken by `rankBoost` (project < task < column < member). The
 * caller groups the resulting list by `kind` so the UI renders headers.
 */
const filterEntries = (
    entries: PaletteEntry[],
    rawQuery: string
): PaletteEntry[] => {
    const q = rawQuery.trim().toLowerCase();
    if (!q) return entries.slice(0, 20);
    const ranked: Array<{ entry: PaletteEntry; score: number }> = [];
    for (const entry of entries) {
        const label = entry.label.toLowerCase();
        const sublabel = (entry.sublabel ?? "").toLowerCase();
        let score = -1;
        if (label.startsWith(q)) {
            score = 0;
        } else {
            const idxLabel = label.indexOf(q);
            if (idxLabel >= 0) {
                score = idxLabel + 1;
            } else {
                const idxSub = sublabel.indexOf(q);
                if (idxSub >= 0) {
                    score = idxSub + 10;
                } else {
                    const tokens = `${label} ${sublabel}`.split(/\s+/);
                    const tokenIdx = tokens.findIndex((token) =>
                        token.startsWith(q)
                    );
                    if (tokenIdx >= 0) {
                        score = 50 + tokenIdx;
                    }
                }
            }
        }
        if (score >= 0) {
            ranked.push({
                entry,
                score: score + (entry.rankBoost ?? 0)
            });
        }
    }
    ranked.sort((a, b) => a.score - b.score);
    return ranked.slice(0, 20).map((row) => row.entry);
};

interface RenderedRow {
    type: "row";
    entry: PaletteEntry;
}
interface RenderedHeader {
    type: "header";
    label: string;
}
type RenderedItem = RenderedRow | RenderedHeader;

const KIND_ORDER: PaletteEntry["kind"][] = [
    "project",
    "section",
    "task",
    "column",
    "member"
];

/** Group rows by kind only when results span more than one kind. */
const groupByKind = (entries: PaletteEntry[]): RenderedItem[] => {
    const kinds = new Set(entries.map((e) => e.kind));
    if (kinds.size <= 1) {
        return entries.map((entry) => ({ type: "row", entry }));
    }
    const kindLabel = microcopy.commandPalette.kindLabels;
    const out: RenderedItem[] = [];
    for (const kind of KIND_ORDER) {
        const group = entries.filter((e) => e.kind === kind);
        if (group.length === 0) continue;
        out.push({ type: "header", label: kindLabel[kind] });
        for (const entry of group) {
            out.push({ type: "row", entry });
        }
    }
    return out;
};

/**
 * Command palette (PRD §7.1, v3 §6.7). Navigation by default; AI mode
 * activates when the query starts with "/" at index 0 or when the user
 * clicks the sparkle toggle. Enter in AI mode dispatches a custom event
 * that the board / project pages handle by opening the chat drawer with
 * the input pre-populated.
 *
 * Mobile (CP-R5): below the `md` breakpoint the palette renders as an
 * AntD bottom-sheet Drawer with the same search + results semantics.
 */
const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose }) => {
    const navigate = useNavigate();
    const { startEditing } = useTaskModal();
    const { openTask } = useTaskPanelNavigation();
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [query, setQuery] = useState("");
    const [aiMode, setAiMode] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const listboxId = useId();
    const announcerId = useId();
    const isWide = useIsWideViewport();
    const keyboardOpen = useKeyboardOpen();
    const isPhoneChrome = useIsPhoneChrome();

    const projects = useGatheredCachedList<IProject>(["projects"]);
    const members = useCachedQueryData<IMember[]>(["users/members"]) ?? [];
    const tasksCache = useGatheredCachedList<ITask>(["tasks"]);
    const boardsCache = useGatheredCachedList<IColumn>(["boards"]);

    const entries = useMemo(
        () => indexEntries(projects, tasksCache, boardsCache, members),
        [projects, tasksCache, boardsCache, members]
    );

    /**
     * Cold-cache detection (P3-3). The palette reads cached query data; on
     * first visit before any board/project page has populated the cache,
     * those queries may still be fetching. Surface a "Loading…" state
     * instead of "No matches" so users don't think the palette is broken.
     * `useIsFetching` returns the count of in-flight queries matching
     * each prefix; sum > 0 means we're waiting on at least one source.
     */
    const projectsFetching = useIsFetching({ queryKey: ["projects"] });
    const tasksFetching = useIsFetching({ queryKey: ["tasks"] });
    const boardsFetching = useIsFetching({ queryKey: ["boards"] });
    const membersFetching = useIsFetching({ queryKey: ["users/members"] });
    const isAnyFetching =
        projectsFetching + tasksFetching + boardsFetching + membersFetching > 0;
    const isColdCache = isAnyFetching && entries.length === 0;

    /**
     * Visible navigation results. CP-R11: trim before filtering so a
     * leading space isn't a false miss. CP-R7: only treat the leading
     * "/" as the AI sigil — embedded slashes (e.g. "v2/api") are normal
     * substring matches.
     */
    const visible = useMemo(() => {
        if (aiMode) return [];
        const trimmed = query.trim();
        const q = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
        return filterEntries(entries, q);
    }, [aiMode, entries, query]);

    const renderedItems = useMemo(() => groupByKind(visible), [visible]);
    /** Indices of `renderedItems` that are selectable rows (skip headers). */
    const selectableIndices = useMemo(
        () =>
            renderedItems
                .map((item, idx) => (item.type === "row" ? idx : -1))
                .filter((idx) => idx >= 0),
        [renderedItems]
    );

    useEffect(() => {
        if (!open) return;
        track(ANALYTICS_EVENTS.PALETTE_OPENED);
        setQuery("");
        setAiMode(false);
        setActiveIndex(0);
        const handle = window.setTimeout(() => {
            inputRef.current?.focus();
        }, 0);
        return () => window.clearTimeout(handle);
    }, [open]);

    /**
     * Reset active index when results change so the highlight never points
     * past the end of the list. Snaps to the first selectable row.
     */
    useEffect(() => {
        if (selectableIndices.length === 0) {
            setActiveIndex(-1);
            return;
        }
        if (activeIndex < 0 || activeIndex >= renderedItems.length) {
            setActiveIndex(selectableIndices[0]);
            return;
        }
        if (renderedItems[activeIndex]?.type !== "row") {
            setActiveIndex(selectableIndices[0]);
        }
    }, [activeIndex, renderedItems, selectableIndices]);

    const handleEntrySelect = useCallback(
        (entry: PaletteEntry) => {
            // Task entries land on the target task itself, not just the
            // project (Phase 3 A2). Flag-aware: routed panel when the
            // `taskPanelRouted` flag is on, legacy modal when off. In
            // both branches we still navigate to the project URL first
            // so non-task surfaces (column/member) keep their behavior.
            if (entry.kind === "task" && entry.taskId && entry.projectId) {
                if (environment.taskPanelRouted) {
                    openTask(entry.taskId, entry.projectId);
                } else {
                    if (entry.href) {
                        navigate(entry.href, { viewTransition: true });
                    }
                    startEditing(entry.taskId);
                }
                onClose();
                return;
            }
            if (entry.href) {
                navigate(entry.href, { viewTransition: true });
            }
            onClose();
        },
        [navigate, onClose, openTask, startEditing]
    );

    /**
     * AI invocation (CP-R6). Dispatches a `boardCopilot:openChat` custom
     * event that the board / project pages handle by opening the chat
     * drawer with the input pre-populated.
     */
    const dispatchAiPrompt = useCallback(
        (prompt: string) => {
            track(ANALYTICS_EVENTS.COPILOT_PALETTE_INVOKE, {
                length: prompt.length
            });
            if (typeof window !== "undefined") {
                window.dispatchEvent(
                    new CustomEvent("boardCopilot:openChat", {
                        detail: { prompt }
                    })
                );
            }
            onClose();
        },
        [onClose]
    );

    const toggleAiMode = useCallback((next?: boolean) => {
        setAiMode((prev) => {
            const value = next === undefined ? !prev : next;
            track(ANALYTICS_EVENTS.PALETTE_AI_MODE_TOGGLED, { next: value });
            return value;
        });
    }, []);

    const handleQueryChange = useCallback((value: string) => {
        setQuery(value);
        // CP-R2 + CP-R7: AI mode tracks ONLY the leading "/" character.
        // A trailing or interior "/" leaves the mode untouched, and
        // deleting back through the "/" turns AI mode off.
        if (value.startsWith("/")) {
            setAiMode(true);
        } else {
            setAiMode(false);
        }
    }, []);

    const moveActive = useCallback(
        (delta: 1 | -1) => {
            if (selectableIndices.length === 0) return;
            const cursor = selectableIndices.indexOf(activeIndex);
            const nextCursor =
                cursor < 0
                    ? 0
                    : (cursor + delta + selectableIndices.length) %
                      selectableIndices.length;
            setActiveIndex(selectableIndices[nextCursor]);
        },
        [activeIndex, selectableIndices]
    );

    const handleKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "ArrowDown") {
                event.preventDefault();
                moveActive(1);
                return;
            }
            if (event.key === "ArrowUp") {
                event.preventDefault();
                moveActive(-1);
                return;
            }
            if (event.key === "Enter") {
                if (aiMode) {
                    const trimmed = query.trim().replace(/^\//, "").trim();
                    if (trimmed.length > 0) {
                        event.preventDefault();
                        dispatchAiPrompt(trimmed);
                    }
                    return;
                }
                const item = renderedItems[activeIndex];
                if (item && item.type === "row") {
                    event.preventDefault();
                    handleEntrySelect(item.entry);
                }
            }
        },
        [
            activeIndex,
            aiMode,
            dispatchAiPrompt,
            handleEntrySelect,
            moveActive,
            query,
            renderedItems
        ]
    );

    const shortcutText = isMacLike() ? "Cmd+K" : "Ctrl+K";
    const isMobile = !isWide;
    /*
     * The full nav placeholder enumerates every entry kind and clips
     * inside the phone search capsule, so narrow viewports get a short
     * variant instead.
     */
    const placeholder = aiMode
        ? microcopy.placeholders.commandPaletteAi
        : isMobile
          ? microcopy.placeholders.commandPaletteNavShort
          : microcopy.placeholders.commandPaletteNav;
    const resultCount = visible.length;

    const renderSearchField = (chromeless: boolean) => (
        <div
            aria-controls={listboxId}
            aria-expanded={!aiMode && resultCount > 0}
            aria-haspopup="listbox"
            aria-owns={listboxId}
            role="combobox"
        >
            <div className="relative flex w-full items-center">
                <span className="absolute left-xs top-1/2 z-[1] -translate-y-1/2">
                    <button
                        aria-label={
                            aiMode
                                ? microcopy.a11y.exitBoardCopilotMode
                                : microcopy.a11y.switchToBoardCopilot
                        }
                        aria-pressed={aiMode}
                        className={sparkleToggleClass(aiMode)}
                        onClick={() => toggleAiMode()}
                        type="button"
                    >
                        <AiSparkleIcon aria-hidden />
                    </button>
                </span>
                <Input
                    aria-activedescendant={
                        renderedItems[activeIndex]?.type === "row"
                            ? `entry-${(renderedItems[activeIndex] as RenderedRow).entry.id}`
                            : undefined
                    }
                    aria-autocomplete="list"
                    aria-controls={listboxId}
                    aria-label={placeholder}
                    autoComplete="off"
                    className={cn(
                        "pl-[52px]",
                        chromeless && CHROMELESS_INPUT_CLASS
                    )}
                    enterKeyHint="search"
                    inputMode="search"
                    onChange={(event) => handleQueryChange(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    ref={inputRef}
                    value={query}
                />
            </div>
        </div>
    );

    const renderResults = () => (
        <>
            <SrOnlyLive id={announcerId}>
                {aiMode
                    ? microcopy.a11y.boardCopilotModeAnnouncement
                    : query.trim().length > 0
                      ? (resultCount === 1
                            ? microcopy.counts.results.one
                            : microcopy.counts.results.other
                        ).replace("{count}", String(resultCount))
                      : ""}
            </SrOnlyLive>
            {aiMode ? (
                <div className={MODE_BANNER_CLASS} role="status">
                    <AiSparkleIcon aria-hidden />
                    <span>
                        {microcopy.ai.askCopilot}.{" "}
                        {microcopy.commandPalette.copilotPromptHint}
                    </span>
                </div>
            ) : (
                <ul
                    aria-labelledby={`${listboxId}-label`}
                    className={LIST_CONTAINER_CLASS}
                    id={listboxId}
                    role="listbox"
                >
                    {renderedItems.length === 0 ? (
                        <>
                            <Typography.Paragraph
                                aria-busy={isColdCache || undefined}
                                aria-live="polite"
                                type="secondary"
                            >
                                {isColdCache
                                    ? microcopy.empty.commandPalette.loading
                                    : microcopy.empty.commandPalette.empty}
                            </Typography.Paragraph>
                            {/* P3-A: No-results → "Ask Board Copilot" CTA */}
                            {!isColdCache && query.trim().length >= 3 && (
                                <div className="border-t border-[color:var(--pulse-border-secondary)] px-sm py-xs">
                                    <Button
                                        onClick={() => {
                                            dispatchAiPrompt(query.trim());
                                        }}
                                        size="sm"
                                        variant="link"
                                    >
                                        <AiSparkleIcon aria-hidden />
                                        {
                                            microcopy.commandPalette
                                                .noResultsCopilotCta
                                        }
                                    </Button>
                                </div>
                            )}
                        </>
                    ) : (
                        renderedItems.map((item, index) => {
                            if (item.type === "header") {
                                return (
                                    <li
                                        className={KIND_GROUP_CLASS}
                                        key={`header-${item.label}`}
                                        role="presentation"
                                    >
                                        {item.label}
                                    </li>
                                );
                            }
                            const entry = item.entry;
                            return (
                                // APG combobox pattern: keyboard interaction
                                // lives on the combobox <input> above (Arrow
                                // keys move `activeIndex`, Enter selects via
                                // `handleKeyDown`). This option row only needs
                                // the pointer affordances — a per-row key
                                // handler would be a second, conflicting
                                // keyboard surface.
                                // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                                <li
                                    aria-selected={index === activeIndex}
                                    className={rowClass(index === activeIndex)}
                                    id={`entry-${entry.id}`}
                                    key={entry.id}
                                    onClick={() => handleEntrySelect(entry)}
                                    onMouseEnter={() => setActiveIndex(index)}
                                    role="option"
                                >
                                    <Badge
                                        className="flex-none"
                                        variant="secondary"
                                    >
                                        {
                                            microcopy.commandPalette.kindTags[
                                                entry.kind
                                            ]
                                        }
                                    </Badge>
                                    <span className={ENTRY_TEXT_CLASS}>
                                        <span className={ENTRY_LABEL_CLASS}>
                                            {entry.label}
                                        </span>
                                        {entry.sublabel ? (
                                            <Typography.Text
                                                className={ENTRY_SUBLABEL_CLASS}
                                                type="secondary"
                                            >
                                                {entry.sublabel}
                                            </Typography.Text>
                                        ) : null}
                                    </span>
                                </li>
                            );
                        })
                    )}
                </ul>
            )}
            {aiMode && (
                <ul
                    aria-label={microcopy.a11y.samplePrompts}
                    className={LIST_CONTAINER_CLASS}
                >
                    {microcopy.commandPalette.sampleAi.map((prompt) => (
                        <li key={prompt}>
                            <button
                                className={SAMPLE_PROMPT_ROW_CLASS}
                                onClick={() => dispatchAiPrompt(prompt)}
                                type="button"
                            >
                                <Typography.Text>{prompt}</Typography.Text>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </>
    );

    const titleNode = (
        <span className="inline-flex items-center gap-xs">
            <AiSparkleIcon aria-hidden />
            <span className="font-semibold">
                {microcopy.commandPalette.title}
            </span>
            {/* Coarse-pointer chrome has no hardware keyboard — the
             * Cmd/Ctrl+K hint only makes sense where one exists. */}
            {!isPhoneChrome && (
                <Typography.Text type="secondary">
                    {shortcutText}
                </Typography.Text>
            )}
        </span>
    );

    const hiddenLabel = (
        <span className="sr-only" id={`${listboxId}-label`}>
            {microcopy.commandPalette.navigateInstructions}
        </span>
    );

    if (isMobile) {
        return (
            <Sheet
                open={open}
                onOpenChange={(next) => {
                    if (!next) onClose();
                }}
            >
                <SheetContent
                    aria-describedby={`${listboxId}-label`}
                    className="flex h-[88dvh] max-h-[88dvh] flex-col gap-0 p-0"
                    side="bottom"
                >
                    <SheetHeader className="border-b border-border px-lg py-md">
                        <SheetTitle>{titleNode}</SheetTitle>
                    </SheetHeader>
                    {/*
                     * Phone chassis (iOS 26 bottom-anchored search): results
                     * grow upward from the thumb-anchored search dock.
                     */}
                    <div className="flex min-h-0 flex-1 flex-col px-lg">
                        {hiddenLabel}
                        <div className="flex min-h-0 flex-[1_1_auto] flex-col justify-end overflow-y-auto overscroll-contain">
                            {renderResults()}
                        </div>
                        <div
                            className={cn(
                                PHONE_DOCK_CLASS,
                                phoneDockPaddingClass(keyboardOpen)
                            )}
                        >
                            <GlassPanel
                                className="flex min-h-[50px] items-center rounded-pill px-xs"
                                intensity="regular"
                            >
                                {renderSearchField(true)}
                            </GlassPanel>
                        </div>
                    </div>
                </SheetContent>
            </Sheet>
        );
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onClose();
            }}
        >
            <DialogContent
                aria-describedby={`${listboxId}-label`}
                className="max-w-[560px]"
            >
                <DialogHeader>
                    <DialogTitle>{titleNode}</DialogTitle>
                </DialogHeader>
                {hiddenLabel}
                {renderSearchField(false)}
                {renderResults()}
            </DialogContent>
        </Dialog>
    );
};

export default CommandPalette;
