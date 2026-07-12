import { Filter, Save, Search, X } from "lucide-react";
import React, { useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@/components/ui/popover";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import useAppMessage from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { microcopy } from "../../constants/microcopy";
import type { ReduxDispatch, RootState } from "../../store";
import {
    SAVED_FILTER_PRESET_LIMIT,
    userPreferencesActions,
    type SavedFilterPresetState
} from "../../store/reducers/userPreferencesSlice";
import useAuth from "../../utils/hooks/useAuth";
import useBoardDensity from "../../utils/hooks/useBoardDensity";
import AiSparkleIcon from "../aiSparkleIcon";
import FilterChips, { FilterChip } from "../filterChips";
import { parseLensId } from "../lensChips";

/*
 * Radix `Select` reserves the empty-string value for its clear/placeholder
 * state, so the "all" options can't ride `value=""` the way AntD's did. Map
 * them through sentinels and translate back to `""` on change.
 */
const ALL_COORDINATORS = "__all_coordinators__";
const ALL_TYPES = "__all_types__";

export interface TaskSearchParam {
    taskName: string | null;
    coordinatorId: string | null;
    type: string | null;
    semanticIds?: string | null;
    /**
     * Active board lens at the URL layer. Optional because earlier
     * `useUrl` keys did not include it and existing callers that
     * compose the panel without lens routing still satisfy the shape.
     */
    lens?: string | null;
}

interface Props {
    tasks: ITask[];
    param: TaskSearchParam;
    setParam: (params: Partial<TaskSearchParam>) => void;
    members: IMember[] | undefined;
    loading: boolean;
    aiSearchSlot?: React.ReactNode;
}

const formatTemplate = (
    template: string,
    values: Record<string, string | number>
): string =>
    Object.entries(values).reduce(
        (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
        template
    );

const TaskSearchPanel: React.FC<Props> = ({
    tasks,
    param,
    setParam,
    members,
    loading,
    aiSearchSlot
}) => {
    const { user } = useAuth();
    const { projectId } = useParams<{ projectId: string }>();
    const dispatch = useDispatch<ReduxDispatch>();
    const message = useAppMessage();
    const { density, setDensity } = useBoardDensity();
    const presets = useSelector<RootState, SavedFilterPresetState[]>(
        (state) => state.userPreferences.savedFilterPresets
    );

    const coordinators = useMemo(() => {
        const result: IMember[] = [];
        const seen = new Set<string>();
        for (const t of tasks ?? []) {
            const member = (members ?? []).find(
                (m) => m._id === t.coordinatorId
            );
            if (member && !seen.has(member._id)) {
                seen.add(member._id);
                result.push(member);
            }
        }
        if (result.length === 0 && user) {
            result.push(user);
        }
        return result;
    }, [tasks, members, user]);

    const types = useMemo(() => {
        const observed: string[] = [];
        for (const t of tasks ?? []) {
            if (!observed.includes(t.type)) observed.push(t.type);
        }
        return observed.length > 1 ? observed : ["Task", "Bug"];
    }, [tasks]);

    const typeLabel = (type: string) => {
        if (type === "Task") return microcopy.options.taskTypes.task;
        if (type === "Bug") return microcopy.options.taskTypes.bug;
        return type;
    };

    const resetParams = () => {
        setParam({
            taskName: undefined,
            coordinatorId: undefined,
            type: undefined,
            semanticIds: undefined
        });
    };

    const coordinatorName = (members ?? []).find(
        (m) => m._id === param.coordinatorId
    )?.username;

    const chips: FilterChip[] = useMemo(() => {
        const active: FilterChip[] = [];
        if (param.taskName) {
            active.push({
                key: "taskName",
                label: microcopy.chips.search,
                value: param.taskName
            });
        }
        if (param.coordinatorId && coordinatorName) {
            active.push({
                key: "coordinatorId",
                label: microcopy.chips.coordinator,
                value: coordinatorName
            });
        }
        if (param.type) {
            active.push({
                key: "type",
                label: microcopy.chips.type,
                value: typeLabel(param.type)
            });
        }
        if (param.semanticIds) {
            active.push({
                key: "semanticIds",
                label: microcopy.chips.ai,
                value: microcopy.chips.smartMatch
            });
        }
        return active;
    }, [
        param.taskName,
        param.coordinatorId,
        param.type,
        param.semanticIds,
        coordinatorName
    ]);

    const dismissChip = (key: string) => {
        if (key === "taskName") setParam({ ...param, taskName: "" });
        else if (key === "coordinatorId")
            setParam({ ...param, coordinatorId: "" });
        else if (key === "type") setParam({ ...param, type: "" });
        else if (key === "semanticIds")
            setParam({ ...param, semanticIds: undefined });
    };

    /*
     * Phase 4.2 — preset state. The save popover is anchored to the
     * trailing save button; we hold the in-flight draft name in local
     * state so a user can type then hit Save without round-tripping
     * through Redux on every keystroke. Once they confirm, the
     * `addSavedFilterPreset` reducer appends and the localStorage
     * middleware persists in the same dispatch tick.
     */
    const [saveOpen, setSaveOpen] = useState(false);
    const [draftName, setDraftName] = useState("");
    const hasAdvancedFilters = Boolean(param.coordinatorId || param.type);
    const [filtersOpen, setFiltersOpen] = useState(hasAdvancedFilters);
    const [aiSearchOpen, setAiSearchOpen] = useState(() =>
        Boolean(param.semanticIds)
    );

    const advancedFilterCount =
        (param.coordinatorId ? 1 : 0) + (param.type ? 1 : 0);

    /*
     * Scope presets to the current project (which == one board today).
     * `boardId === null` would mean "global"; we don't currently expose
     * a UI to create global presets, but the load filter honours both
     * so future migrations can opt in.
     */
    const currentBoardId = projectId ?? null;
    const visiblePresets = useMemo(
        () =>
            presets.filter(
                (p) => p.boardId === null || p.boardId === currentBoardId
            ),
        [presets, currentBoardId]
    );

    const handleSavePreset = () => {
        const trimmed = draftName.trim();
        if (!trimmed) return;
        if (presets.length >= SAVED_FILTER_PRESET_LIMIT) {
            message.warning({
                content: formatTemplate(
                    microcopy.board.presets.limitReachedBody,
                    { limit: SAVED_FILTER_PRESET_LIMIT }
                )
            });
            setSaveOpen(false);
            setDraftName("");
            return;
        }
        const preset: SavedFilterPresetState = {
            id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: trimmed,
            boardId: currentBoardId,
            filterState: {
                taskName: param.taskName ?? "",
                coordinatorId: param.coordinatorId ?? "",
                type: param.type ?? "",
                lens: param.lens ?? ""
            },
            createdAt: Date.now()
        };
        dispatch(userPreferencesActions.addSavedFilterPreset(preset));
        message.success({ content: microcopy.board.presets.saved });
        setSaveOpen(false);
        setDraftName("");
    };

    /**
     * Apply a preset back into URL state.
     *
     * Each field is sanity-checked against the live data before being
     * written: a coordinatorId is only re-applied if a member with that
     * id is still on the project, and a type is only re-applied if the
     * observed task types still include it. When a value is silently
     * dropped we surface an inline warning toast so the user knows the
     * preset has gone stale.
     *
     * `taskName` is a free-text search so it's always safe to re-apply.
     */
    const handleApplyPreset = (presetId: string) => {
        const preset = presets.find((p) => p.id === presetId);
        if (!preset) return;

        const liveCoordinatorIds = new Set((members ?? []).map((m) => m._id));
        const liveTypes = new Set(types);

        let staleDetected = false;
        const nextCoordinator = preset.filterState.coordinatorId;
        const nextType = preset.filterState.type;
        const nextLens = preset.filterState.lens ?? "";
        const applyCoordinator =
            nextCoordinator && liveCoordinatorIds.has(nextCoordinator)
                ? nextCoordinator
                : "";
        const applyType = nextType && liveTypes.has(nextType) ? nextType : "";
        // `parseLensId` returns `null` for any unknown / removed lens id,
        // so a preset captured under a future lens that has since been
        // retired silently drops its lens instead of poisoning the URL.
        const applyLens = nextLens && parseLensId(nextLens) ? nextLens : "";
        if (nextCoordinator && applyCoordinator === "") staleDetected = true;
        if (nextType && applyType === "") staleDetected = true;
        if (nextLens && applyLens === "") staleDetected = true;

        setParam({
            taskName: preset.filterState.taskName || undefined,
            coordinatorId: applyCoordinator || undefined,
            type: applyType || undefined,
            semanticIds: undefined,
            lens: applyLens || undefined
        });
        message.info({
            content: formatTemplate(microcopy.board.presets.applied, {
                name: preset.name
            })
        });
        if (staleDetected) {
            message.warning({
                content: microcopy.board.presets.staleValueWarning
            });
        }
    };

    const handleDeletePreset = (presetId: string) => {
        dispatch(userPreferencesActions.removeSavedFilterPreset(presetId));
    };

    const managerLoading = loading ? (
        <Spinner
            aria-label={microcopy.placeholders.coordinator}
            className="ms-auto"
            data-testid="task-select-loading"
            size="sm"
        />
    ) : null;

    return (
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
                aria-label={microcopy.a11y.filterTasks}
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
                            aria-label={microcopy.a11y.searchTasksByName}
                            autoComplete="off"
                            className="pl-[2rem] pr-[2.5rem]"
                            enterKeyHint="search"
                            inputMode="search"
                            onChange={(e) =>
                                setParam({
                                    ...param,
                                    taskName: e.target.value
                                })
                            }
                            placeholder={microcopy.placeholders.searchBoard}
                            type="search"
                            value={param.taskName ?? ""}
                        />
                        {aiSearchSlot ? (
                            <div className="absolute right-sm top-1/2 flex -translate-y-1/2 items-center">
                                <Button
                                    aria-expanded={aiSearchOpen}
                                    aria-label={
                                        microcopy.board.smartSearchToggleAria
                                    }
                                    className="size-6"
                                    onClick={() =>
                                        setAiSearchOpen((open) => !open)
                                    }
                                    size="icon"
                                    title={microcopy.board.smartSearchToggle}
                                    variant={aiSearchOpen ? "primary" : "ghost"}
                                >
                                    <AiSparkleIcon aria-hidden />
                                </Button>
                            </div>
                        ) : null}
                    </div>
                </div>
                <div className="w-full flex-none md:w-auto">
                    <div className="relative inline-flex">
                        <Button
                            aria-expanded={filtersOpen}
                            data-testid="task-search-panel-filters-toggle"
                            onClick={() => setFiltersOpen((open) => !open)}
                            variant={filtersOpen ? "primary" : "default"}
                        >
                            <Filter aria-hidden />
                            {microcopy.board.filtersToggle}
                        </Button>
                        {advancedFilterCount > 0 ? (
                            <Badge className="absolute -right-1 -top-1 size-4 justify-center p-0 text-[10px] leading-none">
                                {advancedFilterCount}
                            </Badge>
                        ) : null}
                    </div>
                </div>
            </div>
            <FilterChips
                chips={chips}
                onClearAll={resetParams}
                onDismiss={dismissChip}
            />
            <div
                aria-label={microcopy.board.filtersToggleAria}
                className={cn("mt-xs", filtersOpen ? "block" : "hidden")}
                role="region"
            >
                <div className="flex flex-col gap-xs md:flex-row md:flex-wrap md:items-center md:gap-sm">
                    <div className="w-full min-w-0 flex-none md:w-auto md:max-w-[14rem] md:flex-[1_1_12rem]">
                        <Select
                            onValueChange={(value) =>
                                setParam({
                                    ...param,
                                    coordinatorId:
                                        value === ALL_COORDINATORS ? "" : value
                                })
                            }
                            value={param.coordinatorId || undefined}
                        >
                            <SelectTrigger
                                aria-label={microcopy.a11y.filterByCoordinator}
                                className="w-full"
                            >
                                <SelectValue
                                    placeholder={
                                        microcopy.placeholders.coordinator
                                    }
                                />
                                {managerLoading}
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL_COORDINATORS}>
                                    {microcopy.placeholders.coordinators}
                                </SelectItem>
                                {coordinators.map((member) => (
                                    <SelectItem
                                        key={member._id}
                                        value={member._id}
                                    >
                                        {member.username}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="w-full min-w-0 flex-none md:w-auto md:max-w-[14rem] md:flex-[1_1_12rem]">
                        <Select
                            onValueChange={(value) =>
                                setParam({
                                    ...param,
                                    type: value === ALL_TYPES ? "" : value
                                })
                            }
                            value={param.type || undefined}
                        >
                            <SelectTrigger
                                aria-label={microcopy.a11y.filterByType}
                                className="w-full"
                            >
                                <SelectValue
                                    placeholder={microcopy.placeholders.type}
                                />
                                {managerLoading}
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ALL_TYPES}>
                                    {microcopy.placeholders.types}
                                </SelectItem>
                                {types.map((type) => (
                                    <SelectItem value={type} key={type}>
                                        {typeLabel(type)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex items-center gap-xs md:ms-auto md:flex-none">
                        <Button
                            className="w-full md:w-auto"
                            disabled={chips.length === 0}
                            onClick={resetParams}
                            variant="ghost"
                        >
                            {microcopy.actions.resetFilters}
                        </Button>
                    </div>
                </div>
                <div className="mt-sm flex flex-col items-stretch gap-xs border-t border-border pt-sm md:flex-row md:flex-wrap md:items-center md:gap-sm">
                    <div className="flex flex-wrap items-center gap-xs">
                        <span
                            className="text-xs text-muted-foreground"
                            id="board-density-label"
                        >
                            {microcopy.board.densityLabel}
                        </span>
                        <ToggleGroup
                            aria-label={microcopy.board.densityLabel}
                            aria-labelledby="board-density-label"
                            onValueChange={(value) => {
                                if (
                                    value === "comfortable" ||
                                    value === "compact"
                                )
                                    setDensity(value);
                            }}
                            size="sm"
                            type="single"
                            value={density}
                        >
                            <ToggleGroupItem value="comfortable">
                                {microcopy.board.densityComfortable}
                            </ToggleGroupItem>
                            <ToggleGroupItem value="compact">
                                {microcopy.board.densityCompact}
                            </ToggleGroupItem>
                        </ToggleGroup>
                    </div>
                    <div className="flex flex-wrap items-center gap-xs md:ms-auto">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    aria-label={
                                        microcopy.board.presets.loadAriaLabel
                                    }
                                    className="min-w-[10rem] justify-between"
                                    data-testid="task-search-panel-presets-select"
                                    size="sm"
                                    variant="outline"
                                >
                                    {microcopy.board.presets.loadPlaceholder}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                align="end"
                                className="min-w-[12rem]"
                            >
                                {visiblePresets.length === 0 ? (
                                    <DropdownMenuItem disabled>
                                        {microcopy.empty.savedPresets.empty}
                                    </DropdownMenuItem>
                                ) : (
                                    visiblePresets.map((p) => (
                                        <DropdownMenuItem
                                            className="justify-between gap-xs"
                                            key={p.id}
                                            onSelect={() =>
                                                handleApplyPreset(p.id)
                                            }
                                        >
                                            <span>{p.name}</span>
                                            <button
                                                aria-label={formatTemplate(
                                                    microcopy.board.presets
                                                        .deleteAriaLabel as string,
                                                    { name: p.name }
                                                )}
                                                className={cn(
                                                    "ms-xs inline-flex size-6 items-center justify-center rounded-sm",
                                                    "text-muted-foreground hover:bg-muted hover:text-foreground",
                                                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                                    "coarse:size-[44px] coarse:min-h-[44px] coarse:min-w-[44px]",
                                                    "[&_svg]:size-4"
                                                )}
                                                onClick={(e) => {
                                                    /*
                                                     * Stop propagation +
                                                     * prevent default so the
                                                     * delete glyph doesn't
                                                     * also fire the menu
                                                     * item's apply path —
                                                     * otherwise we'd delete
                                                     * and apply on the same
                                                     * gesture.
                                                     */
                                                    e.stopPropagation();
                                                    e.preventDefault();
                                                    handleDeletePreset(p.id);
                                                }}
                                                type="button"
                                            >
                                                <X aria-hidden />
                                            </button>
                                        </DropdownMenuItem>
                                    ))
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Popover
                            onOpenChange={(open) => {
                                setSaveOpen(open);
                                if (!open) setDraftName("");
                            }}
                            open={saveOpen}
                        >
                            <PopoverTrigger asChild>
                                <Button
                                    aria-label={
                                        microcopy.board.presets.saveAriaLabel
                                    }
                                    data-testid="task-search-panel-save-preset"
                                    disabled={chips.length === 0}
                                    size="sm"
                                    variant="ghost"
                                >
                                    <Save aria-hidden />
                                    {microcopy.board.presets.saveAction}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent
                                align="end"
                                aria-label={microcopy.board.presets.saveAction}
                                className="flex w-64 flex-col gap-xs"
                            >
                                <Input
                                    aria-label={
                                        microcopy.board.presets.namePlaceholder
                                    }
                                    autoFocus
                                    data-testid="task-search-panel-preset-name-input"
                                    maxLength={60}
                                    onChange={(e) =>
                                        setDraftName(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            handleSavePreset();
                                        }
                                    }}
                                    placeholder={
                                        microcopy.board.presets.namePlaceholder
                                    }
                                    value={draftName}
                                />
                                <div className="flex flex-wrap items-center gap-xs">
                                    <Button
                                        disabled={!draftName.trim()}
                                        onClick={handleSavePreset}
                                        size="sm"
                                        variant="primary"
                                    >
                                        {microcopy.board.presets.saveConfirm}
                                    </Button>
                                    <Button
                                        onClick={() => {
                                            setSaveOpen(false);
                                            setDraftName("");
                                        }}
                                        size="sm"
                                        variant="default"
                                    >
                                        {microcopy.board.presets.saveCancel}
                                    </Button>
                                </div>
                            </PopoverContent>
                        </Popover>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TaskSearchPanel;
