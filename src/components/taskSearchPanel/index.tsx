import {
    CloseOutlined,
    FilterOutlined,
    SaveOutlined,
    SearchOutlined
} from "@ant-design/icons";
import styled from "@emotion/styled";
import { Badge, Button, Input, Popover, Segmented, Select, Space } from "antd";
import React, { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";

import { microcopy } from "../../constants/microcopy";
import type { ReduxDispatch, RootState } from "../../store";
import {
    SAVED_FILTER_PRESET_LIMIT,
    userPreferencesActions,
    type SavedFilterPresetState
} from "../../store/reducers/userPreferencesSlice";
import { breakpoints, radius, space } from "../../theme/tokens";
import useAppMessage from "../../utils/hooks/useAppMessage";
import useAuth from "../../utils/hooks/useAuth";
import useBoardDensity from "../../utils/hooks/useBoardDensity";
import FilterChips, { FilterChip } from "../filterChips";
import AiSparkleIcon from "../aiSparkleIcon";
import { parseLensId } from "../lensChips";

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

const FilterShell = styled.div`
    background: var(--ant-color-bg-container, #fff);
    border: 1px solid var(--ant-color-border-secondary, rgba(15, 23, 42, 0.06));
    border-radius: ${radius.lg}px;
    margin-bottom: ${space.md}px;
    padding: ${space.sm}px;

    @media (min-width: ${breakpoints.md}px) {
        padding: ${space.md}px;
    }
`;

const FilterRow = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${space.xs}px;

    @media (min-width: ${breakpoints.md}px) {
        align-items: center;
        flex-direction: row;
        flex-wrap: wrap;
        gap: ${space.sm}px;
    }
`;

/*
 * `flex: 1 1 14rem` only makes sense in row direction where the basis
 * sets the preferred WIDTH. In the mobile column layout the basis is
 * applied vertically and reserves a 14 rem-tall empty slot above each
 * sibling. Start with `auto` and switch to the proportional row basis
 * at the `md` breakpoint where the row reflows.
 */
const FlexInput = styled.div`
    flex: 0 0 auto;
    min-width: 0;
    width: 100%;

    @media (min-width: ${breakpoints.md}px) {
        flex: 1 1 14rem;
        max-width: 22rem;
        width: auto;
    }
`;

const FlexSelect = styled.div`
    flex: 0 0 auto;
    min-width: 0;
    width: 100%;

    @media (min-width: ${breakpoints.md}px) {
        flex: 1 1 12rem;
        max-width: 14rem;
        width: auto;
    }
`;

/*
 * "Reset filters" should sit outside the per-field flex grid because it acts on
 * all of them. On phone widths it stretches full width below the inputs; on
 * tablet+ it shrinks to its natural width and aligns with the filter fields.
 */
const ResetButtonSlot = styled.div`
    align-items: center;
    display: flex;
    gap: ${space.xs}px;

    > .ant-btn {
        width: 100%;
    }

    @media (min-width: ${breakpoints.md}px) {
        flex: 0 0 auto;
        margin-inline-start: auto;

        > .ant-btn {
            width: auto;
        }
    }
`;

/*
 * Trailing row that holds the per-user preference controls — density
 * toggle on the left, preset save + load on the right. Sits below the
 * primary filter row so it doesn't push the filter inputs around when
 * presets are saved/loaded. On phone widths it stacks vertically.
 */
const PrefRow = styled.div`
    align-items: stretch;
    border-top: 1px solid
        var(--ant-color-border-secondary, rgba(15, 23, 42, 0.06));
    display: flex;
    flex-direction: column;
    gap: ${space.xs}px;
    margin-top: ${space.sm}px;
    padding-top: ${space.sm}px;

    @media (min-width: ${breakpoints.md}px) {
        align-items: center;
        flex-direction: row;
        flex-wrap: wrap;
        gap: ${space.sm}px;
    }
`;

const PrefRowTrailing = styled.div`
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: ${space.xs}px;

    @media (min-width: ${breakpoints.md}px) {
        margin-inline-start: auto;
    }
`;

const PresetSelectInner = styled.span`
    align-items: center;
    display: inline-flex;
    gap: ${space.xs}px;
    justify-content: space-between;
    width: 100%;
`;

const FilterToggleSlot = styled.div`
    flex: 0 0 auto;
    width: 100%;

    @media (min-width: ${breakpoints.md}px) {
        width: auto;
    }
`;

const AdvancedFiltersPanel = styled.div<{ $open: boolean }>`
    display: ${({ $open }) => ($open ? "block" : "none")};
    margin-top: ${space.xs}px;
`;

const AiSearchSlot = styled.div<{ $visible: boolean }>`
    display: ${({ $visible }) => ($visible ? "block" : "none")};
    margin-bottom: ${space.sm}px;
    width: 100%;
`;

const PresetDeleteButton = styled.button`
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: ${radius.sm}px;
    color: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.45));
    cursor: pointer;
    display: inline-flex;
    height: 24px;
    justify-content: center;
    margin-inline-start: ${space.xs}px;
    padding: 0;
    width: 24px;

    &:hover,
    &:focus-visible {
        background: var(--ant-color-fill-tertiary, rgba(15, 23, 42, 0.04));
        color: var(--ant-color-text, rgba(15, 23, 42, 0.92));
    }
