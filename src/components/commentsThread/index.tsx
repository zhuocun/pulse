import { AlertCircle, ChevronDown, Pencil, Trash2 } from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";

import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Typography } from "@/components/ui/typography";

import { microcopy, microcopyString } from "../../constants/microcopy";
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

const ICON_BUTTON_CLASS = "coarse:min-w-[44px]";

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

interface ErrorBannerProps {
    testId: string;
    message: string;
}

const ErrorBanner: React.FC<ErrorBannerProps> = ({ testId, message }) => (
    <Alert data-testid={testId} variant="destructive">
        <AlertCircle aria-hidden />
        <AlertTitle>{message}</AlertTitle>
    </Alert>
);

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

    const toggleMention = useCallback((memberId: string, checked: boolean) => {
        setMentions((current) =>
            checked
                ? current.includes(memberId)
                    ? current
                    : [...current, memberId]
                : current.filter((id) => id !== memberId)
        );
    }, []);

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
    const mentionCount = mentions.length;

    return (
        <section className="mt-lg flex flex-col gap-md border-t border-border pt-md">
            <Typography.Text strong>
                {microcopyString(microcopy.comments.heading)}
            </Typography.Text>

            {isError ? (
                <ErrorBanner
                    message={microcopyString(microcopy.comments.loadError)}
                    testId="comments-load-error"
                />
            ) : null}

            {!isError && list.length === 0 ? (
                <Typography.Text data-testid="comments-empty" type="secondary">
                    {microcopyString(microcopy.comments.empty)}
                </Typography.Text>
            ) : null}

            {list.length > 0 ? (
                <ul
                    aria-label={microcopyString(
                        microcopy.comments.listAriaLabel
                    )}
                    className="m-0 flex list-none flex-col gap-sm p-0"
                >
                    {list.map((comment) => {
                        const isAuthor = comment.authorId === currentUserId;
                        const timestamp = formatTimestamp(comment.createdAt);
                        const editing = editingId === comment._id;
                        return (
                            <li
                                className="m-0 flex flex-col gap-xxs p-0"
                                data-comment-id={comment._id}
                                data-testid="comment-row"
                                key={comment._id}
                            >
                                <div className="flex flex-wrap items-baseline gap-xs">
                                    <Typography.Text strong>
                                        {resolveAuthorName(comment.authorId)}
                                    </Typography.Text>
                                    {timestamp ? (
                                        <time
                                            className="text-xs text-muted-foreground"
                                            dateTime={comment.createdAt}
                                        >
                                            {timestamp}
                                        </time>
                                    ) : null}
                                    {!editing && (isAuthor || isOwner) ? (
                                        <div className="ms-auto flex gap-xxs">
                                            {isAuthor ? (
                                                <Button
                                                    aria-label={microcopyString(
                                                        microcopy.comments
                                                            .editAriaLabel
                                                    )}
                                                    className={
                                                        ICON_BUTTON_CLASS
                                                    }
                                                    data-testid="comment-edit"
                                                    onClick={() =>
                                                        handleStartEdit(comment)
                                                    }
                                                    size="sm"
                                                    variant="ghost"
                                                >
                                                    <Pencil aria-hidden />
                                                </Button>
                                            ) : null}
                                            <ConfirmPopover
                                                cancelText={
                                                    microcopy.actions.cancel
                                                }
                                                okText={
                                                    microcopy.actions.delete
                                                }
                                                onConfirm={() =>
                                                    handleDelete(comment._id)
                                                }
                                                title={microcopyString(
                                                    microcopy.comments
                                                        .deleteConfirmTitle
                                                )}
                                                trigger={
                                                    <Button
                                                        aria-label={microcopyString(
                                                            microcopy.comments
                                                                .deleteAriaLabel
                                                        )}
                                                        className={
                                                            ICON_BUTTON_CLASS
                                                        }
                                                        data-testid="comment-delete"
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
                                </div>
                                {editing ? (
                                    <div className="flex flex-col gap-xs">
                                        <Textarea
                                            aria-label={microcopyString(
                                                microcopy.comments.editAriaLabel
                                            )}
                                            autoComplete="off"
                                            className="min-h-[3rem]"
                                            data-testid="comment-edit-input"
                                            enterKeyHint="enter"
                                            inputMode="text"
                                            onChange={(event) =>
                                                setEditBody(event.target.value)
                                            }
                                            rows={2}
                                            value={editBody}
                                        />
                                        <div className="flex gap-xs">
                                            <Button
                                                data-testid="comment-edit-save"
                                                disabled={
                                                    editBody.trim().length === 0
                                                }
                                                loading={isEditing}
                                                onClick={() =>
                                                    handleSaveEdit(comment._id)
                                                }
                                                size="sm"
                                                variant="primary"
                                            >
                                                {microcopy.actions.save}
                                            </Button>
                                            <Button
                                                data-testid="comment-edit-cancel"
                                                onClick={handleCancelEdit}
                                                size="sm"
                                                variant="default"
                                            >
                                                {microcopy.actions.cancel}
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="whitespace-pre-wrap break-words text-sm text-foreground">
                                        {comment.body}
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            ) : null}

            {postError ? (
                <ErrorBanner
                    message={microcopyString(microcopy.comments.postError)}
                    testId="comments-post-error"
                />
            ) : null}
            {editError ? (
                <ErrorBanner
                    message={microcopyString(microcopy.comments.editError)}
                    testId="comments-edit-error"
                />
            ) : null}
            {deleteError ? (
                <ErrorBanner
                    message={microcopyString(microcopy.comments.deleteError)}
                    testId="comments-delete-error"
                />
            ) : null}

            <div className="flex flex-col gap-xs">
                <Textarea
                    aria-label={microcopyString(microcopy.comments.placeholder)}
                    autoComplete="off"
                    className="min-h-[3rem]"
                    data-testid="comment-composer-input"
                    enterKeyHint="enter"
                    inputMode="text"
                    onChange={(event) => setBody(event.target.value)}
                    placeholder={microcopyString(
                        microcopy.comments.placeholder
                    )}
                    rows={2}
                    value={body}
                />
                <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                        <Button
                            aria-label={microcopyString(
                                microcopy.comments.mentionLabel
                            )}
                            className="justify-between"
                            data-testid="comment-mention-select"
                            variant="outline"
                        >
                            {mentionCount > 0
                                ? mentions
                                      .map((id) => nameById.get(id) ?? id)
                                      .join(", ")
                                : microcopyString(
                                      microcopy.comments.mentionPlaceholder
                                  )}
                            <ChevronDown aria-hidden />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="start"
                        className="min-w-[12rem]"
                    >
                        {mentionOptions.map((option) => (
                            <DropdownMenuCheckboxItem
                                checked={mentions.includes(option.value)}
                                key={option.value}
                                onCheckedChange={(checked) =>
                                    toggleMention(option.value, checked)
                                }
                                onSelect={(event) => event.preventDefault()}
                            >
                                {option.label}
                            </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
                <div className="flex items-center justify-end gap-xs">
                    <Button
                        data-testid="comment-post"
                        disabled={!canPost}
                        loading={isCreating}
                        onClick={handlePost}
                        variant="primary"
                    >
                        {isCreating
                            ? microcopyString(microcopy.comments.posting)
                            : microcopyString(microcopy.comments.post)}
                    </Button>
                </div>
            </div>
        </section>
    );
};

export default CommentsThread;
