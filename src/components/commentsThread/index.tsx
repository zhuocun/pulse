import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Alert, Button, Input, Popconfirm, Select, Typography } from "antd";
import React, { useCallback, useMemo, useState } from "react";

import { microcopy, microcopyString } from "../../constants/microcopy";
import {
    fontSize,
    fontWeight,
    space,
    touchTargetCoarse
} from "../../theme/tokens";
import useAuth from "../../utils/hooks/useAuth";
import useComments from "../../utils/hooks/useComments";
import useProjectMembers from "../../utils/hooks/useProjectMembers";

/**
 * Task comments + @mentions thread (M4 — backend Collaboration feature).
 *
 * Mounts inside the task modal for a real (persisted) task. Lists the
 * task's comments oldest-first, resolves author + mention ids to
 * usernames via the project roster, and offers a composer with a
 * member-mention multi-select. Posting a comment with ≥1 mention
 * produces a server-side `mention` notification for each valid mentioned
 * member — this surface is the producer the notification bell consumes.
 *
 * RBAC mirrors the server gates: any project member can list + create;
 * only the author can edit; the author OR a project owner (manager-rank)
 * can delete. The component only shows the controls a user is allowed to
 * use; the server enforces the same rules regardless.
 *
 * Bodies render as plain text with preserved line breaks
 * (`white-space: pre-wrap`) — never `dangerouslySetInnerHTML`.
 */

const Wrapper = styled.section`
    border-top: 1px solid
        var(--ant-color-border-secondary, rgba(15, 23, 42, 0.08));
    display: flex;
    flex-direction: column;
    gap: ${space.md}px;
    margin-block-start: ${space.lg}px;
    padding-block-start: ${space.md}px;
`;

const Heading = styled(Typography.Text)`
    && {
        font-size: ${fontSize.sm}px;
        font-weight: ${fontWeight.semibold};
    }
`;

const List = styled.ul`
    display: flex;
    flex-direction: column;
    gap: ${space.sm}px;
    list-style: none;
    margin: 0;
    padding: 0;
`;

const Row = styled.li`
    display: flex;
    flex-direction: column;
    gap: ${space.xxs}px;
    margin: 0;
    padding: 0;
`;

const RowHeader = styled.div`
    align-items: baseline;
    display: flex;
    flex-wrap: wrap;
    gap: ${space.xs}px;
`;

const AuthorName = styled(Typography.Text)`
    && {
        font-size: ${fontSize.sm}px;
        font-weight: ${fontWeight.semibold};
    }
`;

const TimeStamp = styled.time`
    color: var(--ant-color-text-tertiary, rgba(15, 23, 42, 0.45));
    font-size: ${fontSize.xs}px;
`;

const Body = styled.div`
    font-size: ${fontSize.base}px;
    white-space: pre-wrap;
    word-break: break-word;
`;

const RowActions = styled.div`
    display: flex;
    gap: ${space.xxs}px;
    margin-inline-start: auto;
`;

const ActionButton = styled(Button)`
    @media (pointer: coarse) {
        min-height: ${touchTargetCoarse}px;
        min-width: ${touchTargetCoarse}px;
    }
`;

const Composer = styled.div`
    display: flex;
    flex-direction: column;
    gap: ${space.xs}px;
`;

const ComposerActions = styled.div`
    align-items: center;
    display: flex;
    gap: ${space.xs}px;
    justify-content: flex-end;
`;

const EditActions = styled.div`
    display: flex;
    gap: ${space.xs}px;
`;

const PostButton = styled(Button)`
    @media (pointer: coarse) {
        min-height: ${touchTargetCoarse}px;
    }
`;

const MentionSelect = styled(Select)`
    @media (pointer: coarse) {
        .ant-select-selector {
            min-height: ${touchTargetCoarse}px;
        }
    }
`;

/**
 * Format a server `createdAt` ISO string to a localized absolute
 * timestamp. Returns `null` when the field is absent (an optimistic row
 * or a write-endpoint string ack carries none) or unparseable, so the
 * row omits the `<time>` element rather than render "Invalid Date".
 */
const formatTimestamp = (createdAt: string | undefined): string | null => {
    if (!createdAt) return null;
    const ms = Date.parse(createdAt);
    if (Number.isNaN(ms)) return null;
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
    }).format(ms);
};

interface CommentsThreadProps {
    taskId: string;
    projectId: string;
    /** Placeholder / not-yet-persisted task — render nothing. */
    disabled?: boolean;
}

