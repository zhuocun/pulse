import {
    LoadingOutlined,
    SearchOutlined,
    StarFilled,
    StarOutlined
} from "@ant-design/icons";
import styled from "@emotion/styled";
import { Button, Input, Select, Spin, Tooltip } from "antd";
import React, { useMemo } from "react";

import { microcopy } from "../../constants/microcopy";
import {
    breakpoints,
    fontSize,
    fontWeight,
    radius,
    space
} from "../../theme/tokens";
import useAppMessage from "../../utils/hooks/useAppMessage";
import useDebounce from "../../utils/hooks/useDebounce";
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
 * sets the preferred WIDTH. In the mobile column layout the basis would
 * be applied vertically and reserve a 14 rem-tall empty slot above each
 * sibling. We start with `auto` and switch to the proportional row
 * basis at the `md` breakpoint where the row reflows.
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
 * Phase 4.2 — saved-default toolbar that lives BELOW the filter row +
 * filter chips. The row is dense on purpose so it doesn't pull focus
 * away from the actual filter inputs above; the buttons render as
 * borderless text-only links until the user hovers / focuses them.
 *
 * The row is omitted entirely when no saved-default callbacks are
 * wired, so legacy callers (or any future caller that wants the panel
 * without persistence) don't get an empty toolbar shell.
 */
const DefaultsToolbar = styled.div`
    align-items: center;
    color: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.55));
    display: flex;
    flex-wrap: wrap;
    font-size: ${fontSize.xs}px;
    font-weight: ${fontWeight.medium};
    gap: ${space.xs}px;
    padding-top: ${space.xs}px;
`;

/*
 * Phase 4.2 review follow-up — touch hit-area expander mirroring the
 * `columnReadinessPill` pattern from Wave 4. The toolbar's
 * `type="link"` buttons are well under the WCAG 2.5.8 minimum 44×44
 * tap target on coarse-pointer (touch) devices. A `::before`
 * pseudo-element pads the click target out to 44×44 without changing
 * the visible button size — the AntD link styling stays compact for
 * fine-pointer (mouse) users, and the negative z-index keeps the
 * expander behind the visible label so it doesn't sit on top of the
 * text. The rule is gated on `(pointer: coarse)` so desktop
 * precision pointing isn't affected. The `data-touch-hit-area="44"`
 * marker on the wrapper is the stable contract for the test harness
 * (mirrors the columnReadinessPill convention — a refactor that
 * drops the wrapper would lose the marker AND the rule, tripping
 * the assertion loudly).
 */
const TouchTargetSlot = styled.span`
    display: inline-flex;
    position: relative;

    @media (pointer: coarse) {
        &::before {
            content: "";
            inset: 50% auto auto 50%;
            min-block-size: 44px;
            min-inline-size: 44px;
            position: absolute;
            transform: translate(-50%, -50%);
            z-index: -1;
        }
    }
`;

