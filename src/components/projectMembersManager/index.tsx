import { AlertCircle, Trash2 } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";

import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@/components/ui/tooltip";
import { Typography } from "@/components/ui/typography";

import useAppMessage from "@/components/ui/toast";

import { microcopy, microcopyString } from "../../constants/microcopy";
import useAuth from "../../utils/hooks/useAuth";
import useMembersList from "../../utils/hooks/useMembersList";
import useProjectMemberMutations from "../../utils/hooks/useProjectMemberMutations";
import useProjectMembers from "../../utils/hooks/useProjectMembers";
import useReactQuery from "../../utils/hooks/useReactQuery";
import UserAvatar from "../userAvatar";

/**
 * Project member management surface (M4 — backend Collaboration feature).
 *
 * Lists the project roster with each member's role and — for a project
 * OWNER — lets the owner add members from the global user directory,
 * change roles, and remove members. RBAC mirrors the server gates: the
 * roster read is viewer-gated; add / change-role / remove are
 * owner-gated. A non-owner sees the roster read-only (roles as tags, no
 * controls) rather than controls that would 403.
 *
 * The project's `managerId` row is immutable server-side ("Bad request"
 * 400), so its role-change + remove controls are disabled with a badge
 * and an explanatory hint. Mutations invalidate the per-project roster
 * query (via `useProjectMemberMutations`) so the list settles to the
 * server's post-write truth.
 */

const PROJECT_QUERY = "projects" as const;

type ProjectRole = "owner" | "editor" | "viewer" | "guest";
const ROLE_ORDER: readonly ProjectRole[] = [
    "owner",
    "editor",
    "viewer",
    "guest"
];
const DEFAULT_NEW_ROLE: ProjectRole = "viewer";

const isProjectRole = (role: string): role is ProjectRole =>
    role === "owner" ||
    role === "editor" ||
    role === "viewer" ||
    role === "guest";

/*
 * The manager row gets a solid `warning`-token badge (white ink on the
 * amber fill) so it reads as an always-AA highlight without re-deriving
 * AntD's gold Tag ink, which failed WCAG AA at the 12px badge size.
 */
const MANAGER_BADGE_CLASS = "border-transparent bg-warning text-white";

const ICON_BUTTON_CLASS = "coarse:min-w-[44px]";

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

interface ProjectMembersManagerProps {
    projectId: string;
}

