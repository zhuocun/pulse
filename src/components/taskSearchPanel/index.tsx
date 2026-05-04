import { SearchOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Button, Input, Select } from "antd";
import React, { useMemo } from "react";

import { microcopy } from "../../constants/microcopy";
import { breakpoints, radius, space } from "../../theme/tokens";
import useAuth from "../../utils/hooks/useAuth";
import FilterChips, { FilterChip } from "../filterChips";

export interface TaskSearchParam {
    taskName: string | null;
    coordinatorId: string | null;
    type: string | null;
    semanticIds?: string | null;
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

const TaskSearchPanel: React.FC<Props> = ({
    tasks,
    param,
    setParam,
    members,
    loading,
    aiSearchSlot
}) => {
    const { user } = useAuth();
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

    return (
        <FilterShell>
            {aiSearchSlot}
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
                        type="search"
                        value={param.taskName ?? ""}
                    />
                </FlexInput>
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
                            <Select.Option value={member._id} key={member._id}>
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
            <FilterChips chips={chips} onDismiss={dismissChip} />
        </FilterShell>
    );
};

export default TaskSearchPanel;
