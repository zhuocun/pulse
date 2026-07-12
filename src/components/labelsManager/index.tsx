import { AlertCircle, Pencil, Trash2 } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";

import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

import { microcopy, microcopyString } from "../../constants/microcopy";
import useAppMessage from "../../utils/hooks/useAppMessage";
import useAuth from "../../utils/hooks/useAuth";
import useLabels from "../../utils/hooks/useLabels";
import useProjectMembers from "../../utils/hooks/useProjectMembers";
import useReactQuery from "../../utils/hooks/useReactQuery";
import { labelTagProps } from "../../utils/labelTagColor";

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

const ICON_BUTTON_CLASS = "coarse:min-w-[44px]";
const NAME_INPUT_CLASS = "flex-[1_1_12rem] min-w-[10rem]";

const onEnterKey =
    (handler: () => void) => (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
            event.preventDefault();
            handler();
        }
    };

/**
 * Chip colour styling: hex labels get a translucent themed fill (via
 * `labelTagProps`); legacy AntD-named colours fall back to a coloured
 * outline so the chip still reads without an antd `Tag`.
 */
const chipStyle = (color?: string | null): React.CSSProperties | undefined => {
    const props = labelTagProps(color);
    if (props.style) return props.style;
    if (props.color) {
        return { borderColor: props.color, color: props.color };
    }
    return undefined;
};

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
        <div
            aria-label={microcopyString(microcopy.projectLabels.colorLabel)}
            className="flex flex-wrap items-center gap-xxs"
            data-testid={testId}
            role="radiogroup"
        >
            {presets.map((color) => (
                <button
                    aria-checked={color === value}
                    aria-label={microcopyString(
                        microcopy.projectLabels.colorSwatchAriaLabel
                    ).replace("{color}", color)}
                    className={cn(
                        "size-6 cursor-pointer rounded-sm border-2 p-0",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                        "coarse:min-h-[44px] coarse:min-w-[44px]",
                        color === value
                            ? "border-foreground"
                            : "border-transparent"
                    )}
                    data-color={color}
                    key={color}
                    onClick={() => onChange(color)}
                    role="radio"
                    style={{ background: color }}
                    type="button"
                />
            ))}
        </div>
    );
};

interface ConfirmPopoverProps {
    trigger: React.ReactNode;
    title: string;
    description?: string;
    okText: string;
    cancelText: string;
    onConfirm: () => void;
}