`;

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

    const presetOptions = useMemo(
        () =>
            visiblePresets.map((p) => ({
                value: p.id,
                label: (
                    <PresetSelectInner>
                        <span>{p.name}</span>
                        <PresetDeleteButton
                            aria-label={formatTemplate(
                                microcopy.board.presets
                                    .deleteAriaLabel as string,
                                { name: p.name }
                            )}
                            onClick={(e) => {
                                /*
                                 * Stop propagation + prevent default so
                                 * clicking the delete glyph inside a
                                 * Select option doesn't also fire the
                                 * Select's "option chosen" path —
                                 * otherwise we'd delete and apply on the
                                 * same gesture.
                                 */
                                e.stopPropagation();
                                e.preventDefault();
                                handleDeletePreset(p.id);
                            }}
                            type="button"
                        >
                            <CloseOutlined aria-hidden />
                        </PresetDeleteButton>
                    </PresetSelectInner>
                )
            })),
        [visiblePresets]
    );

    return (
        <FilterShell>
            {aiSearchSlot ? (
                <AiSearchSlot $visible={aiSearchOpen}>
                    {aiSearchSlot}
                </AiSearchSlot>
            ) : null}
            <FilterRow role="search" aria-label={microcopy.a11y.filterTasks}>
                <FlexInput>
                    <Input
                        aria-label={microcopy.a11y.searchTasksByName}
                        allowClear
                        autoComplete="off"
                        enterKeyHint="search"
                        inputMode="search"
                        onChange={(e) =>
                            setParam({
                                ...param,
                                taskName: e.target.value
                            })
                        }
                        placeholder={microcopy.placeholders.searchBoard}
                        prefix={
                            <SearchOutlined
                                aria-hidden
                                style={{
                                    color: "var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.45))"
                                }}
                            />
                        }
                        suffix={
                            aiSearchSlot ? (
                                <Button
                                    aria-expanded={aiSearchOpen}
                                    aria-label={
                                        microcopy.board.smartSearchToggleAria
                                    }
                                    icon={<AiSparkleIcon aria-hidden />}
                                    onClick={() =>
                                        setAiSearchOpen((open) => !open)
                                    }
                                    size="small"
                                    title={microcopy.board.smartSearchToggle}
                                    type={aiSearchOpen ? "primary" : "text"}
                                />
                            ) : undefined
                        }
                        type="search"
                        value={param.taskName ?? ""}
                    />
                </FlexInput>
                <FilterToggleSlot>
                    <Badge count={advancedFilterCount} size="small">
                        <Button
                            aria-expanded={filtersOpen}
                            data-testid="task-search-panel-filters-toggle"
                            icon={<FilterOutlined aria-hidden />}
                            onClick={() => setFiltersOpen((open) => !open)}
                            type={filtersOpen ? "primary" : "default"}
                        >
                            {microcopy.board.filtersToggle}
                        </Button>
                    </Badge>
                </FilterToggleSlot>
            </FilterRow>
            <FilterChips
                chips={chips}
                onClearAll={resetParams}
                onDismiss={dismissChip}
            />
            <AdvancedFiltersPanel
                $open={filtersOpen}
                aria-label={microcopy.board.filtersToggleAria}
                role="region"
            >
                <FilterRow>
                    <FlexSelect>
                        <Select
                            allowClear
                            aria-label={microcopy.a11y.filterByCoordinator}
                            loading={loading}
                            onChange={(value) =>
                                setParam({
                                    ...param,
                                    coordinatorId: value ?? ""
                                })
                            }
                            placeholder={microcopy.placeholders.coordinator}
                            style={{ width: "100%" }}
                            value={param.coordinatorId || undefined}
                        >
                            <Select.Option value="">
                                {microcopy.placeholders.coordinators}
                            </Select.Option>
                            {coordinators.map((member) => (
                                <Select.Option
                                    value={member._id}
                                    key={member._id}
                                >
                                    {member.username}
                                </Select.Option>
                            ))}
                        </Select>
                    </FlexSelect>
                    <FlexSelect>
                        <Select
                            allowClear
                            aria-label={microcopy.a11y.filterByType}
                            loading={loading}
                            onChange={(value) =>
                                setParam({
                                    ...param,
                                    type: value ?? ""
                                })
                            }
                            placeholder={microcopy.placeholders.type}
                            style={{ width: "100%" }}
                            value={param.type || undefined}
                        >
                            <Select.Option value="">
                                {microcopy.placeholders.types}
                            </Select.Option>
                            {types.map((type) => (
                                <Select.Option value={type} key={type}>
                                    {typeLabel(type)}
                                </Select.Option>
                            ))}
                        </Select>
                    </FlexSelect>
                    <ResetButtonSlot>
                        <Button
                            disabled={chips.length === 0}
                            onClick={resetParams}
                            type="text"
                        >
                            {microcopy.actions.resetFilters}
                        </Button>
                    </ResetButtonSlot>
                </FilterRow>
                <PrefRow>
                    <Space size="small" align="center" wrap>
                        <span
                            id="board-density-label"
                            style={{
                                color: "var(--ant-color-text-secondary, rgba(15, 23, 42, 0.55))",
                                fontSize: "12px"
                            }}
                        >
                            {microcopy.board.densityLabel}
                        </span>
                        <Segmented
                            aria-labelledby="board-density-label"
                            aria-label={microcopy.board.densityLabel}
                            onChange={(value) =>
                                setDensity(value as "comfortable" | "compact")
                            }
                            options={[
                                {
                                    label: microcopy.board.densityComfortable,
                                    value: "comfortable"
                                },
                                {
                                    label: microcopy.board.densityCompact,
                                    value: "compact"
                                }
                            ]}
                            size="small"
                            value={density}
                        />
                    </Space>
                    <PrefRowTrailing>
                        <Select
                            allowClear
                            aria-label={microcopy.board.presets.loadAriaLabel}
                            data-testid="task-search-panel-presets-select"
                            notFoundContent={microcopy.empty.savedPresets.empty}
                            onChange={(value) => {
                                if (typeof value === "string")
                                    handleApplyPreset(value);
                            }}
                            options={presetOptions}
                            placeholder={
                                microcopy.board.presets.loadPlaceholder
                            }
                            size="small"
                            style={{ minWidth: 160 }}
                            value={null}
                        />
                        <Popover
                            content={
                                <Space
                                    direction="vertical"
                                    size="small"
                                    style={{ width: "100%" }}
                                >
                                    <Input
                                        aria-label={
                                            microcopy.board.presets
                                                .namePlaceholder
                                        }
                                        autoFocus
                                        data-testid="task-search-panel-preset-name-input"
                                        maxLength={60}
                                        onChange={(e) =>
                                            setDraftName(e.target.value)
                                        }
                                        onPressEnter={handleSavePreset}
                                        placeholder={
                                            microcopy.board.presets
                                                .namePlaceholder
                                        }
                                        value={draftName}
                                    />
                                    <Space size="small" wrap>
                                        <Button
                                            onClick={handleSavePreset}
                                            disabled={!draftName.trim()}
                                            size="small"
                                            type="primary"
                                        >
                                            {
                                                microcopy.board.presets
                                                    .saveConfirm
                                            }
                                        </Button>
                                        <Button
                                            onClick={() => {
                                                setSaveOpen(false);
                                                setDraftName("");
                                            }}
                                            size="small"
                                        >
                                            {microcopy.board.presets.saveCancel}
                                        </Button>
                                    </Space>
                                </Space>
                            }
                            onOpenChange={(open) => {
                                setSaveOpen(open);
                                if (!open) setDraftName("");
                            }}
                            open={saveOpen}
                            placement="bottomRight"
                            title={microcopy.board.presets.saveAction}
                            trigger="click"
                        >
                            <Button
                                aria-label={
                                    microcopy.board.presets.saveAriaLabel
                                }
                                data-testid="task-search-panel-save-preset"
                                disabled={chips.length === 0}
                                icon={<SaveOutlined aria-hidden />}
                                size="small"
                                type="text"
                            >
                                {microcopy.board.presets.saveAction}
                            </Button>
                        </Popover>
                    </PrefRowTrailing>
                </PrefRow>
            </AdvancedFiltersPanel>
        </FilterShell>
    );
};

export default TaskSearchPanel;