const CommentsThread: React.FC<CommentsThreadProps> = ({
    taskId,
    projectId,
    disabled = false
}) => {
    const { user } = useAuth();
    const currentUserId = user?._id;
    const { data: membersData } = useProjectMembers(projectId);
    const {
        comments,
        isError,
        createComment,
        isCreating,
        editComment,
        isEditing,
        deleteComment
    } = useComments(taskId);

    const [body, setBody] = useState("");
    const [mentions, setMentions] = useState<string[]>([]);
    const [postError, setPostError] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editBody, setEditBody] = useState("");
    const [editError, setEditError] = useState(false);
    const [deleteError, setDeleteError] = useState(false);

    // Guard against a non-array payload sharing the query cache (errored /
    // stubbed body) so the `.find` / `.map` below never throw — mirrors the
    // `Array.isArray` normalization in `useLabels` / `useComments`.
    const members = useMemo(
        () => (Array.isArray(membersData) ? membersData : []),
        [membersData]
    );

    const nameById = useMemo(() => {
        const map = new Map<string, string>();
        for (const member of members) {
            map.set(member._id, member.username);
        }
        return map;
    }, [members]);

    // A mention of yourself is a no-op (the backend skips the author), so
    // the picker only offers the other project members.
    const mentionOptions = useMemo(
        () =>
            members
                .filter((member) => member._id !== currentUserId)
                .map((member) => ({
                    label: member.username,
                    value: member._id
                })),
        [members, currentUserId]
    );

    // Owner-rank members are the project managers who may delete any
    // comment (the backend authorizes author OR owner).
    const isOwner = useMemo(
        () =>
            members.some(
                (member) =>
                    member._id === currentUserId && member.role === "owner"
            ),
        [members, currentUserId]
    );

    const resolveAuthorName = useCallback(
        (authorId: string): string => {
            if (currentUserId && authorId === currentUserId) {
                return microcopyString(microcopy.comments.you);
            }
            return (
                nameById.get(authorId) ??
                microcopyString(microcopy.comments.unknownAuthor)
            );
        },
        [currentUserId, nameById]
    );

    const trimmedBody = body.trim();
    const canPost = trimmedBody.length > 0 && !isCreating;

    const handlePost = useCallback(async () => {
        if (!canPost) return;
        setPostError(false);
        try {
            await createComment({
                body: trimmedBody,
                mentions: mentions.length > 0 ? mentions : undefined
            });
            setBody("");
            setMentions([]);
        } catch {
            setPostError(true);
        }
    }, [canPost, createComment, mentions, trimmedBody]);

    const handleStartEdit = useCallback((comment: IComment) => {
        setEditError(false);
        setEditingId(comment._id);
        setEditBody(comment.body);
    }, []);

    const handleCancelEdit = useCallback(() => {
        setEditingId(null);
        setEditBody("");
    }, []);

    const handleSaveEdit = useCallback(
        async (commentId: string) => {
            const next = editBody.trim();
            if (next.length === 0) return;
            setEditError(false);
            try {
                await editComment({ _id: commentId, body: next });
                setEditingId(null);
                setEditBody("");
            } catch {
                setEditError(true);
            }
        },
        [editBody, editComment]
    );

    const handleDelete = useCallback(
        async (commentId: string) => {
            setDeleteError(false);
            try {
                await deleteComment(commentId);
            } catch {
                setDeleteError(true);
            }
        },
        [deleteComment]
    );

    if (disabled) return null;

    const list = comments ?? [];

    return (
        <Wrapper>
            <Heading>{microcopyString(microcopy.comments.heading)}</Heading>

            {isError ? (
                <Alert
                    data-testid="comments-load-error"
                    message={microcopyString(microcopy.comments.loadError)}
                    showIcon
                    type="error"
                />
            ) : null}

            {!isError && list.length === 0 ? (
                <Typography.Text
                    data-testid="comments-empty"
                    type="secondary"
                    style={{ fontSize: fontSize.sm }}
                >
                    {microcopyString(microcopy.comments.empty)}
                </Typography.Text>
            ) : null}

            {list.length > 0 ? (
                <List
                    aria-label={microcopyString(
                        microcopy.comments.listAriaLabel
                    )}
                >
                    {list.map((comment) => {
                        const isAuthor = comment.authorId === currentUserId;
                        const timestamp = formatTimestamp(comment.createdAt);
                        const editing = editingId === comment._id;
                        return (
                            <Row
                                key={comment._id}
                                data-testid="comment-row"
                                data-comment-id={comment._id}
                            >
                                <RowHeader>
                                    <AuthorName>
                                        {resolveAuthorName(comment.authorId)}
                                    </AuthorName>
                                    {timestamp ? (
                                        <TimeStamp dateTime={comment.createdAt}>
                                            {timestamp}
                                        </TimeStamp>
                                    ) : null}
                                    {!editing && (isAuthor || isOwner) ? (
                                        <RowActions>
                                            {isAuthor ? (
                                                <ActionButton
                                                    aria-label={microcopyString(
                                                        microcopy.comments
                                                            .editAriaLabel
                                                    )}
                                                    data-testid="comment-edit"
                                                    icon={
                                                        <EditOutlined
                                                            aria-hidden
                                                        />
                                                    }
                                                    onClick={() =>
                                                        handleStartEdit(comment)
                                                    }
                                                    size="small"
                                                    type="text"
                                                />
                                            ) : null}
                                            {isAuthor || isOwner ? (
                                                <Popconfirm
                                                    cancelText={
                                                        microcopy.actions.cancel
                                                    }
                                                    okText={
                                                        microcopy.actions.delete
                                                    }
                                                    onConfirm={() =>
                                                        handleDelete(
                                                            comment._id
                                                        )
                                                    }
                                                    title={microcopyString(
                                                        microcopy.comments
                                                            .deleteConfirmTitle
                                                    )}
                                                >
                                                    <ActionButton
                                                        aria-label={microcopyString(
                                                            microcopy.comments
                                                                .deleteAriaLabel
                                                        )}
                                                        danger
                                                        data-testid="comment-delete"
                                                        icon={
                                                            <DeleteOutlined
                                                                aria-hidden
                                                            />
                                                        }
                                                        size="small"
                                                        type="text"
                                                    />
                                                </Popconfirm>
                                            ) : null}
                                        </RowActions>
                                    ) : null}
                                </RowHeader>
                                {editing ? (
                                    <Composer>
                                        <Input.TextArea
                                            aria-label={microcopyString(
                                                microcopy.comments.editAriaLabel
                                            )}
                                            autoSize={{
                                                minRows: 2,
                                                maxRows: 6
                                            }}
                                            data-testid="comment-edit-input"
                                            onChange={(event) =>
                                                setEditBody(event.target.value)
                                            }
                                            value={editBody}
                                        />
                                        <EditActions>
                                            <ActionButton
                                                data-testid="comment-edit-save"
                                                disabled={
                                                    editBody.trim().length === 0
                                                }
                                                loading={isEditing}
                                                onClick={() =>
                                                    handleSaveEdit(comment._id)
                                                }
                                                size="small"
                                                type="primary"
                                            >
                                                {microcopy.actions.save}
                                            </ActionButton>
                                            <ActionButton
                                                data-testid="comment-edit-cancel"
                                                onClick={handleCancelEdit}
                                                size="small"
                                            >
                                                {microcopy.actions.cancel}
                                            </ActionButton>
                                        </EditActions>
                                    </Composer>
                                ) : (
                                    <Body>{comment.body}</Body>
                                )}
                            </Row>
                        );
                    })}
                </List>
            ) : null}

            {postError ? (
                <Alert
                    data-testid="comments-post-error"
                    message={microcopyString(microcopy.comments.postError)}
                    showIcon
                    type="error"
                />
            ) : null}
            {editError ? (
                <Alert
                    data-testid="comments-edit-error"
                    message={microcopyString(microcopy.comments.editError)}
                    showIcon
                    type="error"
                />
            ) : null}
            {deleteError ? (
                <Alert
                    data-testid="comments-delete-error"
                    message={microcopyString(microcopy.comments.deleteError)}
                    showIcon
                    type="error"
                />
            ) : null}

            <Composer>
                <Input.TextArea
                    aria-label={microcopyString(microcopy.comments.placeholder)}
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    data-testid="comment-composer-input"
                    onChange={(event) => setBody(event.target.value)}
                    placeholder={microcopyString(
                        microcopy.comments.placeholder
                    )}
                    value={body}
                />
                <MentionSelect
                    aria-label={microcopyString(
                        microcopy.comments.mentionLabel
                    )}
                    data-testid="comment-mention-select"
                    mode="multiple"
                    onChange={(value) => setMentions(value as string[])}
                    options={mentionOptions}
                    placeholder={microcopyString(
                        microcopy.comments.mentionPlaceholder
                    )}
                    value={mentions}
                />
                <ComposerActions>
                    <PostButton
                        data-testid="comment-post"
                        disabled={!canPost}
                        loading={isCreating}
                        onClick={handlePost}
                        type="primary"
                    >
                        {isCreating
                            ? microcopyString(microcopy.comments.posting)
                            : microcopyString(microcopy.comments.post)}
                    </PostButton>
                </ComposerActions>
            </Composer>
        </Wrapper>
    );
};

export default CommentsThread;
