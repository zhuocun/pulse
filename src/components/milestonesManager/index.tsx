import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import {
    Alert,
    Button,
    DatePicker,
    Input,
    Popconfirm,
    Select,
    Skeleton,
    Space,
    Tag,
    Typography
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import React, { useCallback, useMemo, useState } from "react";

import { microcopy, microcopyString } from "../../constants/microcopy";
import {
    fontSize,
    fontWeight,
    space,
    touchTargetCoarse
} from "../../theme/tokens";
import useAppMessage from "../../utils/hooks/useAppMessage";
import useAuth from "../../utils/hooks/useAuth";
import useMilestoneMutations from "../../utils/hooks/useMilestoneMutations";
import useMilestones from "../../utils/hooks/useMilestones";
import useProjectMembers from "../../utils/hooks/useProjectMembers";
import useReactQuery from "../../utils/hooks/useReactQuery";

/**
 * Project milestone management surface (FE-MS-1 — backend Milestones
 * feature).
 *
 * Lists the project's milestones (name, an open/closed state tag, and the
 * start → due window when set) and — for an editor-or-above — lets the
 * caller create, rename / re-date / re-state, and delete them. RBAC
 * mirrors the members manager exactly: the list read is viewer-gated, the
 * writes are editor-gated. The caller's project role is derived from the
 * same signals the members manager uses (`useProjectMembers` roster role
 * + the project's `managerId`), so a viewer / guest sees the list
 * read-only (state as a tag, no controls) rather than controls that would
 * 403. A residual 403 (a stale role, a cold deep-link race) still surfaces
 * as an error toast via each mutation's `catch`.
 *
 * Mutations invalidate the per-project milestone query (via
 * `useMilestoneMutations`) so the list settles to the server's post-write
 * truth. The state `Select` on each row is the quick open ↔ closed toggle
 * (one PUT); the Edit button expands an inline editor for name /
 * description / dates.
 */

const PROJECT_QUERY = "projects" as const;

const ISO_DATE_FORMAT = "YYYY-MM-DD";

type MilestoneState = "open" | "closed";
const STATE_ORDER: readonly MilestoneState[] = ["open", "closed"];
const DEFAULT_NEW_STATE: MilestoneState = "open";

const EDITOR_ROLES = new Set(["owner", "editor"]);

const toDayjsOrUndefined = (value: unknown): Dayjs | undefined => {
    if (!value) return undefined;
    const parsed = dayjs(value as string);
    return parsed.isValid() ? parsed : undefined;
};

const formatDate = (value: string | null | undefined): string => {
    const parsed = toDayjsOrUndefined(value);
    return parsed ? parsed.format(ISO_DATE_FORMAT) : "";
};

const Wrapper = styled.section`
    display: flex;
    flex-direction: column;
    gap: ${space.md}px;
`;

const List = styled.ul`
    display: flex;
    flex-direction: column;
    gap: ${space.xs}px;
    list-style: none;
    margin: 0;
    padding: 0;
`;

const Row = styled.li`
    align-items: center;
    border: 1px solid var(--ant-color-border-secondary, rgba(15, 23, 42, 0.08));
    border-radius: ${space.xs}px;
    display: flex;
    flex-wrap: wrap;
    gap: ${space.sm}px;
    margin: 0;
    padding: ${space.sm}px;
`;

const Identity = styled.div`
    display: flex;
    flex: 1 1 12rem;
    flex-direction: column;
    gap: ${space.xxs}px;
    min-width: 0;
`;

const MilestoneName = styled(Typography.Text)`
    && {
        font-size: ${fontSize.base}px;
        font-weight: ${fontWeight.semibold};
    }
`;

const MilestoneMeta = styled(Typography.Text)`
    && {
        color: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.45));
        font-size: ${fontSize.xs}px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
`;

const Controls = styled.div`
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: ${space.xs}px;
    margin-inline-start: auto;
`;

const StateSelect = styled(Select<MilestoneState>)`
    min-width: 7rem;

    @media (pointer: coarse) {
        .ant-select-selector {
            min-height: ${touchTargetCoarse}px;
        }
    }
`;

const IconButton = styled(Button)`
    @media (pointer: coarse) {
        min-height: ${touchTargetCoarse}px;
        min-width: ${touchTargetCoarse}px;
    }
`;

const EditRow = styled.div`
    display: flex;
    flex: 1 1 100%;
    flex-direction: column;
    gap: ${space.xs}px;
`;

const FieldRow = styled.div`
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: ${space.xs}px;
`;

const AddSection = styled.div`
    border-top: 1px solid
        var(--ant-color-border-secondary, rgba(15, 23, 42, 0.08));
    display: flex;
    flex-direction: column;
    gap: ${space.xs}px;
    padding-block-start: ${space.md}px;
`;

const AddHeading = styled(Typography.Text)`
    && {
        font-size: ${fontSize.sm}px;
        font-weight: ${fontWeight.semibold};
    }
`;

const AddRow = styled.div`
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: ${space.xs}px;
`;

const NameInput = styled(Input)`
    flex: 1 1 12rem;
    min-width: 10rem;

    @media (pointer: coarse) {
        min-height: ${touchTargetCoarse}px;
    }
`;

const DescriptionInput = styled(Input)`
    flex: 1 1 16rem;
    min-width: 12rem;

    @media (pointer: coarse) {
        min-height: ${touchTargetCoarse}px;
    }
`;

const AddStateSelect = styled(Select<MilestoneState>)`
    min-width: 7rem;

    @media (pointer: coarse) {
        .ant-select-selector {
            min-height: ${touchTargetCoarse}px;
        }
    }
`;

const AddButton = styled(Button)`
    @media (pointer: coarse) {
        min-height: ${touchTargetCoarse}px;
    }
`;

interface MilestonesManagerProps {
    projectId: string;
}

interface EditDraft {
    name: string;
    description: string;
    startDate?: Dayjs;
    dueDate?: Dayjs;
    state: MilestoneState;
}

const MilestonesManager: React.FC<MilestonesManagerProps> = ({ projectId }) => {
    const message = useAppMessage();
    const { user } = useAuth();
    const currentUserId = user?._id;

    const {
        data: milestoneData,
        isLoading,
        isError
    } = useMilestones(projectId);
    const { data: project } = useReactQuery<IProject>(PROJECT_QUERY, {
        projectId
    });
    const { data: rosterData } = useProjectMembers(projectId);

    const {
        createMilestone,
        isCreating,
        updateMilestone,
        isUpdating,
        removeMilestone
    } = useMilestoneMutations(projectId);

    // Guard the shared query cache: the list endpoint returns an array,
    // but the cache is shared with the write mutations' key — a stray
    // string ack ("Milestone created") or an errored body must not crash
    // the `.map` consumer. Mirror the `Array.isArray` normalization used
    // across `useLabels` / `ProjectMembersManager`.
    const milestones = useMemo(
        () => (Array.isArray(milestoneData) ? milestoneData : []),
        [milestoneData]
    );
    const roster = useMemo(
        () => (Array.isArray(rosterData) ? rosterData : []),
        [rosterData]
    );

    // Reuse the members manager's role mechanism: the project manager is an
    // implicit owner, otherwise the caller's roster role must be
    // editor-or-above. Fail closed until both the project (for `managerId`)
    // and the caller identity have resolved so a cold deep-link race can't
    // briefly expose writes that would 403.
    const canManage = useMemo(() => {
        if (!currentUserId) return false;
        if (!project) return false;
        if (project.managerId === currentUserId) return true;
        return roster.some(
            (member) =>
                member._id === currentUserId && EDITOR_ROLES.has(member.role)
        );
    }, [currentUserId, project, roster]);

    const stateOptions = useMemo(
        () =>
            STATE_ORDER.map((value) => ({
                value,
                label: microcopyString(microcopy.milestones.states[value])
            })),
        []
    );

    const stateLabel = useCallback((state: string | undefined): string => {
        if (state === "open" || state === "closed") {
            return microcopyString(microcopy.milestones.states[state]);
        }
        return microcopyString(microcopy.milestones.states.open);
    }, []);

    // --- Add form state ---------------------------------------------------
    const [newName, setNewName] = useState("");
    const [newDescription, setNewDescription] = useState("");
    const [newStartDate, setNewStartDate] = useState<Dayjs | undefined>(
        undefined
    );
    const [newDueDate, setNewDueDate] = useState<Dayjs | undefined>(undefined);
    const [newState, setNewState] = useState<MilestoneState>(DEFAULT_NEW_STATE);

    // --- Inline edit state ------------------------------------------------
    const [editingId, setEditingId] = useState<string | undefined>(undefined);
    const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

    const handleAdd = useCallback(async () => {
        const trimmed = newName.trim();
        if (!trimmed) return;
        try {
            await createMilestone({
                name: trimmed,
                description: newDescription.trim() || undefined,
                startDate: newStartDate
                    ? newStartDate.format(ISO_DATE_FORMAT)
                    : undefined,
                dueDate: newDueDate
                    ? newDueDate.format(ISO_DATE_FORMAT)
                    : undefined,
                state: newState
            });
            setNewName("");
            setNewDescription("");
            setNewStartDate(undefined);
            setNewDueDate(undefined);
            setNewState(DEFAULT_NEW_STATE);
            message.success(microcopyString(microcopy.milestones.created));
        } catch {
            message.error(microcopyString(microcopy.milestones.createError));
        }
    }, [
        createMilestone,
        message,
        newDescription,
        newDueDate,
        newName,
        newStartDate,
        newState
    ]);

    const handleStateChange = useCallback(
        async (id: string, state: MilestoneState) => {
            try {
                await updateMilestone({ _id: id, state });
                message.success(microcopyString(microcopy.milestones.updated));
            } catch {
                message.error(
                    microcopyString(microcopy.milestones.updateError)
                );
            }
        },
        [message, updateMilestone]
    );

    const handleRemove = useCallback(
        async (id: string) => {
            try {
                await removeMilestone(id);
                message.success(microcopyString(microcopy.milestones.deleted));
            } catch {
                message.error(
                    microcopyString(microcopy.milestones.deleteError)
                );
            }
        },
        [message, removeMilestone]
    );

    const beginEdit = useCallback((milestone: IMilestone) => {
        setEditingId(milestone._id);
        setEditDraft({
            name: milestone.name,
            description: milestone.description ?? "",
            startDate: toDayjsOrUndefined(milestone.startDate),
            dueDate: toDayjsOrUndefined(milestone.dueDate),
            state: milestone.state === "closed" ? "closed" : "open"
        });
    }, []);

    const cancelEdit = useCallback(() => {
        setEditingId(undefined);
        setEditDraft(null);
    }, []);

    const saveEdit = useCallback(async () => {
        if (!editingId || !editDraft) return;
        const trimmed = editDraft.name.trim();
        if (!trimmed) return;
        try {
            await updateMilestone({
                _id: editingId,
                name: trimmed,
                description: editDraft.description.trim() || undefined,
                startDate: editDraft.startDate
                    ? editDraft.startDate.format(ISO_DATE_FORMAT)
                    : undefined,
                dueDate: editDraft.dueDate
                    ? editDraft.dueDate.format(ISO_DATE_FORMAT)
                    : undefined,
                state: editDraft.state
            });
            setEditingId(undefined);
            setEditDraft(null);
            message.success(microcopyString(microcopy.milestones.updated));
        } catch {
            message.error(microcopyString(microcopy.milestones.updateError));
        }
    }, [editDraft, editingId, message, updateMilestone]);

    if (isError) {
        return (
            <Alert
                data-testid="milestones-load-error"
                message={microcopyString(microcopy.milestones.loadError)}
                showIcon
                type="error"
            />
        );
    }

    if (isLoading && milestones.length === 0) {
        return (
            <div data-testid="milestones-loading">
                <Skeleton active paragraph={{ rows: 3 }} />
            </div>
        );
    }

    return (
        <Wrapper data-testid="milestones-manager">
            {milestones.length === 0 ? (
                <Typography.Text
                    data-testid="milestones-empty"
                    type="secondary"
                    style={{ fontSize: fontSize.sm }}
                >
                    {microcopyString(microcopy.milestones.empty)}
                </Typography.Text>
            ) : (
                <List
                    aria-label={microcopyString(
                        microcopy.milestones.listAriaLabel
                    )}
                >
                    {milestones.map((milestone) => {
                        const isEditing = editingId === milestone._id;
                        const startText = formatDate(milestone.startDate);
                        const dueText = formatDate(milestone.dueDate);
                        const rangeText =
                            startText || dueText
                                ? microcopyString(
                                      microcopy.milestones.dateRange
                                  )
                                      .replace("{start}", startText || "—")
                                      .replace("{due}", dueText || "—")
                                : "";
                        return (
                            <Row
                                key={milestone._id}
                                data-testid="milestone-row"
                                data-milestone-id={milestone._id}
                            >
                                <Identity>
                                    <MilestoneName>
                                        {milestone.name}
                                    </MilestoneName>
                                    {milestone.description ? (
                                        <MilestoneMeta>
                                            {milestone.description}
                                        </MilestoneMeta>
                                    ) : null}
                                    {rangeText ? (
                                        <MilestoneMeta data-testid="milestone-date-range">
                                            {rangeText}
                                        </MilestoneMeta>
                                    ) : null}
                                </Identity>
                                <Controls>
                                    {/* One state control per row: managers
                                     * get the Select (which already shows
                                     * the current state), read-only viewers
                                     * get the Tag. Rendering both would
                                     * duplicate the state callout. */}
                                    {canManage ? (
                                        <StateSelect
                                            aria-label={microcopyString(
                                                microcopy.milestones
                                                    .statePlaceholder
                                            )}
                                            data-testid="milestone-state-select"
                                            onChange={(state) =>
                                                handleStateChange(
                                                    milestone._id,
                                                    state
                                                )
                                            }
                                            options={stateOptions}
                                            value={
                                                milestone.state === "closed"
                                                    ? "closed"
                                                    : "open"
                                            }
                                        />
                                    ) : (
                                        <Tag
                                            color={
                                                milestone.state === "closed"
                                                    ? "default"
                                                    : "green"
                                            }
                                            data-testid="milestone-state-tag"
                                        >
                                            {stateLabel(milestone.state)}
                                        </Tag>
                                    )}
                                    {canManage ? (
                                        <>
                                            <IconButton
                                                aria-label={microcopyString(
                                                    microcopy.milestones
                                                        .editAriaLabel
                                                ).replace(
                                                    "{name}",
                                                    milestone.name
                                                )}
                                                data-testid="milestone-edit"
                                                icon={
                                                    <EditOutlined aria-hidden />
                                                }
                                                onClick={() =>
                                                    isEditing
                                                        ? cancelEdit()
                                                        : beginEdit(milestone)
                                                }
                                                size="small"
                                                type="text"
                                            />
                                            <Popconfirm
                                                cancelText={
                                                    microcopy.milestones.cancel
                                                }
                                                okText={
                                                    microcopy.milestones.delete
                                                }
                                                onConfirm={() =>
                                                    handleRemove(milestone._id)
                                                }
                                                title={microcopyString(
                                                    microcopy.milestones
                                                        .deleteConfirmTitle
                                                ).replace(
                                                    "{name}",
                                                    milestone.name
                                                )}
                                            >
                                                <IconButton
                                                    aria-label={microcopyString(
                                                        microcopy.milestones
                                                            .deleteAriaLabel
                                                    ).replace(
                                                        "{name}",
                                                        milestone.name
                                                    )}
                                                    danger
                                                    data-testid="milestone-delete"
                                                    icon={
                                                        <DeleteOutlined
                                                            aria-hidden
                                                        />
                                                    }
                                                    size="small"
                                                    type="text"
                                                />
                                            </Popconfirm>
                                        </>
                                    ) : null}
                                </Controls>
                                {canManage && isEditing && editDraft ? (
                                    <EditRow data-testid="milestone-edit-form">
                                        <FieldRow>
                                            <NameInput
                                                aria-label={microcopyString(
                                                    microcopy.milestones
                                                        .addNamePlaceholder
                                                )}
                                                autoComplete="off"
                                                data-testid="milestone-edit-name"
                                                enterKeyHint="done"
                                                inputMode="text"
                                                onChange={(event) =>
                                                    setEditDraft((draft) =>
                                                        draft
                                                            ? {
                                                                  ...draft,
                                                                  name: event
                                                                      .target
                                                                      .value
                                                              }
                                                            : draft
                                                    )
                                                }
                                                placeholder={microcopyString(
                                                    microcopy.milestones
                                                        .addNamePlaceholder
                                                )}
                                                value={editDraft.name}
                                            />
                                            <DescriptionInput
                                                aria-label={microcopyString(
                                                    microcopy.milestones
                                                        .addDescriptionPlaceholder
                                                )}
                                                autoComplete="off"
                                                data-testid="milestone-edit-description"
                                                enterKeyHint="done"
                                                inputMode="text"
                                                onChange={(event) =>
                                                    setEditDraft((draft) =>
                                                        draft
                                                            ? {
                                                                  ...draft,
                                                                  description:
                                                                      event
                                                                          .target
                                                                          .value
                                                              }
                                                            : draft
                                                    )
                                                }
                                                placeholder={microcopyString(
                                                    microcopy.milestones
                                                        .addDescriptionPlaceholder
                                                )}
                                                value={editDraft.description}
                                            />
                                        </FieldRow>
                                        <FieldRow>
                                            <DatePicker
                                                allowClear
                                                aria-label={microcopyString(
                                                    microcopy.milestones
                                                        .startDatePlaceholder
                                                )}
                                                format={ISO_DATE_FORMAT}
                                                onChange={(value) =>
                                                    setEditDraft((draft) =>
                                                        draft
                                                            ? {
                                                                  ...draft,
                                                                  startDate:
                                                                      value ??
                                                                      undefined
                                                              }
                                                            : draft
                                                    )
                                                }
                                                placeholder={microcopyString(
                                                    microcopy.milestones
                                                        .startDatePlaceholder
                                                )}
                                                value={editDraft.startDate}
                                            />
                                            <DatePicker
                                                allowClear
                                                aria-label={microcopyString(
                                                    microcopy.milestones
                                                        .dueDatePlaceholder
                                                )}
                                                format={ISO_DATE_FORMAT}
                                                onChange={(value) =>
                                                    setEditDraft((draft) =>
                                                        draft
                                                            ? {
                                                                  ...draft,
                                                                  dueDate:
                                                                      value ??
                                                                      undefined
                                                              }
                                                            : draft
                                                    )
                                                }
                                                placeholder={microcopyString(
                                                    microcopy.milestones
                                                        .dueDatePlaceholder
                                                )}
                                                value={editDraft.dueDate}
                                            />
                                            <Space>
                                                <Button
                                                    data-testid="milestone-edit-save"
                                                    disabled={
                                                        !editDraft.name.trim() ||
                                                        isUpdating
                                                    }
                                                    loading={isUpdating}
                                                    onClick={saveEdit}
                                                    type="primary"
                                                >
                                                    {microcopyString(
                                                        microcopy.milestones
                                                            .save
                                                    )}
                                                </Button>
                                                <Button
                                                    data-testid="milestone-edit-cancel"
                                                    onClick={cancelEdit}
                                                >
                                                    {microcopyString(
                                                        microcopy.milestones
                                                            .cancel
                                                    )}
                                                </Button>
                                            </Space>
                                        </FieldRow>
                                    </EditRow>
                                ) : null}
                            </Row>
                        );
                    })}
                </List>
            )}

            {canManage ? (
                <AddSection>
                    <AddHeading>
                        {microcopyString(microcopy.milestones.addHeading)}
                    </AddHeading>
                    <AddRow>
                        <NameInput
                            aria-label={microcopyString(
                                microcopy.milestones.addNamePlaceholder
                            )}
                            autoComplete="off"
                            data-testid="milestone-add-name"
                            enterKeyHint="done"
                            inputMode="text"
                            onChange={(event) => setNewName(event.target.value)}
                            onPressEnter={handleAdd}
                            placeholder={microcopyString(
                                microcopy.milestones.addNamePlaceholder
                            )}
                            value={newName}
                        />
                        <DescriptionInput
                            aria-label={microcopyString(
                                microcopy.milestones.addDescriptionPlaceholder
                            )}
                            autoComplete="off"
                            data-testid="milestone-add-description"
                            enterKeyHint="done"
                            inputMode="text"
                            onChange={(event) =>
                                setNewDescription(event.target.value)
                            }
                            placeholder={microcopyString(
                                microcopy.milestones.addDescriptionPlaceholder
                            )}
                            value={newDescription}
                        />
                    </AddRow>
                    <AddRow>
                        <DatePicker
                            allowClear
                            aria-label={microcopyString(
                                microcopy.milestones.startDatePlaceholder
                            )}
                            data-testid="milestone-add-start"
                            format={ISO_DATE_FORMAT}
                            onChange={(value) =>
                                setNewStartDate(value ?? undefined)
                            }
                            placeholder={microcopyString(
                                microcopy.milestones.startDatePlaceholder
                            )}
                            value={newStartDate}
                        />
                        <DatePicker
                            allowClear
                            aria-label={microcopyString(
                                microcopy.milestones.dueDatePlaceholder
                            )}
                            data-testid="milestone-add-due"
                            format={ISO_DATE_FORMAT}
                            onChange={(value) =>
                                setNewDueDate(value ?? undefined)
                            }
                            placeholder={microcopyString(
                                microcopy.milestones.dueDatePlaceholder
                            )}
                            value={newDueDate}
                        />
                        <AddStateSelect
                            aria-label={microcopyString(
                                microcopy.milestones.statePlaceholder
                            )}
                            data-testid="milestone-add-state"
                            onChange={(value) => setNewState(value)}
                            options={stateOptions}
                            placeholder={microcopyString(
                                microcopy.milestones.statePlaceholder
                            )}
                            value={newState}
                        />
                        <AddButton
                            data-testid="milestone-add-submit"
                            disabled={!newName.trim() || isCreating}
                            loading={isCreating}
                            onClick={handleAdd}
                            type="primary"
                        >
                            {isCreating
                                ? microcopyString(microcopy.milestones.adding)
                                : microcopyString(
                                      microcopy.milestones.addButton
                                  )}
                        </AddButton>
                    </AddRow>
                </AddSection>
            ) : null}
        </Wrapper>
    );
};

export default MilestonesManager;