const ConfirmPopover: React.FC<ConfirmPopoverProps> = ({
    trigger,
    title,
    description,
    okText,
    cancelText,
    onConfirm
}) => {
    const [open, setOpen] = useState(false);
    return (
        <Popover onOpenChange={setOpen} open={open}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent aria-label={title} className="w-64" role="dialog">
                <p className="text-sm font-medium text-foreground">{title}</p>
                {description ? (
                    <p className="mt-xxs text-sm text-muted-foreground">
                        {description}
                    </p>
                ) : null}
                <div className="mt-sm flex justify-end gap-xs">
                    <Button
                        onClick={() => setOpen(false)}
                        size="sm"
                        variant="default"
                    >
                        {cancelText}
                    </Button>
                    <Button
                        onClick={() => {
                            setOpen(false);
                            onConfirm();
                        }}
                        size="sm"
                        variant="destructive"
                    >
                        {okText}
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
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
        isError,
        refetch,
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

    // Reuse the same role mechanism the members / milestones managers use:
    // the project manager is an implicit owner, otherwise the caller's roster
    // role must be editor-or-above. Fail closed until both the project and
    // caller identity resolve so a cold deep-link cannot briefly expose writes.
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

    if (isError) {
        return (
            <Alert data-testid="labels-load-error" variant="destructive">
                <AlertCircle aria-hidden />
                <AlertTitle>
                    {microcopyString(microcopy.projectLabels.loadError)}
                </AlertTitle>
                <div className="mt-sm">
                    <Button
                        onClick={() => void refetch()}
                        size="sm"
                        variant="primary"
                    >
                        {microcopy.actions.retry}
                    </Button>
                </div>
            </Alert>
        );
    }

    if (isLoading && labels.length === 0) {
        return (
            <section
                className="flex flex-col gap-md"
                data-testid="labels-loading"
            >
                <div className="flex flex-col gap-xs">
                    {[0, 1, 2].map((index) => (
                        <div
                            className="flex items-center gap-sm rounded-md border border-border p-sm"
                            data-testid="label-skeleton-row"
                            key={index}
                        >
                            <div className="min-w-0 flex-1">
                                <Skeleton className="h-6 w-32 max-w-full rounded-full" />
                            </div>
                            {canManage ? (
                                <div className="ms-auto flex items-center gap-xs">
                                    <Skeleton className="size-9 rounded-md" />
                                    <Skeleton className="size-9 rounded-md" />
                                </div>
                            ) : null}
                        </div>
                    ))}
                </div>
                {canManage ? (
                    <div
                        className="flex flex-col gap-xs border-t border-border pt-md"
                        data-testid="label-add-skeleton"
                    >
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-10 w-full rounded-md" />
                        <div className="flex items-center gap-xs">
                            <Skeleton className="h-10 flex-1 rounded-md" />
                            <Skeleton className="h-10 w-24 rounded-md" />
                        </div>
                    </div>
                ) : null}
            </section>
        );
    }

    return (
        <section className="flex flex-col gap-md" data-testid="labels-manager">
            {!canManage ? (
                <Typography.Text
                    data-testid="labels-read-only-hint"
                    type="secondary"
                >
                    {microcopyString(microcopy.projectLabels.readOnlyHint)}
                </Typography.Text>
            ) : null}

            {labels.length === 0 ? (
                <Typography.Text data-testid="labels-empty" type="secondary">
                    {microcopyString(microcopy.projectLabels.empty)}
                </Typography.Text>
            ) : (
                <ul
                    aria-label={microcopyString(
                        microcopy.projectLabels.listAriaLabel
                    )}
                    className="m-0 flex list-none flex-col gap-xs p-0"
                >
                    {labels.map((label) => {
                        const isEditing = editingId === label._id;
                        return (
                            <li
                                className="m-0 flex flex-wrap items-center gap-sm rounded-md border border-border p-sm"
                                data-label-id={label._id}
                                data-testid="label-row"
                                key={label._id}
                            >
                                <div className="flex min-w-0 flex-[1_1_12rem] items-center gap-sm">
                                    <Badge
                                        className="max-w-full min-w-0 truncate"
                                        data-testid="label-chip"
                                        style={chipStyle(label.color)}
                                        title={label.name}
                                        variant="outline"
                                    >
                                        {label.name}
                                    </Badge>
                                </div>
                                {canManage ? (
                                    <div className="ms-auto flex flex-wrap items-center gap-xs">
                                        <Button
                                            aria-label={microcopyString(
                                                microcopy.projectLabels
                                                    .editAriaLabel
                                            ).replace("{name}", label.name)}
                                            className={ICON_BUTTON_CLASS}
                                            data-testid="label-edit"
                                            onClick={() =>
                                                isEditing
                                                    ? cancelEdit()
                                                    : beginEdit(label)
                                            }
                                            size="sm"
                                            variant="ghost"
                                        >
                                            <Pencil aria-hidden />
                                        </Button>
                                        <ConfirmPopover
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
                                            trigger={
                                                <Button
                                                    aria-label={microcopyString(
                                                        microcopy.projectLabels
                                                            .deleteAriaLabel
                                                    ).replace(
                                                        "{name}",
                                                        label.name
                                                    )}
                                                    className={
                                                        ICON_BUTTON_CLASS
                                                    }
                                                    data-testid="label-delete"
                                                    size="sm"
                                                    variant="ghost"
                                                >
                                                    <Trash2
                                                        aria-hidden
                                                        className="text-destructive"
                                                    />
                                                </Button>
                                            }
                                        />
                                    </div>
                                ) : null}
                                {canManage && isEditing && editDraft ? (
                                    <div
                                        className="flex flex-[1_1_100%] flex-col gap-xs"
                                        data-testid="label-edit-form"
                                    >
                                        <div className="flex flex-wrap items-center gap-xs">
                                            <Input
                                                aria-label={microcopyString(
                                                    microcopy.projectLabels
                                                        .addNamePlaceholder
                                                )}
                                                autoComplete="off"
                                                className={NAME_INPUT_CLASS}
                                                data-testid="label-edit-name"
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
                                                onKeyDown={onEnterKey(saveEdit)}
                                                placeholder={microcopyString(
                                                    microcopy.projectLabels
                                                        .addNamePlaceholder
                                                )}
                                                value={editDraft.name}
                                            />
                                        </div>
                                        <div className="flex flex-wrap items-center gap-xs">
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
                                            <div className="flex items-center gap-xs">
                                                <Button
                                                    data-testid="label-edit-save"
                                                    disabled={
                                                        !editDraft.name.trim() ||
                                                        isUpdating
                                                    }
                                                    loading={isUpdating}
                                                    onClick={saveEdit}
                                                    variant="primary"
                                                >
                                                    {microcopyString(
                                                        microcopy.projectLabels
                                                            .save
                                                    )}
                                                </Button>
                                                <Button
                                                    data-testid="label-edit-cancel"
                                                    onClick={cancelEdit}
                                                    variant="default"
                                                >
                                                    {microcopyString(
                                                        microcopy.projectLabels
                                                            .cancel
                                                    )}
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                ) : null}
                            </li>
                        );
                    })}
                </ul>
            )}

            {canManage ? (
                <div className="flex flex-col gap-xs border-t border-border pt-md">
                    <Typography.Text strong>
                        {microcopyString(microcopy.projectLabels.addHeading)}
                    </Typography.Text>
                    <div className="flex flex-wrap items-center gap-xs">
                        <Input
                            aria-label={microcopyString(
                                microcopy.projectLabels.addNamePlaceholder
                            )}
                            autoComplete="off"
                            className={NAME_INPUT_CLASS}
                            data-testid="label-add-name"
                            enterKeyHint="done"
                            inputMode="text"
                            onChange={(event) => setNewName(event.target.value)}
                            onKeyDown={onEnterKey(handleAdd)}
                            placeholder={microcopyString(
                                microcopy.projectLabels.addNamePlaceholder
                            )}
                            value={newName}
                        />
                    </div>
                    <div className="flex flex-wrap items-center gap-xs">
                        <ColorPalette
                            onChange={setNewColor}
                            testId="label-add-color"
                            value={newColor}
                        />
                        <Button
                            data-testid="label-add-submit"
                            disabled={!newName.trim() || isCreating}
                            loading={isCreating}
                            onClick={handleAdd}
                            variant="primary"
                        >
                            {isCreating
                                ? microcopyString(
                                      microcopy.projectLabels.adding
                                  )
                                : microcopyString(
                                      microcopy.projectLabels.addButton
                                  )}
                        </Button>
                    </div>
                </div>
            ) : null}
        </section>
    );
};

export default LabelsManager;
