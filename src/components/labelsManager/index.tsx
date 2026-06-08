import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import {
    Button,
    Input,
    Popconfirm,
    Skeleton,
    Space,
    Tag,
    Typography
} from "antd";
import React, { useCallback, useMemo, useState } from "react";

import { microcopy, microcopyString } from "../../constants/microcopy";
import {
    fontSize,
    fontWeight,
    radius,
    space,
    touchTargetCoarse
} from "../../theme/tokens";
import useAppMessage from "../../utils/hooks/useAppMessage";
import useAuth from "../../utils/hooks/useAuth";
import useLabels from "../../utils/hooks/useLabels";
import useProjectMembers from "../../utils/hooks/useProjectMembers";
import useReactQuery from "../../utils/hooks/useReactQuery";

/**
 * Project label management surface (PRD-GAP-011 — backend Collaboration
 * label feature).
 *
 * Lists the project's labels (name + colour chip) and — for an
 * editor-or-above — lets the caller create, rename / re-colour, and
 * delete them. RBAC mirrors the milestones / members managers exactly:
 * the list read is viewer-gated, the writes are editor-gated. The
 * caller's project role is derived from the same signals those managers
 * use (`useProjectMembers` roster role + the project's `managerId`), so a
 * viewer / guest sees the list read-only (chips, no controls) rather than
 * controls that would 403. A residual 403 (a stale role, a cold deep-link
 * race) still surfaces as an error toast via each mutation's `catch`.
 *
 * Delete relies on the server cascade-strip: removing a label drops its
 * id from every task in the project, so the board's label chips for the
 * deleted label disappear once the tasks query refetches. The confirm
 * spells this out so the editor knows the delete is project-wide.
 *
 * Mutations invalidate the per-project label query (via `useLabels`) so
 * the list settles to the server's post-write truth.
 */

const PROJECT_QUERY = "projects" as const;

const EDITOR_ROLES = new Set(["owner", "editor"]);

const DEFAULT_COLOR = "#64748b";

/*
 * A curated swatch palette. Labels store an arbitrary colour string
 * (the backend default is "#888888" and legacy rows may carry AntD named
 * colours like "blue"), so the palette is a convenience picker rather
 * than an exhaustive enum: the editor clicks a swatch and the hex rides
 * the create / update payload. An existing colour outside the palette
 * still renders correctly on the chip and is shown as the selected swatch
 * via its own trailing entry.
 */
const COLOR_PRESETS: readonly string[] = [
    "#64748b",
    "#ef4444",
    "#f97316",
    "#f59e0b",
    "#eab308",
    "#22c55e",
    "#14b8a6",
    "#3b82f6",
    "#6366f1",
    "#a855f7",
    "#ec4899"
];

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
    align-items: center;
    display: flex;
    flex: 1 1 12rem;
    gap: ${space.sm}px;
    min-width: 0;
`;

const Controls = styled.div`
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: ${space.xs}px;
    margin-inline-start: auto;
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

