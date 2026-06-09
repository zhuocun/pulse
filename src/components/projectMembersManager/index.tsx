import { DeleteOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import {
    Alert,
    Button,
    Popconfirm,
    Select,
    Skeleton,
    Tag,
    Tooltip,
    Typography
} from "antd";
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

const NameBlock = styled.div`
    display: flex;
    flex-direction: column;
    min-width: 0;
`;

const MemberName = styled(Typography.Text)`
    && {
        font-size: ${fontSize.base}px;
        font-weight: ${fontWeight.semibold};
    }
`;

const MemberEmail = styled(Typography.Text)`
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
    gap: ${space.xs}px;
    margin-inline-start: auto;
`;

const RoleSelect = styled(Select<ProjectRole>)`
    min-width: 8rem;

    @media (pointer: coarse) {
        .ant-select-selector {
            min-height: ${touchTargetCoarse}px;
        }
    }
`;

const RemoveButton = styled(Button)`
    @media (pointer: coarse) {
        min-height: ${touchTargetCoarse}px;
        min-width: ${touchTargetCoarse}px;
    }
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

const AddUserSelect = styled(Select<string>)`
    flex: 1 1 14rem;
    min-width: 12rem;

    @media (pointer: coarse) {
        .ant-select-selector {
            min-height: ${touchTargetCoarse}px;
        }
    }
`;

const AddRoleSelect = styled(Select<ProjectRole>)`
    min-width: 8rem;

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
        if (
            role === "owner" ||
            role === "editor" ||
            role === "viewer" ||
            role === "guest"
        ) {
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
            <Alert
                data-testid="members-load-error"
                message={microcopyString(microcopy.members.loadError)}
                showIcon
                type="error"
            />
        );
    }

    if (rosterLoading && members.length === 0) {
        return (
            <div data-testid="members-loading">
                <Skeleton active paragraph={{ rows: 3 }} />
            </div>
        );
    }

    return (
        <Wrapper>
            {!canManage ? (
                <Typography.Text
                    data-testid="members-read-only-hint"
                    type="secondary"
                    style={{ fontSize: fontSize.sm }}
                >
                    {microcopyString(microcopy.members.readOnlyHint)}
                </Typography.Text>
            ) : null}

            {members.length === 0 ? (
                <Typography.Text
                    data-testid="members-empty"
                    type="secondary"
                    style={{ fontSize: fontSize.sm }}
                >
                    {microcopyString(microcopy.members.empty)}
                </Typography.Text>
            ) : (
                <List
                    aria-label={microcopyString(
                        microcopy.members.listAriaLabel
                    )}
                >
                    {members.map((member) => {
                        const isManager = member._id === managerId;
                        const memberName =
                            member.username || member.email || member._id;
                        return (
                            <Row
                                key={member._id}
                                data-testid="member-row"
                                data-member-id={member._id}
                            >
                                <Identity>
                                    <UserAvatar
                                        id={member._id}
                                        name={memberName}
                                    />
                                    <NameBlock>
                                        <MemberName>{memberName}</MemberName>
                                        {member.email ? (
                                            <MemberEmail>
                                                {member.email}
                                            </MemberEmail>
                                        ) : null}
                                    </NameBlock>
                                </Identity>
                                <Controls>
                                    {isManager ? (
                                        <Tag
                                            color="gold"
                                            data-testid="member-manager-badge"
                                        >
                                            {microcopyString(
                                                microcopy.members.managerBadge
                                            )}
                                        </Tag>
                                    ) : null}
                                    {canManage && !isManager ? (
                                        <RoleSelect
                                            aria-label={microcopyString(
                                                microcopy.members
                                                    .changeRoleAriaLabel
                                            ).replace("{name}", memberName)}
                                            data-testid="member-role-select"
                                            onChange={(role) =>
                                                handleRoleChange(
                                                    member._id,
                                                    role
                                                )
                                            }
                                            options={roleOptions}
                                            value={
                                                ROLE_ORDER.includes(
                                                    member.role as ProjectRole
                                                )
                                                    ? (member.role as ProjectRole)
                                                    : undefined
                                            }
                                        />
                                    ) : (
                                        <Tag data-testid="member-role-tag">
                                            {roleLabel(member.role)}
                                        </Tag>
                                    )}
                                    {canManage ? (
                                        isManager ? (
                                            <Tooltip
                                                title={microcopyString(
                                                    microcopy.members
                                                        .managerImmutableHint
                                                )}
                                            >
                                                <RemoveButton
                                                    aria-label={microcopyString(
                                                        microcopy.members
                                                            .removeAriaLabel
                                                    ).replace(
                                                        "{name}",
                                                        memberName
                                                    )}
                                                    danger
                                                    data-testid="member-remove"
                                                    disabled
                                                    icon={
                                                        <DeleteOutlined
                                                            aria-hidden
                                                        />
                                                    }
                                                    size="small"
                                                    type="text"
                                                />
                                            </Tooltip>
                                        ) : (
                                            <Popconfirm
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
                                                ).replace("{name}", memberName)}
                                            >
                                                <RemoveButton
                                                    aria-label={microcopyString(
                                                        microcopy.members
                                                            .removeAriaLabel
                                                    ).replace(
                                                        "{name}",
                                                        memberName
                                                    )}
                                                    danger
                                                    data-testid="member-remove"
                                                    icon={
                                                        <DeleteOutlined
                                                            aria-hidden
                                                        />
                                                    }
                                                    size="small"
                                                    type="text"
                                                />
                                            </Popconfirm>
                                        )
                                    ) : null}
                                </Controls>
                            </Row>
                        );
                    })}
                </List>
            )}

            {canManage ? (
                <AddSection>
                    <AddHeading>
                        {microcopyString(microcopy.members.addHeading)}
                    </AddHeading>
                    {addableOptions.length === 0 ? (
                        <Typography.Text
                            data-testid="members-no-addable"
                            type="secondary"
                            style={{ fontSize: fontSize.sm }}
                        >
                            {microcopyString(microcopy.members.noAddableUsers)}
                        </Typography.Text>
                    ) : (
                        <AddRow>
                            <AddUserSelect
                                aria-label={microcopyString(
                                    microcopy.members.addUserPlaceholder
                                )}
                                data-testid="member-add-user"
                                onChange={(value) => setNewUserId(value)}
                                optionFilterProp="label"
                                options={addableOptions}
                                placeholder={microcopyString(
                                    microcopy.members.addUserPlaceholder
                                )}
                                showSearch
                                value={newUserId}
                            />
                            <AddRoleSelect
                                aria-label={microcopyString(
                                    microcopy.members.addRolePlaceholder
                                )}
                                data-testid="member-add-role"
                                onChange={(value) => setNewRole(value)}
                                options={roleOptions}
                                placeholder={microcopyString(
                                    microcopy.members.addRolePlaceholder
                                )}
                                value={newRole}
                            />
                            <AddButton
                                data-testid="member-add-submit"
                                disabled={!newUserId || isAdding}
                                loading={isAdding}
                                onClick={handleAdd}
                                type="primary"
                            >
                                {isAdding
                                    ? microcopyString(microcopy.members.adding)
                                    : microcopyString(
                                          microcopy.members.addButton
                                      )}
                            </AddButton>
                        </AddRow>
                    )}
                </AddSection>
            ) : null}
        </Wrapper>
    );
};

export default ProjectMembersManager;