const ProjectMembersManager: React.FC<ProjectMembersManagerProps> = ({
    projectId
}) => {
    const message = useAppMessage();
    const { user } = useAuth();
    const currentUserId = user?._id;

    const {
        data: rosterData,
        isLoading: rosterLoading,
        isError: rosterError
    } = useProjectMembers(projectId);
    const { data: project } = useReactQuery<IProject>(PROJECT_QUERY, {
        projectId
    });
    const { data: directoryData } = useMembersList();

    const { addMember, isAdding, updateMemberRole, removeMember } =
        useProjectMemberMutations(projectId);

    const [newUserId, setNewUserId] = useState<string | undefined>(undefined);
    const [newRole, setNewRole] = useState<ProjectRole>(DEFAULT_NEW_ROLE);

    // Guard the query caches that the read + write mutations share: a
    // string ack ("Member added") or an errored body must not crash the
    // `.map` / `.some` consumers — mirror the `Array.isArray` normalization
    // used across `useLabels` / `useComments`.
    const members = useMemo(
        () => (Array.isArray(rosterData) ? rosterData : []),
        [rosterData]
    );
    const directory = useMemo(
        () => (Array.isArray(directoryData) ? directoryData : []),
        [directoryData]
    );

    const managerId = project?.managerId;

    // Fail closed until the project (and thus `managerId`) has resolved:
    // a manager row is only identifiable once `managerId` is known, so
    // exposing role-change / remove controls before then would briefly
    // offer mutations against the immutable manager row (the server
    // rejects them, but the UI must not present a control it can't honor).
    // On a cold deep-link to /members the roster query can win the race
    // against the project query, so this guard is load-bearing, not
    // theoretical. The roster stays read-only (role tags, no controls)
    // for the brief pre-resolution window.
    const canManage = useMemo(() => {
        if (!currentUserId) return false;
        if (!project) return false;
        if (project.managerId === currentUserId) return true;
        return members.some(
            (member) => member._id === currentUserId && member.role === "owner"
        );
    }, [currentUserId, project, members]);

    const roleOptions = useMemo(
        () =>
            ROLE_ORDER.map((role) => ({
                value: role,
                label: microcopyString(microcopy.members.roles[role])
            })),
        []
    );

    const roleLabel = useCallback((role: string): string => {
        if (isProjectRole(role)) {
            return microcopyString(microcopy.members.roles[role]);
        }
        return role;
    }, []);

    // Directory users not already on the roster — the pool the owner can
    // add from. Keyed by member id so the lookup stays O(roster).
    const addableUsers = useMemo(() => {
        const rosterIds = new Set(members.map((member) => member._id));
        return directory.filter((member) => !rosterIds.has(member._id));
    }, [directory, members]);

    const addableOptions = useMemo(
        () =>
            addableUsers.map((member) => ({
                value: member._id,
                label: member.email
                    ? `${member.username} (${member.email})`
                    : member.username
            })),
        [addableUsers]
    );

    const handleRoleChange = useCallback(
        async (userId: string, role: ProjectRole) => {
            try {
                await updateMemberRole({ userId, role });
            } catch {
                message.error(microcopyString(microcopy.members.updateError));
            }
        },
        [message, updateMemberRole]
    );

    const handleRemove = useCallback(
        async (userId: string) => {
            try {
                await removeMember({ userId });
            } catch {
                message.error(microcopyString(microcopy.members.removeError));
            }
        },
        [message, removeMember]
    );

    const handleAdd = useCallback(async () => {
        if (!newUserId) return;
        try {
            await addMember({ userId: newUserId, role: newRole });
            setNewUserId(undefined);
            setNewRole(DEFAULT_NEW_ROLE);
        } catch {
            message.error(microcopyString(microcopy.members.addError));
        }
    }, [addMember, message, newRole, newUserId]);

    if (rosterError) {
        return (
            <Alert data-testid="members-load-error" variant="destructive">
                <AlertCircle aria-hidden />
                <AlertTitle>
                    {microcopyString(microcopy.members.loadError)}
                </AlertTitle>
            </Alert>
        );
    }

    if (rosterLoading && members.length === 0) {
        return (
            <div className="flex flex-col gap-xs" data-testid="members-loading">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
            </div>
        );
    }

    return (
        <TooltipProvider>
            <section className="flex flex-col gap-md">
                {!canManage ? (
                    <Typography.Text
                        data-testid="members-read-only-hint"
                        type="secondary"
                    >
                        {microcopyString(microcopy.members.readOnlyHint)}
                    </Typography.Text>
                ) : null}

                {members.length === 0 ? (
                    <Typography.Text
                        data-testid="members-empty"
                        type="secondary"
                    >
                        {microcopyString(microcopy.members.empty)}
                    </Typography.Text>
                ) : (
                    <ul
                        aria-label={microcopyString(
                            microcopy.members.listAriaLabel
                        )}
                        className="m-0 flex list-none flex-col gap-xs p-0"
                    >
                        {members.map((member) => {
                            const isManager = member._id === managerId;
                            const memberName =
                                member.username || member.email || member._id;
                            const roleValue = isProjectRole(member.role)
                                ? member.role
                                : undefined;
                            return (
                                <li
                                    className="m-0 flex flex-wrap items-center gap-sm rounded-md border border-border p-sm"
                                    data-member-id={member._id}
                                    data-testid="member-row"
                                    key={member._id}
                                >
                                    <div className="flex min-w-0 flex-[1_1_12rem] items-center gap-sm">
                                        <UserAvatar
                                            id={member._id}
                                            name={memberName}
                                        />
                                        <div className="flex min-w-0 flex-col">
                                            <Typography.Text strong>
                                                {memberName}
                                            </Typography.Text>
                                            {member.email ? (
                                                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">
                                                    {member.email}
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>
                                    <div className="ms-auto flex items-center gap-xs">
                                        {isManager ? (
                                            <Badge
                                                className={MANAGER_BADGE_CLASS}
                                                data-testid="member-manager-badge"
                                            >
                                                {microcopyString(
                                                    microcopy.members
                                                        .managerBadge
                                                )}
                                            </Badge>
                                        ) : null}
                                        {canManage && !isManager ? (
                                            <Select
                                                onValueChange={(role) =>
                                                    handleRoleChange(
                                                        member._id,
                                                        role as ProjectRole
                                                    )
                                                }
                                                value={roleValue}
                                            >
                                                <SelectTrigger
                                                    aria-label={microcopyString(
                                                        microcopy.members
                                                            .changeRoleAriaLabel
                                                    ).replace(
                                                        "{name}",
                                                        memberName
                                                    )}
                                                    className="w-32"
                                                    data-testid="member-role-select"
                                                >
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {roleOptions.map(
                                                        (option) => (
                                                            <SelectItem
                                                                key={
                                                                    option.value
                                                                }
                                                                value={
                                                                    option.value
                                                                }
                                                            >
                                                                {option.label}
                                                            </SelectItem>
                                                        )
                                                    )}
                                                </SelectContent>
                                            </Select>
                                        ) : (
                                            <Badge
                                                data-testid="member-role-tag"
                                                variant="outline"
                                            >
                                                {roleLabel(member.role)}
                                            </Badge>
                                        )}
                                        {canManage ? (
                                            isManager ? (
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <span>
                                                            <Button
                                                                aria-label={microcopyString(
                                                                    microcopy
                                                                        .members
                                                                        .removeAriaLabel
                                                                ).replace(
                                                                    "{name}",
                                                                    memberName
                                                                )}
                                                                className={
                                                                    ICON_BUTTON_CLASS
                                                                }
                                                                data-testid="member-remove"
                                                                disabled
                                                                size="sm"
                                                                variant="ghost"
                                                            >
                                                                <Trash2
                                                                    aria-hidden
                                                                    className="text-destructive"
                                                                />
                                                            </Button>
                                                        </span>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        {microcopyString(
                                                            microcopy.members
                                                                .managerImmutableHint
                                                        )}
                                                    </TooltipContent>
                                                </Tooltip>
                                            ) : (
                                                <ConfirmPopover
                                                    cancelText={
                                                        microcopy.actions.cancel
                                                    }
                                                    okText={
                                                        microcopy.members.remove
                                                    }
                                                    onConfirm={() =>
                                                        handleRemove(member._id)
                                                    }
                                                    title={microcopyString(
                                                        microcopy.members
                                                            .removeConfirmTitle
                                                    ).replace(
                                                        "{name}",
                                                        memberName
                                                    )}
                                                    trigger={
                                                        <Button
                                                            aria-label={microcopyString(
                                                                microcopy
                                                                    .members
                                                                    .removeAriaLabel
                                                            ).replace(
                                                                "{name}",
                                                                memberName
                                                            )}
                                                            className={
                                                                ICON_BUTTON_CLASS
                                                            }
                                                            data-testid="member-remove"
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
                                            )
                                        ) : null}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}

                {canManage ? (
                    <div className="flex flex-col gap-xs border-t border-border pt-md">
                        <Typography.Text strong>
                            {microcopyString(microcopy.members.addHeading)}
                        </Typography.Text>
                        {addableOptions.length === 0 ? (
                            <Typography.Text
                                data-testid="members-no-addable"
                                type="secondary"
                            >
                                {microcopyString(
                                    microcopy.members.noAddableUsers
                                )}
                            </Typography.Text>
                        ) : (
                            <div className="flex flex-wrap items-center gap-xs">
                                <Select
                                    onValueChange={(value) =>
                                        setNewUserId(value)
                                    }
                                    value={newUserId}
                                >
                                    <SelectTrigger
                                        aria-label={microcopyString(
                                            microcopy.members.addUserPlaceholder
                                        )}
                                        className="min-w-[12rem] flex-[1_1_14rem]"
                                        data-testid="member-add-user"
                                    >
                                        <SelectValue
                                            placeholder={microcopyString(
                                                microcopy.members
                                                    .addUserPlaceholder
                                            )}
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {addableOptions.map((option) => (
                                            <SelectItem
                                                key={option.value}
                                                value={option.value}
                                            >
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <Select
                                    onValueChange={(value) =>
                                        setNewRole(value as ProjectRole)
                                    }
                                    value={newRole}
                                >
                                    <SelectTrigger
                                        aria-label={microcopyString(
                                            microcopy.members.addRolePlaceholder
                                        )}
                                        className="w-32"
                                        data-testid="member-add-role"
                                    >
                                        <SelectValue
                                            placeholder={microcopyString(
                                                microcopy.members
                                                    .addRolePlaceholder
                                            )}
                                        />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {roleOptions.map((option) => (
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
                                    data-testid="member-add-submit"
                                    disabled={!newUserId || isAdding}
                                    loading={isAdding}
                                    onClick={handleAdd}
                                    variant="primary"
                                >
                                    {isAdding
                                        ? microcopyString(
                                              microcopy.members.adding
                                          )
                                        : microcopyString(
                                              microcopy.members.addButton
                                          )}
                                </Button>
                            </div>
                        )}
                    </div>
                ) : null}
            </section>
        </TooltipProvider>
    );
};

export default ProjectMembersManager;
