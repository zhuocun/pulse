import { SearchOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Input, Select, Spin } from "antd";
import React, { useEffect, useMemo, useRef, useState } from "react";

import { microcopy } from "../../constants/microcopy";
import { breakpoints, radius, space } from "../../theme/tokens";
import FilterChips, { FilterChip } from "../filterChips";

export interface ProjectSearchParam {
    projectName: string | null;
    managerId: string | null;
    semanticIds?: string | null;
}

interface Props {
    param: ProjectSearchParam;
    setParam: (params: Partial<ProjectSearchParam>) => void;
    members: IMember[];
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

const PROJECT_NAME_DEBOUNCE_MS = 300;

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

const ProjectSearchPanel: React.FC<Props> = ({
    param,
    setParam,
    members,
    loading,
    aiSearchSlot
}) => {
    const [draftProjectName, setDraftProjectName] = useState(
        () => param.projectName ?? ""
    );
    const projectNameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
        null
    );

    useEffect(() => {
        if (projectNameDebounceRef.current) {
            clearTimeout(projectNameDebounceRef.current);
            projectNameDebounceRef.current = null;
        }
        setDraftProjectName(param.projectName ?? "");
    }, [param.projectName]);

    useEffect(
        () => () => {
            if (projectNameDebounceRef.current) {
                clearTimeout(projectNameDebounceRef.current);
            }
        },
        []
    );

    const scheduleProjectNameCommit = (value: string) => {
        if (projectNameDebounceRef.current) {
            clearTimeout(projectNameDebounceRef.current);
        }
        projectNameDebounceRef.current = setTimeout(() => {
            projectNameDebounceRef.current = null;
            setParam({ projectName: value });
        }, PROJECT_NAME_DEBOUNCE_MS);
    };

    const cancelProjectNameDebounce = () => {
        if (projectNameDebounceRef.current) {
            clearTimeout(projectNameDebounceRef.current);
            projectNameDebounceRef.current = null;
        }
    };

    const managerName = members.find(
        (u) => u._id === param.managerId
    )?.username;

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
        return active;
    }, [param.projectName, param.managerId, param.semanticIds, managerName]);

    const dismiss = (key: string) => {
        if (key === "projectName") {
            cancelProjectNameDebounce();
            setParam({ ...param, projectName: "" });
        } else if (key === "managerId") {
            setParam({ ...param, managerId: "" });
        } else if (key === "semanticIds") {
            setParam({ ...param, semanticIds: undefined });
        }
    };

    const clearAll = () => {
        cancelProjectNameDebounce();
        setParam({
            projectName: "",
            managerId: "",
            semanticIds: undefined
        });
    };

    return (
        <FilterShell>
            {aiSearchSlot}
            <FilterRow role="search" aria-label={microcopy.a11y.filterProjects}>
                <FlexInput>
                    <Input
                        aria-label={microcopy.a11y.searchProjectsByName}
                        allowClear
                        autoComplete="off"
                        disabled={loading}
                        enterKeyHint="search"
                        inputMode="search"
                        onChange={(e) => {
                            const value = e.target.value;
                            setDraftProjectName(value);
                            scheduleProjectNameCommit(value);
                        }}
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
                            loading ? <Spin aria-hidden size="small" /> : null
                        }
                        type="search"
                        value={draftProjectName}
                    />
                </FlexInput>
                <FlexSelect>
                    <Select
                        allowClear
                        aria-label={microcopy.a11y.filterByManager}
                        disabled={loading}
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
            </FilterRow>
            <FilterChips
                chips={chips}
                onClearAll={clearAll}
                onDismiss={dismiss}
            />
        </FilterShell>
    );
};

export default ProjectSearchPanel;
