import { Filter, Search, Star } from "lucide-react";
import React, { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@/components/ui/tooltip";
import useAppMessage from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { microcopy } from "../../constants/microcopy";
import useDebounce from "../../utils/hooks/useDebounce";
import AiSparkleIcon from "../aiSparkleIcon";
import FilterChips, { FilterChip } from "../filterChips";

/*
 * Mirrors the 300 ms `useDebounce(param, 300)` the projects page applies
 * before it refetches (see `pages/project.tsx`): the URL updates on every
 * keystroke (source of truth, deep-linkable), but the network refetch is
 * debounced. We re-derive the same window here purely to drive the
 * "filtering…" spinner so the affordance appears for exactly as long as a
 * fetch is actually pending — we do NOT re-debounce the filter itself.
 */
const SEARCH_DEBOUNCE_MS = 300;

/*
 * Radix `Select` reserves the empty-string value for its clear/placeholder
 * state, so the "all managers" option can't ride `value=""` the way AntD's
 * did. Map it through a sentinel and translate back to `""` on change.
 */
const ALL_MANAGERS = "__all_managers__";

/*
 * Coarse-pointer touch-target expander mirroring the `columnReadinessPill`
 * pattern: the compact `link`-variant toolbar buttons are under the WCAG
 * 2.5.8 44×44 minimum on touch, so a `::before` pseudo-element pads the hit
 * area out without growing the visible control. Gated on `(pointer: coarse)`
 * so fine-pointer precision is untouched. The `data-touch-hit-area="44"`
 * marker on the wrapper is the stable contract for the test harness.
 */
const TOUCH_SLOT_CLASS = cn(
    "relative inline-flex",
    "before:absolute before:left-1/2 before:top-1/2 before:-z-10",
    "before:-translate-x-1/2 before:-translate-y-1/2",
    "coarse:before:min-h-[44px] coarse:before:min-w-[44px] coarse:before:content-['']"
);

export interface ProjectSearchParam {
    projectName: string | null;
    managerId: string | null;
    semanticIds?: string | null;
    /*
     * Phase 4.2 — `sort` + `favoritedOnly` are URL params owned by the
     * project page (`useUrl` keys); the panel only consumes them
     * through the props plumbed from the page (`favoritedOnly`,
     * `onFavoritedOnlyChange`) — it does NOT write them through
     * `setParam` directly. They're still listed here so callers that
     * spread `param` get the right shape.
     */
    sort?: string | null;
    favoritedOnly?: string | null;
}

interface Props {
    param: ProjectSearchParam;
    setParam: (params: Partial<ProjectSearchParam>) => void;
    members: IMember[];
    loading: boolean;
    aiSearchSlot?: React.ReactNode;
    /*
     * Phase 4.2 — favorited-only filter + saved-default management.
     * All five props are optional so legacy callers (none today, but
     * the panel surface is otherwise generic) keep working. When ALL
     * five are absent, the favorited toggle + save/reset row collapses
     * to nothing.
     */
    favoritedOnly?: boolean;
    onFavoritedOnlyChange?: (next: boolean) => void;
    /** True when the user has saved a default; controls whether
     * "Reset to default" + "Clear saved default" render. */
    hasSavedDefaults?: boolean;
    onSaveDefault?: () => void;
    onResetToDefault?: () => void;
    onClearSavedDefault?: () => void;
}

const ProjectSearchPanel: React.FC<Props> = ({
    param,
    setParam,
    members,
    loading,
    aiSearchSlot,
    favoritedOnly = false,
    onFavoritedOnlyChange,
    hasSavedDefaults = false,
    onSaveDefault,
    onResetToDefault,
    onClearSavedDefault
}) => {
    const message = useAppMessage();
    const managerName = members.find(
        (u) => u._id === param.managerId
    )?.username;

    /*
     * Loading affordance for the project-name search (ui-todo §9). The
     * URL stays the single source of truth: `onChange` writes
     * `param.projectName` immediately so the input is controlled by the
     * URL and the change is deep-linkable / back-button-safe. The projects
     * page debounces that param by 300 ms before it refetches; we re-derive
     * the same debounce here ONLY to know when a refetch is still pending
     * (the live value has out-run the debounced one) so we can show a
     * subtle spinner. We never gate the actual filter on this — that would
     * double-debounce and fight the page's own `useDebounce`.
     */
    const liveQuery = param.projectName ?? "";
    const debouncedQuery = useDebounce(liveQuery, SEARCH_DEBOUNCE_MS);
    const searchPending = Boolean(liveQuery) && debouncedQuery !== liveQuery;

    const chips: FilterChip[] = useMemo(() => {
        const active: FilterChip[] = [];
        if (param.projectName) {
            active.push({
                key: "projectName",
                label: microcopy.chips.search,
                value: param.projectName
            });
        }
        if (param.managerId && managerName) {
            active.push({
                key: "managerId",
                label: microcopy.chips.manager,
                value: managerName
            });
        }
        if (param.semanticIds) {
            active.push({
                key: "semanticIds",
                label: microcopy.chips.ai,
                value: microcopy.chips.smartMatch
            });
        }
        if (favoritedOnly) {
            active.push({
                key: "favoritedOnly",
                label: microcopy.chips.favoritedOnly,
                value: microcopy.chips.favoritedOnlyOn
            });
        }
        return active;
    }, [
        param.projectName,
        param.managerId,
        param.semanticIds,
        managerName,
        favoritedOnly
    ]);

    const dismiss = (key: string) => {
        if (key === "projectName") {
            setParam({ ...param, projectName: "" });
        } else if (key === "managerId") {
            setParam({ ...param, managerId: "" });
        } else if (key === "semanticIds") {
            setParam({ ...param, semanticIds: undefined });
        } else if (key === "favoritedOnly") {
            onFavoritedOnlyChange?.(false);
        }
    };

    const clearAll = () => {
        setParam({
            projectName: "",
            managerId: "",
            semanticIds: undefined
        });
        if (favoritedOnly) onFavoritedOnlyChange?.(false);
    };

    const handleSaveDefault = () => {
        onSaveDefault?.();
        // Tiny ack toast — the button is a stateless action without
        // its own visible state change, so without the toast the user
        // can't tell whether the click landed.
        message.success(microcopy.actions.savedAsDefault);
    };

    const handleResetToDefault = () => {
        onResetToDefault?.();
        message.success(microcopy.actions.defaultApplied);
    };

    // The defaults toolbar is only rendered when the page wires the
    // callbacks. Either of "save" / "reset" being absent collapses the
    // row entirely so the legacy panel surface keeps its old shape.
    const showDefaultsToolbar =
        Boolean(onSaveDefault) || Boolean(onResetToDefault);

    const hasAdvancedFilters = Boolean(param.managerId || favoritedOnly);
    const [filtersOpen, setFiltersOpen] = useState(hasAdvancedFilters);
    const [aiSearchOpen, setAiSearchOpen] = useState(() =>
        Boolean(param.semanticIds)
    );
    const advancedFilterCount =
        (param.managerId ? 1 : 0) + (favoritedOnly ? 1 : 0);

    return (
        <TooltipProvider>
            <div className="mb-md rounded-lg border border-border bg-card p-sm md:p-md">
                {aiSearchSlot ? (
                    <div
                        className={cn(
                            "mb-sm w-full",
                            aiSearchOpen ? "block" : "hidden"
                        )}
                    >
                        {aiSearchSlot}
                    </div>
                ) : null}
                <div
                    aria-label={microcopy.a11y.filterProjects}
                    className="flex flex-col gap-xs md:flex-row md:flex-wrap md:items-center md:gap-sm"
                    role="search"
                >
                    <div className="w-full min-w-0 flex-none md:w-auto md:max-w-[22rem] md:flex-[1_1_14rem]">
                        <div className="relative w-full">
                            <Search
                                aria-hidden
                                className="pointer-events-none absolute left-sm top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                            />
                            <Input
                                aria-label={microcopy.a11y.searchProjectsByName}
                                autoComplete="off"
                                className="pl-[2rem] pr-[2.5rem]"
                                enterKeyHint="search"
                                inputMode="search"
                                onChange={(e) =>
                                    setParam({
                                        ...param,
                                        projectName: e.target.value
                                    })
                                }
                                placeholder={
                                    microcopy.placeholders.searchProjects
                                }
                                type="search"
                                value={liveQuery}
                            />
                            <div className="absolute right-sm top-1/2 flex -translate-y-1/2 items-center">
                                {aiSearchSlot ? (
                                    <Button
                                        aria-expanded={aiSearchOpen}
                                        aria-label={
                                            microcopy.board
                                                .smartSearchToggleAria
                                        }
                                        className="size-6"
                                        onClick={() =>
                                            setAiSearchOpen((open) => !open)
                                        }
                                        size="icon"
                                        title={
                                            microcopy.board.smartSearchToggle
                                        }
                                        variant={
                                            aiSearchOpen ? "primary" : "ghost"
                                        }
                                    >
                                        <AiSparkleIcon aria-hidden />
                                    </Button>
                                ) : searchPending ? (
                                    <Spinner
                                        aria-label={
                                            microcopy.a11y.searchProjectsPending
                                        }
                                        label={
                                            microcopy.a11y.searchProjectsPending
                                        }
                                        size="sm"
                                    />
                                ) : (
                                    <span
                                        aria-hidden
                                        className="inline-block w-4"
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="w-full flex-none md:w-auto">
                        <div className="relative inline-flex">
                            <Button
                                aria-expanded={filtersOpen}
                                data-testid="project-search-panel-filters-toggle"
                                onClick={() => setFiltersOpen((open) => !open)}
                                variant={filtersOpen ? "primary" : "default"}
                            >
                                <Filter aria-hidden />
                                {microcopy.board.filtersToggle}
                            </Button>
                            {advancedFilterCount > 0 ? (
                                <Badge
                                    className="absolute -right-1 -top-1 size-4 justify-center p-0 text-[10px] leading-none"
                                    data-testid="project-search-panel-filter-count"
                                >
                                    {advancedFilterCount}
                                </Badge>
                            ) : null}
                        </div>
                    </div>
                </div>
                <FilterChips
                    chips={chips}
                    onClearAll={clearAll}
                    onDismiss={dismiss}
                />
                <div
                    aria-label={microcopy.projectsPage.filtersToggleAria}
                    className={cn("mt-xs", filtersOpen ? "block" : "hidden")}
                    role="region"
                >
                    <div className="flex flex-col gap-xs md:flex-row md:flex-wrap md:items-center md:gap-sm">
                        <div className="w-full min-w-0 flex-none md:w-auto md:max-w-[14rem] md:flex-[1_1_12rem]">
                            <Select
                                onValueChange={(value) =>
                                    setParam({
                                        ...param,
                                        managerId:
                                            value === ALL_MANAGERS ? "" : value
                                    })
                                }
                                value={param.managerId || ALL_MANAGERS}
                            >
                                <SelectTrigger
                                    aria-label={microcopy.a11y.filterByManager}
                                    className="w-full"
                                    data-testid="project-search-panel-manager"
                                >
                                    <SelectValue
                                        placeholder={
                                            microcopy.placeholders.manager
                                        }
                                    />
                                    {loading ? (
                                        <Spinner
                                            aria-label={
                                                microcopy.placeholders.manager
                                            }
                                            className="ms-auto"
                                            data-testid="project-search-panel-manager-loading"
                                            size="sm"
                                        />
                                    ) : null}
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={ALL_MANAGERS}>
                                        {microcopy.placeholders.managers}
                                    </SelectItem>
                                    {members.map((user) => (
                                        <SelectItem
                                            key={user._id}
                                            value={user._id}
                                        >
                                            {user.username}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {onFavoritedOnlyChange ? (
                            <Button
                                aria-label={microcopy.a11y.favoritedOnlyToggle}
                                aria-pressed={favoritedOnly}
                                onClick={() =>
                                    onFavoritedOnlyChange(!favoritedOnly)
                                }
                                variant={favoritedOnly ? "primary" : "outline"}
                            >
                                <Star
                                    aria-hidden
                                    className={cn(
                                        favoritedOnly && "fill-current"
                                    )}
                                />
                                {microcopy.chips.favoritedOnly}
                            </Button>
                        ) : null}
                    </div>
                    {showDefaultsToolbar ? (
                        <div
                            aria-label={microcopy.a11y.saveCurrentAsDefault}
                            className="flex flex-wrap items-center gap-xs pt-xs text-xs font-medium text-muted-foreground"
                            role="group"
                        >
                            {onSaveDefault ? (
                                <span
                                    className={TOUCH_SLOT_CLASS}
                                    data-touch-hit-area="44"
                                >
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                aria-label={
                                                    microcopy.a11y
                                                        .saveCurrentAsDefault
                                                }
                                                onClick={handleSaveDefault}
                                                size="sm"
                                                variant="link"
                                            >
                                                {
                                                    microcopy.actions
                                                        .saveAsDefault
                                                }
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {
                                                microcopy.a11y
                                                    .saveCurrentAsDefault
                                            }
                                        </TooltipContent>
                                    </Tooltip>
                                </span>
                            ) : null}
                            {onResetToDefault && hasSavedDefaults ? (
                                <span
                                    className={TOUCH_SLOT_CLASS}
                                    data-touch-hit-area="44"
                                >
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                aria-label={
                                                    microcopy.a11y
                                                        .resetToSavedDefault
                                                }
                                                onClick={handleResetToDefault}
                                                size="sm"
                                                variant="link"
                                            >
                                                {
                                                    microcopy.actions
                                                        .resetToDefault
                                                }
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {microcopy.a11y.resetToSavedDefault}
                                        </TooltipContent>
                                    </Tooltip>
                                </span>
                            ) : null}
                            {onClearSavedDefault && hasSavedDefaults ? (
                                <span
                                    className={TOUCH_SLOT_CLASS}
                                    data-touch-hit-area="44"
                                >
                                    <Button
                                        aria-label={microcopy.actions.clear}
                                        onClick={onClearSavedDefault}
                                        size="sm"
                                        variant="link"
                                    >
                                        {microcopy.actions.clear}
                                    </Button>
                                </span>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            </div>
        </TooltipProvider>
    );
};

export default ProjectSearchPanel;