const FieldRow = styled.div`
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

const Swatches = styled.div`
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: ${space.xxs}px;
`;

const Swatch = styled.button<{ $color: string; $selected: boolean }>`
    background: ${({ $color }) => $color};
    border: 2px solid
        ${({ $selected }) =>
            $selected
                ? "var(--ant-color-text, rgba(15, 23, 42, 0.92))"
                : "transparent"};
    border-radius: ${radius.sm}px;
    cursor: pointer;
    height: 24px;
    padding: 0;
    width: 24px;

    &:focus-visible {
        outline: 2px solid var(--ant-color-primary, #ea580c);
        outline-offset: 1px;
    }

    @media (pointer: coarse) {
        min-height: ${touchTargetCoarse}px;
        min-width: ${touchTargetCoarse}px;
    }
`;

const AddButton = styled(Button)`
    @media (pointer: coarse) {
        min-height: ${touchTargetCoarse}px;
    }
`;

interface LabelsManagerProps {
    projectId: string;
}

interface ColorPaletteProps {
    value: string;
    onChange: (color: string) => void;
    testId?: string;
}

const ColorPalette: React.FC<ColorPaletteProps> = ({
    value,
    onChange,
    testId
}) => {
    // Include the current colour as a trailing swatch when it isn't one
    // of the presets, so an editor opening an off-palette legacy label
    // still sees their colour selected rather than a blank slate.
    const presets = useMemo(
        () =>
            COLOR_PRESETS.includes(value)
                ? COLOR_PRESETS
                : [...COLOR_PRESETS, value],
        [value]
    );
    return (
        <Swatches
            role="radiogroup"
            aria-label={microcopyString(microcopy.projectLabels.colorLabel)}
            data-testid={testId}
        >
            {presets.map((color) => (
                <Swatch
                    key={color}
                    $color={color}
                    $selected={color === value}
                    aria-checked={color === value}
                    aria-label={microcopyString(
                        microcopy.projectLabels.colorSwatchAriaLabel
                    ).replace("{color}", color)}
                    data-color={color}
                    onClick={() => onChange(color)}
                    role="radio"
                    type="button"
                />
            ))}
        </Swatches>
    );
};

interface EditDraft {
    name: string;
    color: string;
}

const LabelsManager: React.FC<LabelsManagerProps> = ({ projectId }) => {
    const message = useAppMessage();
    const { user } = useAuth();
    const currentUserId = user?._id;

    const {
        labels: labelData,
        isLoading,
        createLabel,
        isCreating,
        updateLabel,
        isUpdating,
        removeLabel
    } = useLabels(projectId);
    const { data: project } = useReactQuery<IProject>(PROJECT_QUERY, {
        projectId
    });
    const { data: rosterData } = useProjectMembers(projectId);

    const labels = useMemo(
        () => (Array.isArray(labelData) ? labelData : []),
        [labelData]
    );
    const roster = useMemo(
        () => (Array.isArray(rosterData) ? rosterData : []),
        [rosterData]
    );

    // The list query has no `isError` flag (it shares `useLabels`'s read
    // path, which normalizes a non-array payload to `undefined`); a hard
    // fetch failure surfaces as a still-loading state that never
    // resolves, so we lean on the skeleton + empty hint rather than a
    // dedicated error alert. Reuse the same role mechanism the members /
    // milestones managers use: the project manager is an implicit owner,
    // otherwise the caller's roster role must be editor-or-above. Fail
    // closed until both the project (for `managerId`) and the caller
    // identity have resolved so a cold deep-link race can't briefly
    // expose writes that would 403.
    const canManage = useMemo(() => {
        if (!currentUserId) return false;
        if (!project) return false;
        if (project.managerId === currentUserId) return true;
        return roster.some(
            (member) =>
                member._id === currentUserId && EDITOR_ROLES.has(member.role)
        );
    }, [currentUserId, project, roster]);

    const [newName, setNewName] = useState("");
    const [newColor, setNewColor] = useState<string>(DEFAULT_COLOR);

    const [editingId, setEditingId] = useState<string | undefined>(undefined);
    const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

    const handleAdd = useCallback(async () => {
        const trimmed = newName.trim();
        if (!trimmed) return;
        try {
            await createLabel({ name: trimmed, color: newColor });
            setNewName("");
            setNewColor(DEFAULT_COLOR);
            message.success(microcopyString(microcopy.projectLabels.created));
        } catch {
            message.error(microcopyString(microcopy.projectLabels.createError));
        }
    }, [createLabel, message, newColor, newName]);

    const beginEdit = useCallback((label: ILabel) => {
        setEditingId(label._id);
        setEditDraft({ name: label.name, color: label.color || DEFAULT_COLOR });
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
            await updateLabel({
                _id: editingId,
                name: trimmed,
                color: editDraft.color
            });
            setEditingId(undefined);
            setEditDraft(null);
            message.success(microcopyString(microcopy.projectLabels.updated));
        } catch {
            message.error(microcopyString(microcopy.projectLabels.updateError));
        }
    }, [editDraft, editingId, message, updateLabel]);

    const handleRemove = useCallback(
        async (id: string) => {
            try {
                await removeLabel(id);
                message.success(
                    microcopyString(microcopy.projectLabels.deleted)
                );
            } catch {
                message.error(
                    microcopyString(microcopy.projectLabels.deleteError)
                );
            }
        },
        [message, removeLabel]
    );

    if (isLoading && labels.length === 0) {
        return (
            <div data-testid="labels-loading">
                <Skeleton active paragraph={{ rows: 3 }} />
            </div>
        );
    }

    return (
        <Wrapper data-testid="labels-manager">
            {!canManage ? (
                <Typography.Text
                    data-testid="labels-read-only-hint"
                    type="secondary"
                    style={{ fontSize: fontSize.sm }}
                >
                    {microcopyString(microcopy.projectLabels.readOnlyHint)}
                </Typography.Text>
            ) : null}

            {labels.length === 0 ? (
                <Typography.Text
                    data-testid="labels-empty"
                    type="secondary"
                    style={{ fontSize: fontSize.sm }}
                >
                    {microcopyString(microcopy.projectLabels.empty)}
                </Typography.Text>
            ) : (
                <List
                    aria-label={microcopyString(
                        microcopy.projectLabels.listAriaLabel
                    )}
                >
                    {labels.map((label) => {
                        const isEditing = editingId === label._id;
                        return (
                            <Row
                                key={label._id}
                                data-testid="label-row"
                                data-label-id={label._id}
                            >
                                <Identity>
                                    <Tag
                                        color={label.color || undefined}
                                        data-testid="label-chip"
                                    >
                                        {label.name}
                                    </Tag>
                                </Identity>
                                {canManage ? (
                                    <Controls>
                                        <IconButton
                                            aria-label={microcopyString(
                                                microcopy.projectLabels
                                                    .editAriaLabel
                                            ).replace("{name}", label.name)}
                                            data-testid="label-edit"
                                            icon={<EditOutlined aria-hidden />}
                                            onClick={() =>
                                                isEditing
                                                    ? cancelEdit()
                                                    : beginEdit(label)
                                            }
                                            size="small"
                                            type="text"
                                        />
                                        <Popconfirm
                                            cancelText={
                                                microcopy.projectLabels.cancel
                                            }
                                            description={
                                                microcopy.projectLabels
                                                    .deleteConfirmBody
                                            }
                                            okText={
                                                microcopy.projectLabels.delete
                                            }
                                            onConfirm={() =>
                                                handleRemove(label._id)
                                            }
                                            title={microcopyString(
                                                microcopy.projectLabels
                                                    .deleteConfirmTitle
                                            ).replace("{name}", label.name)}
                                        >
                                            <IconButton
                                                aria-label={microcopyString(
                                                    microcopy.projectLabels
                                                        .deleteAriaLabel
                                                ).replace("{name}", label.name)}
                                                danger
                                                data-testid="label-delete"
                                                icon={
                                                    <DeleteOutlined
                                                        aria-hidden
                                                    />
                                                }
                                                size="small"
                                                type="text"
                                            />
                                        </Popconfirm>
                                    </Controls>
                                ) : null}
                                {canManage && isEditing && editDraft ? (
                                    <EditRow data-testid="label-edit-form">
                                        <FieldRow>
                                            <NameInput
                                                aria-label={microcopyString(
                                                    microcopy.projectLabels
                                                        .addNamePlaceholder
                                                )}
                                                data-testid="label-edit-name"
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
                                                onPressEnter={saveEdit}
                                                placeholder={microcopyString(
                                                    microcopy.projectLabels
                                                        .addNamePlaceholder
                                                )}
                                                value={editDraft.name}
                                            />
                                        </FieldRow>
                                        <FieldRow>
                                            <ColorPalette
                                                onChange={(color) =>
                                                    setEditDraft((draft) =>
                                                        draft
                                                            ? {
                                                                  ...draft,
                                                                  color
                                                              }
                                                            : draft
                                                    )
                                                }
                                                testId="label-edit-color"
                                                value={editDraft.color}
                                            />
                                            <Space>
                                                <Button
                                                    data-testid="label-edit-save"
                                                    disabled={
                                                        !editDraft.name.trim() ||
                                                        isUpdating
                                                    }
                                                    loading={isUpdating}
                                                    onClick={saveEdit}
                                                    type="primary"
                                                >
                                                    {microcopyString(
                                                        microcopy.projectLabels
                                                            .save
                                                    )}
                                                </Button>
                                                <Button
                                                    data-testid="label-edit-cancel"
                                                    onClick={cancelEdit}
                                                >
                                                    {microcopyString(
                                                        microcopy.projectLabels
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
                        {microcopyString(microcopy.projectLabels.addHeading)}
                    </AddHeading>
                    <FieldRow>
                        <NameInput
                            aria-label={microcopyString(
                                microcopy.projectLabels.addNamePlaceholder
                            )}
                            data-testid="label-add-name"
                            onChange={(event) => setNewName(event.target.value)}
                            onPressEnter={handleAdd}
                            placeholder={microcopyString(
                                microcopy.projectLabels.addNamePlaceholder
                            )}
                            value={newName}
                        />
                    </FieldRow>
                    <FieldRow>
                        <ColorPalette
                            onChange={setNewColor}
                            testId="label-add-color"
                            value={newColor}
                        />
                        <AddButton
                            data-testid="label-add-submit"
                            disabled={!newName.trim() || isCreating}
                            loading={isCreating}
                            onClick={handleAdd}
                            type="primary"
                        >
                            {isCreating
                                ? microcopyString(
                                      microcopy.projectLabels.adding
                                  )
                                : microcopyString(
                                      microcopy.projectLabels.addButton
                                  )}
                        </AddButton>
                    </FieldRow>
                </AddSection>
            ) : null}
        </Wrapper>
    );
};

export default LabelsManager;