const FavoritedToggleButton = styled(Button, {
    /*
     * Drop the transient `$active` prop before forwarding to the
     * underlying AntD Button (which forwards unknown props to the
     * native button element). React 19 warns on unknown DOM
     * attributes; without this filter the prop reaches the
     * `<button>` and trips a console.error in tests.
     */
    shouldForwardProp: (prop) => prop !== "$active"
})<{ $active: boolean }>`
    && {
        background: ${(props) =>
            props.$active
                ? "var(--ant-color-primary-bg, rgba(234, 88, 12, 0.12))"
                : "transparent"};
        border: 1px solid
            ${(props) =>
                props.$active
                    ? "var(--ant-color-primary-border, rgba(234, 88, 12, 0.3))"
                    : "var(--ant-color-border-secondary, rgba(15, 23, 42, 0.12))"};
        color: ${(props) =>
            props.$active
                ? "var(--ant-color-primary, #ea580c)"
                : "var(--ant-color-text-secondary, rgba(15, 23, 42, 0.65))"};
        font-weight: ${fontWeight.medium};
    }
`;

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
    // AntD v6: the static `message` import warns that it can't consume
    // dynamic theme context. `useAppMessage()` returns a theme-aware
    // instance from the nearest `<App>` provider, falling back to the
    // static API when none is mounted (tests rendering in isolation).
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

    return (
        <FilterShell>
            {aiSearchSlot}
            <FilterRow role="search" aria-label={microcopy.a11y.filterProjects}>
                <FlexInput>
                    <Input
                        aria-label={microcopy.a11y.searchProjectsByName}
                        allowClear
                        autoComplete="off"
                        enterKeyHint="search"
                        inputMode="search"
                        onChange={(e) =>
                            setParam({
                                ...param,
                                projectName: e.target.value
                            })
                        }
                        placeholder={microcopy.placeholders.searchProjects}
                        prefix={
                            <SearchOutlined
                                aria-hidden
                                style={{
                                    color: "var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.45))"
                                }}
                            />
                        }
                        suffix={
                            searchPending ? (
                                <Spin
                                    aria-label={
                                        microcopy.a11y.searchProjectsPending
                                    }
                                    indicator={
                                        <LoadingOutlined aria-hidden spin />
                                    }
                                    size="small"
                                />
                            ) : (
                                // Reserve the suffix slot even at rest so
                                // toggling the spinner doesn't shift the
                                // input's text width (a tiny CLS guard on
                                // the control itself).
                                <span
                                    aria-hidden
                                    style={{
                                        display: "inline-block",
                                        inlineSize: `${fontSize.md}px`
                                    }}
                                />
                            )
                        }
                        type="search"
                        value={liveQuery}
                    />
                </FlexInput>
                <FlexSelect>
                    <Select
                        allowClear
                        aria-label={microcopy.a11y.filterByManager}
                        loading={loading}
                        onChange={(value) =>
                            setParam({
                                ...param,
                                managerId: value ?? ""
                            })
                        }
                        options={[
                            {
                                label: microcopy.placeholders.managers,
                                value: ""
                            },
                            ...members.map((user) => ({
                                label: user.username,
                                value: user._id
                            }))
                        ]}
                        placeholder={microcopy.placeholders.manager}
                        style={{ width: "100%" }}
                        value={loading ? undefined : (managerName ?? undefined)}
                    />
                </FlexSelect>
                {onFavoritedOnlyChange ? (
                    <FavoritedToggleButton
                        $active={favoritedOnly}
                        aria-label={microcopy.a11y.favoritedOnlyToggle}
                        aria-pressed={favoritedOnly}
                        icon={
                            favoritedOnly ? (
                                <StarFilled aria-hidden />
                            ) : (
                                <StarOutlined aria-hidden />
                            )
                        }
                        onClick={() => onFavoritedOnlyChange(!favoritedOnly)}
                        size="middle"
                        type="default"
                    >
                        {microcopy.chips.favoritedOnly}
                    </FavoritedToggleButton>
                ) : null}
            </FilterRow>
            <FilterChips
                chips={chips}
                onClearAll={clearAll}
                onDismiss={dismiss}
            />
            {showDefaultsToolbar ? (
                <DefaultsToolbar
                    role="group"
                    aria-label={microcopy.a11y.saveCurrentAsDefault}
                >
                    {onSaveDefault ? (
                        <TouchTargetSlot data-touch-hit-area="44">
                            <Tooltip
                                title={microcopy.a11y.saveCurrentAsDefault}
                            >
                                <Button
                                    aria-label={
                                        microcopy.a11y.saveCurrentAsDefault
                                    }
                                    onClick={handleSaveDefault}
                                    size="small"
                                    type="link"
                                >
                                    {microcopy.actions.saveAsDefault}
                                </Button>
                            </Tooltip>
                        </TouchTargetSlot>
                    ) : null}
                    {onResetToDefault && hasSavedDefaults ? (
                        <TouchTargetSlot data-touch-hit-area="44">
                            <Tooltip title={microcopy.a11y.resetToSavedDefault}>
                                <Button
                                    aria-label={
                                        microcopy.a11y.resetToSavedDefault
                                    }
                                    onClick={handleResetToDefault}
                                    size="small"
                                    type="link"
                                >
                                    {microcopy.actions.resetToDefault}
                                </Button>
                            </Tooltip>
                        </TouchTargetSlot>
                    ) : null}
                    {onClearSavedDefault && hasSavedDefaults ? (
                        <TouchTargetSlot data-touch-hit-area="44">
                            <Button
                                aria-label={microcopy.actions.clear}
                                onClick={onClearSavedDefault}
                                size="small"
                                type="link"
                            >
                                {microcopy.actions.clear}
                            </Button>
                        </TouchTargetSlot>
                    ) : null}
                </DefaultsToolbar>
            ) : null}
        </FilterShell>
    );
};

export default ProjectSearchPanel;
