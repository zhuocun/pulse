import styled from "@emotion/styled";
import { useIsFetching } from "@tanstack/react-query";
import { Button, Drawer, Grid, Input, Modal, Tag, Typography } from "antd";
import {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState
} from "react";
import { useNavigate } from "react-router";

import { ANALYTICS_EVENTS, track } from "../../constants/analytics";
import { microcopy } from "../../constants/microcopy";
import { fontSize, fontWeight, radius, space } from "../../theme/tokens";
import useCachedQueryData, {
    useGatheredCachedList
} from "../../utils/hooks/useCachedQueryData";
import { isMacLike } from "../../utils/platform";
import AiSparkleIcon from "../aiSparkleIcon";

interface CommandPaletteProps {
    open: boolean;
    onClose: () => void;
    /**
     * P1-A / P3-A: optional callback invoked when the user wants to open
     * Board Copilot with a pre-filled query. When provided:
     *   - AI mode (Enter) calls this instead of dispatching the legacy
     *     `boardCopilot:openChat` custom event (keeps backward compat).
     *   - No-results state (query ≥ 3 chars) shows a "Try asking Board
     *     Copilot" CTA that calls this with the current query.
     */
    onOpenCopilot?: (query: string) => void;
}

interface PaletteEntry {
    id: string;
    label: string;
    sublabel?: string;
    kind: "project" | "task" | "column" | "member";
    href?: string;
    /** Score components used to rank fuzzy matches. */
    rankBoost?: number;
}

const ListContainer = styled.ul`
    list-style: none;
    margin: 0;
    /* Dynamic viewport unit keeps the list from jumping when the iOS Safari
     * URL bar collapses. The vh declaration stays as a fallback. */
    max-height: 50vh;
    max-height: 50dvh;
    overflow-y: auto;
    padding: 0;
`;

const KindGroup = styled.li`
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65));
    font-size: ${fontSize.xs}px;
    font-weight: ${fontWeight.semibold};
    letter-spacing: 0.04em;
    margin: ${space.xs}px 0 ${space.xxs}px;
    padding: 0 ${space.sm}px;
    text-transform: uppercase;
`;

const Row = styled.li<{ active: boolean }>`
    align-items: center;
    background: ${(props) =>
        props.active
            ? "var(--ant-color-primary-bg, rgba(234, 88, 12, 0.10))"
            : "transparent"};
    border-radius: ${radius.md}px;
    cursor: pointer;
    display: flex;
    gap: ${space.sm}px;
    padding: ${space.xs}px ${space.sm}px;
`;

const KindTag = styled(Tag)`
    && {
        font-size: ${fontSize.xs}px;
        margin-inline-end: 0;
        text-transform: capitalize;
    }
`;

const ModeBanner = styled.div`
    align-items: center;
    background: var(--color-copilot-bg-subtle);
    border: 1px solid var(--color-copilot-bg-medium);
    border-radius: ${radius.md}px;
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65));
    display: flex;
    font-size: ${fontSize.xs}px;
    gap: ${space.xs}px;
    margin-top: ${space.sm}px;
    padding: ${space.xs}px ${space.sm}px;
`;

const HiddenLabel = styled.span`
    border: 0;
    clip: rect(0 0 0 0);
    height: 1px;
    margin: -1px;
    overflow: hidden;
    padding: 0;
    position: absolute;
    width: 1px;
`;

