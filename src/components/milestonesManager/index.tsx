import dayjs, { type Dayjs } from "dayjs";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import useAppMessage from "@/components/ui/toast";
import { Typography } from "@/components/ui/typography";

import { microcopy, microcopyString } from "../../constants/microcopy";
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

const ICON_BUTTON_CLASS = "coarse:min-w-[44px]";

const toDayjsOrUndefined = (value: unknown): Dayjs | undefined => {
    if (!value) return undefined;
    const parsed = dayjs(value as string);
    return parsed.isValid() ? parsed : undefined;
};

const formatDate = (value: string | null | undefined): string => {
    const parsed = toDayjsOrUndefined(value);
    return parsed ? parsed.format(ISO_DATE_FORMAT) : "";
};

// Native `<input type="date">` emits / consumes plain "YYYY-MM-DD" strings;
// bridge them to the `Dayjs` the create/update payloads expect.
const dateInputValue = (value: Dayjs | undefined): string =>
    value ? value.format(ISO_DATE_FORMAT) : "";

const parseDateInput = (value: string): Dayjs | undefined =>
    value ? toDayjsOrUndefined(value) : undefined;

const onEnterKey =
    (handler: () => void) => (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
            event.preventDefault();
            handler();
        }
    };

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

interface ConfirmPopoverProps {
    trigger: React.ReactNode;
    title: string;
    okText: string;
    cancelText: string;
    onConfirm: () => void;
}