const SamplePromptRow = styled.button`
    background: transparent;
    border: 0;
    border-radius: ${radius.md}px;
    cursor: pointer;
    display: block;
    padding: ${space.xs}px ${space.sm}px;
    text-align: left;
    width: 100%;

    &:hover,
    &:focus-visible {
        background: var(--ant-color-fill-tertiary, rgba(15, 23, 42, 0.04));
    }
`;

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
const CommandPalette: React.FC<CommandPaletteProps> = ({
    open,
    onClose,
    onOpenCopilot
}) => {
    const navigate = useNavigate();
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [query, setQuery] = useState("");
    const [aiMode, setAiMode] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const listboxId = useId();
    const announcerId = useId();
    const screens = Grid.useBreakpoint();

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
            if (entry.href) {
                navigate(entry.href, { viewTransition: true });
            }
            onClose();
        },
        [navigate, onClose]
    );

    /**
     * AI invocation (CP-R6 / P1-A). When `onOpenCopilot` is provided (P1-A),
     * calls it directly so the parent can open the CopilotShell Chat tab with
     * the prompt pre-filled. Falls back to dispatching the legacy
     * `boardCopilot:openChat` custom event so non-board routes continue
     * to work without changes.
     */
    const dispatchAiPrompt = useCallback(
        (prompt: string) => {
            track(ANALYTICS_EVENTS.COPILOT_PALETTE_INVOKE, {
                length: prompt.length
            });
            if (onOpenCopilot) {
                // P1-A: route through the Copilot shell prop when available
                onClose();
                onOpenCopilot(prompt);
            } else {
                // Legacy fallback: custom event for non-board routes
                if (typeof window !== "undefined") {
                    window.dispatchEvent(
                        new CustomEvent("boardCopilot:openChat", {
                            detail: { prompt }
                        })
                    );
                }
                onClose();
            }
        },
        [onClose, onOpenCopilot]
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
    const placeholder = aiMode
        ? microcopy.placeholders.commandPaletteAi
        : microcopy.placeholders.commandPaletteNav;
    const isMobile = !screens.md;
    const resultCount = visible.length;

    const renderBody = () => (
        <>
            <HiddenLabel id={`${listboxId}-label`}>
                {microcopy.commandPalette.navigateInstructions}
            </HiddenLabel>
            <div
                aria-controls={listboxId}
                aria-expanded={!aiMode && resultCount > 0}
                aria-haspopup="listbox"
                aria-owns={listboxId}
                role="combobox"
            >
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
                    enterKeyHint="search"
                    inputMode="search"
                    onChange={(event) => handleQueryChange(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    prefix={
                        <button
                            aria-label={
                                aiMode
                                    ? microcopy.a11y.exitBoardCopilotMode
                                    : microcopy.a11y.switchToBoardCopilot
                            }
                            aria-pressed={aiMode}
                            onClick={() => toggleAiMode()}
                            style={{
                                background: aiMode
                                    ? "var(--color-copilot-bg-medium)"
                                    : "transparent",
                                border: 0,
                                borderRadius: 999,
                                cursor: "pointer",
                                lineHeight: 0,
                                minHeight: 44,
                                minWidth: 44,
                                padding: 4
                            }}
                            type="button"
                        >
                            <AiSparkleIcon aria-hidden />
                        </button>
                    }
                    ref={(node) => {
                        inputRef.current = node?.input ?? null;
                    }}
                    size="large"
                    value={query}
                />
            </div>
            <span
                aria-live="polite"
                id={announcerId}
                style={{
                    border: 0,
                    clip: "rect(0 0 0 0)",
                    height: 1,
                    margin: -1,
                    overflow: "hidden",
                    padding: 0,
                    position: "absolute",
                    width: 1
                }}
            >
                {aiMode
                    ? microcopy.a11y.boardCopilotModeAnnouncement
                    : query.trim().length > 0
                      ? (resultCount === 1
                            ? microcopy.counts.results.one
                            : microcopy.counts.results.other
                        ).replace("{count}", String(resultCount))
                      : ""}
            </span>
            {aiMode ? (
                <ModeBanner role="status">
                    <AiSparkleIcon aria-hidden />
                    <span>
                        {microcopy.ai.askCopilot}.{" "}
                        {microcopy.commandPalette.copilotPromptHint}
                    </span>
                </ModeBanner>
            ) : (
                <ListContainer
                    aria-labelledby={`${listboxId}-label`}
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
                            {!isColdCache &&
                                onOpenCopilot &&
                                query.trim().length >= 3 && (
                                    <div
                                        style={{
                                            borderTop:
                                                "1px solid var(--ant-color-border-secondary)",
                                            padding: `${space.xs}px ${space.sm}px`
                                        }}
                                    >
                                        <Button
                                            icon={<AiSparkleIcon aria-hidden />}
                                            onClick={() => {
                                                const trimmed = query.trim();
                                                onClose();
                                                onOpenCopilot(trimmed);
                                            }}
                                            size="small"
                                            type="link"
                                        >
                                            Try asking Board Copilot →
                                        </Button>
                                    </div>
                                )}
                        </>
                    ) : (
                        renderedItems.map((item, index) => {
                            if (item.type === "header") {
                                return (
                                    <KindGroup
                                        key={`header-${item.label}`}
                                        role="presentation"
                                    >
                                        {item.label}
                                    </KindGroup>
                                );
                            }
                            const entry = item.entry;
                            return (
                                <Row
                                    active={index === activeIndex}
                                    aria-selected={index === activeIndex}
                                    id={`entry-${entry.id}`}
                                    key={entry.id}
                                    onClick={() => handleEntrySelect(entry)}
                                    onMouseEnter={() => setActiveIndex(index)}
                                    role="option"
                                >
                                    <KindTag color="default">
                                        {
                                            microcopy.commandPalette.kindTags[
                                                entry.kind
                                            ]
                                        }
                                    </KindTag>
                                    <span>
                                        <span
                                            style={{
                                                fontWeight: fontWeight.medium
                                            }}
                                        >
                                            {entry.label}
                                        </span>
                                        {entry.sublabel ? (
                                            <Typography.Text
                                                style={{
                                                    marginInlineStart: space.xs
                                                }}
                                                type="secondary"
                                            >
                                                {entry.sublabel}
                                            </Typography.Text>
                                        ) : null}
                                    </span>
                                </Row>
                            );
                        })
                    )}
                </ListContainer>
            )}
            {aiMode && (
                <ListContainer aria-label={microcopy.a11y.samplePrompts}>
                    {microcopy.commandPalette.sampleAi.map((prompt) => (
                        <li key={prompt}>
                            <SamplePromptRow
                                onClick={() => dispatchAiPrompt(prompt)}
                                type="button"
                            >
                                <Typography.Text>{prompt}</Typography.Text>
                            </SamplePromptRow>
                        </li>
                    ))}
                </ListContainer>
            )}
        </>
    );

    const titleNode = (
        <span
            style={{
                alignItems: "center",
                display: "inline-flex",
                gap: space.xs
            }}
        >
            <AiSparkleIcon aria-hidden />
            <span style={{ fontWeight: fontWeight.semibold }}>
                {microcopy.commandPalette.title}
            </span>
            <Typography.Text type="secondary">{shortcutText}</Typography.Text>
        </span>
    );

    if (isMobile) {
        return (
            <Drawer
                destroyOnClose
                height="65vh"
                onClose={onClose}
                open={open}
                placement="bottom"
                styles={{
                    body: {
                        paddingBottom: `max(${space.lg}px, env(safe-area-inset-bottom))`
                    },
                    wrapper: { height: "65dvh" }
                }}
                title={titleNode}
            >
                {renderBody()}
            </Drawer>
        );
    }

    return (
        <Modal
            destroyOnHidden
            footer={null}
            onCancel={onClose}
            open={open}
            title={titleNode}
            width={560}
        >
            {renderBody()}
        </Modal>
    );
};

export default CommandPalette;