const ConfirmPopover: React.FC<ConfirmPopoverProps> = ({
    trigger,
    title,
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
            <Alert data-testid="milestones-load-error" variant="destructive">
                <AlertCircle aria-hidden />
                <AlertTitle>
                    {microcopyString(microcopy.milestones.loadError)}
                </AlertTitle>
            </Alert>
        );
    }

    if (isLoading && milestones.length === 0) {
        return (
            <section
                className="flex flex-col gap-md"
                data-testid="milestones-loading"
            >
                <div className="flex flex-col gap-xs">
                    {[0, 1, 2].map((index) => (
                        <div
                            className="flex flex-wrap items-center gap-sm rounded-md border border-border p-sm"
                            data-testid="milestone-skeleton-row"
                            key={index}
                        >
                            <div className="flex min-w-0 flex-[1_1_12rem] flex-col gap-xxs">
                                <Skeleton className="h-4 w-32" />
                                <Skeleton className="h-3 w-48 max-w-full" />
                                <Skeleton className="h-3 w-36 max-w-full" />
                            </div>
                            <div className="ms-auto flex items-center gap-xs">
                                <Skeleton className="h-10 w-28 rounded-md" />
                                {canManage ? (
                                    <>
                                        <Skeleton className="size-9 rounded-md" />
                                        <Skeleton className="size-9 rounded-md" />
                                    </>
                                ) : null}
                            </div>
                        </div>
                    ))}
                </div>
                {canManage ? (
                    <div
                        className="flex flex-col gap-xs border-t border-border pt-md"
                        data-testid="milestone-add-skeleton"
                    >
                        <Skeleton className="h-4 w-36" />
                        <div className="flex flex-wrap gap-xs">
                            <Skeleton className="h-10 min-w-[10rem] flex-1 rounded-md" />
                            <Skeleton className="h-10 min-w-[12rem] flex-1 rounded-md" />
                        </div>
                        <div className="flex flex-wrap gap-xs">
                            <Skeleton className="h-10 w-36 rounded-md" />
                            <Skeleton className="h-10 w-36 rounded-md" />
                            <Skeleton className="h-10 w-28 rounded-md" />
                            <Skeleton className="h-10 w-28 rounded-md" />
                        </div>
                    </div>
                ) : null}
            </section>
        );
    }

    return (
        <section
            className="flex flex-col gap-md"
            data-testid="milestones-manager"
        >
            {milestones.length === 0 ? (
                <Typography.Text
                    data-testid="milestones-empty"
                    type="secondary"
                >
                    {microcopyString(microcopy.milestones.empty)}
                </Typography.Text>
            ) : (
                <ul
                    aria-label={microcopyString(
                        microcopy.milestones.listAriaLabel
                    )}
                    className="m-0 flex list-none flex-col gap-xs p-0"
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
                        const currentState =
                            milestone.state === "closed" ? "closed" : "open";
                        return (
                            <li
                                className="m-0 flex flex-wrap items-center gap-sm rounded-md border border-border p-sm"
                                data-milestone-id={milestone._id}
                                data-testid="milestone-row"
                                key={milestone._id}
                            >
                                <div className="flex min-w-0 flex-[1_1_12rem] flex-col gap-xxs">
                                    <Typography.Text strong>
                                        {milestone.name}
                                    </Typography.Text>
                                    {milestone.description ? (
                                        <span className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">
                                            {milestone.description}
                                        </span>
                                    ) : null}
                                    {rangeText ? (
                                        <span
                                            className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground"
                                            data-testid="milestone-date-range"
                                        >
                                            {rangeText}
                                        </span>
                                    ) : null}
                                </div>
                                <div className="ms-auto flex flex-wrap items-center gap-xs">
                                    {/* One state control per row: managers
                                     * get the Select (which already shows
                                     * the current state), read-only viewers
                                     * get the Tag. Rendering both would
                                     * duplicate the state callout. */}
                                    {canManage ? (
                                        <Select
                                            onValueChange={(state) =>
                                                handleStateChange(
                                                    milestone._id,
                                                    state as MilestoneState
                                                )
                                            }
                                            value={currentState}
                                        >
                                            <SelectTrigger
                                                aria-label={microcopyString(
                                                    microcopy.milestones
                                                        .statePlaceholder
                                                )}
                                                className="w-28"
                                                data-testid="milestone-state-select"
                                            >
                                                {stateLabel(currentState)}
                                            </SelectTrigger>
                                            <SelectContent>
                                                {stateOptions.map((option) => (
                                                    <SelectItem
                                                        key={option.value}
                                                        value={option.value}
                                                    >
                                                        {option.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    ) : (
                                        <Badge
                                            data-testid="milestone-state-tag"
                                            variant={
                                                currentState === "closed"
                                                    ? "secondary"
                                                    : "success"
                                            }
                                        >
                                            {stateLabel(milestone.state)}
                                        </Badge>
                                    )}
                                    {canManage ? (
                                        <>
                                            <Button
                                                aria-label={microcopyString(
                                                    microcopy.milestones
                                                        .editAriaLabel
                                                ).replace(
                                                    "{name}",
                                                    milestone.name
                                                )}
                                                className={ICON_BUTTON_CLASS}
                                                data-testid="milestone-edit"
                                                onClick={() =>
                                                    isEditing
                                                        ? cancelEdit()
                                                        : beginEdit(milestone)
                                                }
                                                size="sm"
                                                variant="ghost"
                                            >
                                                <Pencil aria-hidden />
                                            </Button>
                                            <ConfirmPopover
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
                                                trigger={
                                                    <Button
                                                        aria-label={microcopyString(
                                                            microcopy.milestones
                                                                .deleteAriaLabel
                                                        ).replace(
                                                            "{name}",
                                                            milestone.name
                                                        )}
                                                        className={
                                                            ICON_BUTTON_CLASS
                                                        }
                                                        data-testid="milestone-delete"
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
                                        </>
                                    ) : null}
                                </div>
                                {canManage && isEditing && editDraft ? (
                                    <div
                                        className="flex flex-[1_1_100%] flex-col gap-xs"
                                        data-testid="milestone-edit-form"
                                    >
                                        <div className="flex flex-wrap items-center gap-xs">
                                            <Input
                                                aria-label={microcopyString(
                                                    microcopy.milestones
                                                        .addNamePlaceholder
                                                )}
                                                autoComplete="off"
                                                className="min-w-[10rem] flex-[1_1_12rem]"
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
                                            <Input
                                                aria-label={microcopyString(
                                                    microcopy.milestones
                                                        .addDescriptionPlaceholder
                                                )}
                                                autoComplete="off"
                                                className="min-w-[12rem] flex-[1_1_16rem]"
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
                                        </div>
                                        <div className="flex flex-wrap items-center gap-xs">
                                            <Input
                                                aria-label={microcopyString(
                                                    microcopy.milestones
                                                        .startDatePlaceholder
                                                )}
                                                className="w-auto"
                                                onChange={(event) =>
                                                    setEditDraft((draft) =>
                                                        draft
                                                            ? {
                                                                  ...draft,
                                                                  startDate:
                                                                      parseDateInput(
                                                                          event
                                                                              .target
                                                                              .value
                                                                      )
                                                              }
                                                            : draft
                                                    )
                                                }
                                                type="date"
                                                value={dateInputValue(
                                                    editDraft.startDate
                                                )}
                                            />
                                            <Input
                                                aria-label={microcopyString(
                                                    microcopy.milestones
                                                        .dueDatePlaceholder
                                                )}
                                                className="w-auto"
                                                onChange={(event) =>
                                                    setEditDraft((draft) =>
                                                        draft
                                                            ? {
                                                                  ...draft,
                                                                  dueDate:
                                                                      parseDateInput(
                                                                          event
                                                                              .target
                                                                              .value
                                                                      )
                                                              }
                                                            : draft
                                                    )
                                                }
                                                type="date"
                                                value={dateInputValue(
                                                    editDraft.dueDate
                                                )}
                                            />
                                            <div className="flex items-center gap-xs">
                                                <Button
                                                    data-testid="milestone-edit-save"
                                                    disabled={
                                                        !editDraft.name.trim() ||
                                                        isUpdating
                                                    }
                                                    loading={isUpdating}
                                                    onClick={saveEdit}
                                                    variant="primary"
                                                >
                                                    {microcopyString(
                                                        microcopy.milestones
                                                            .save
                                                    )}
                                                </Button>
                                                <Button
                                                    data-testid="milestone-edit-cancel"
                                                    onClick={cancelEdit}
                                                    variant="default"
                                                >
                                                    {microcopyString(
                                                        microcopy.milestones
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
                        {microcopyString(microcopy.milestones.addHeading)}
                    </Typography.Text>
                    <div className="flex flex-wrap items-center gap-xs">
                        <Input
                            aria-label={microcopyString(
                                microcopy.milestones.addNamePlaceholder
                            )}
                            autoComplete="off"
                            className="min-w-[10rem] flex-[1_1_12rem]"
                            data-testid="milestone-add-name"
                            enterKeyHint="done"
                            inputMode="text"
                            onChange={(event) => setNewName(event.target.value)}
                            onKeyDown={onEnterKey(handleAdd)}
                            placeholder={microcopyString(
                                microcopy.milestones.addNamePlaceholder
                            )}
                            value={newName}
                        />
                        <Input
                            aria-label={microcopyString(
                                microcopy.milestones.addDescriptionPlaceholder
                            )}
                            autoComplete="off"
                            className="min-w-[12rem] flex-[1_1_16rem]"
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
                    </div>
                    <div className="flex flex-wrap items-center gap-xs">
                        <Input
                            aria-label={microcopyString(
                                microcopy.milestones.startDatePlaceholder
                            )}
                            className="w-auto"
                            data-testid="milestone-add-start"
                            onChange={(event) =>
                                setNewStartDate(
                                    parseDateInput(event.target.value)
                                )
                            }
                            type="date"
                            value={dateInputValue(newStartDate)}
                        />
                        <Input
                            aria-label={microcopyString(
                                microcopy.milestones.dueDatePlaceholder
                            )}
                            className="w-auto"
                            data-testid="milestone-add-due"
                            onChange={(event) =>
                                setNewDueDate(
                                    parseDateInput(event.target.value)
                                )
                            }
                            type="date"
                            value={dateInputValue(newDueDate)}
                        />
                        <Select
                            onValueChange={(value) =>
                                setNewState(value as MilestoneState)
                            }
                            value={newState}
                        >
                            <SelectTrigger
                                aria-label={microcopyString(
                                    microcopy.milestones.statePlaceholder
                                )}
                                className="w-28"
                                data-testid="milestone-add-state"
                            >
                                {stateLabel(newState)}
                            </SelectTrigger>
                            <SelectContent>
                                {stateOptions.map((option) => (
                                    <SelectItem
                                        key={option.value}
                                        value={option.value}
                                    >
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button
                            data-testid="milestone-add-submit"
                            disabled={!newName.trim() || isCreating}
                            loading={isCreating}
                            onClick={handleAdd}
                            variant="primary"
                        >
                            {isCreating
                                ? microcopyString(microcopy.milestones.adding)
                                : microcopyString(
                                      microcopy.milestones.addButton
                                  )}
                        </Button>
                    </div>
                </div>
            ) : null}
        </section>
    );
};

export default MilestonesManager;
