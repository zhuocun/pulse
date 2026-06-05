import {
    fireEvent,
    render,
    screen,
    waitFor,
    within
} from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

import { microcopy } from "../../constants/microcopy";
import { DEFAULT_LOCALE } from "../../i18n/registry";
import { setActiveLocale } from "../../i18n/active";
import useAuth from "../../utils/hooks/useAuth";
import useComments from "../../utils/hooks/useComments";
import useProjectMembers from "../../utils/hooks/useProjectMembers";

import CommentsThread from ".";

expect.extend(toHaveNoViolations);

jest.mock("../../utils/hooks/useAuth");
jest.mock("../../utils/hooks/useComments");
jest.mock("../../utils/hooks/useProjectMembers");

const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseComments = useComments as jest.MockedFunction<
    typeof useComments
>;
const mockedUseProjectMembers = useProjectMembers as jest.MockedFunction<
    typeof useProjectMembers
>;

const installAntdBrowserMocks = () => {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
            addEventListener: jest.fn(),
            addListener: jest.fn(),
            dispatchEvent: jest.fn(),
            matches: false,
            media: query,
            onchange: null,
            removeEventListener: jest.fn(),
            removeListener: jest.fn()
        })
    });
};

const createComment = jest.fn();
const editComment = jest.fn();
const deleteComment = jest.fn();

const comment = (overrides: Partial<IComment> = {}): IComment => ({
    _id: "comment-1",
    taskId: "task-1",
    projectId: "project-1",
    authorId: "user-alice",
    body: "First comment",
    mentions: [],
    createdAt: "2026-06-01T10:00:00.000Z",
    ...overrides
});

const setComments = (
    overrides: Partial<ReturnType<typeof useComments>> = {}
) => {
    mockedUseComments.mockReturnValue({
        comments: [],
        isLoading: false,
        isError: false,
        createComment,
        isCreating: false,
        editComment,
        isEditing: false,
        deleteComment,
        isDeleting: false,
        ...overrides
    });
};

const setMembers = (members: IProjectMember[]) => {
    mockedUseProjectMembers.mockReturnValue({
        data: members
    } as unknown as ReturnType<typeof useProjectMembers>);
};

const setUser = (id: string | undefined) => {
    mockedUseAuth.mockReturnValue({
        user: id
            ? ({
                  _id: id,
                  username: id,
                  email: `${id}@example.com`,
                  likedProjects: []
              } as IUser)
            : undefined,
        isAuthenticated: Boolean(id),
        logout: jest.fn()
    });
};

const roster: IProjectMember[] = [
    { _id: "user-alice", username: "alice", email: "a@x.io", role: "owner" },
    { _id: "user-bob", username: "bob", email: "b@x.io", role: "editor" },
    { _id: "user-carol", username: "carol", email: "c@x.io", role: "viewer" }
];

const renderThread = (
    props: { taskId?: string; projectId?: string; disabled?: boolean } = {}
) =>
    render(<CommentsThread projectId="project-1" taskId="task-1" {...props} />);

describe("CommentsThread", () => {
    beforeAll(installAntdBrowserMocks);

    beforeEach(() => {
        jest.clearAllMocks();
        setComments();
        setMembers(roster);
        setUser("user-bob");
    });

    afterEach(() => {
        setActiveLocale(DEFAULT_LOCALE);
    });

    it("renders nothing when disabled (placeholder task)", () => {
        const { container } = renderThread({ disabled: true });
        expect(container).toBeEmptyDOMElement();
    });

    it("renders the empty state when there are no comments", () => {
        setComments({ comments: [] });
        renderThread();
        expect(screen.getByTestId("comments-empty")).toBeInTheDocument();
        expect(screen.getByText(microcopy.comments.empty)).toBeInTheDocument();
    });

    it("surfaces a load error banner when the query failed", () => {
        setComments({ isError: true, comments: undefined });
        renderThread();
        expect(screen.getByTestId("comments-load-error")).toBeInTheDocument();
        expect(
            screen.getByText(microcopy.comments.loadError)
        ).toBeInTheDocument();
    });

    it("renders a row per comment with resolved author names, body, and timestamp", () => {
        setComments({
            comments: [
                comment({ _id: "c1", authorId: "user-alice", body: "Hi all" }),
                comment({
                    _id: "c2",
                    authorId: "user-bob",
                    body: "Line one\nLine two"
                }),
                comment({
                    _id: "c3",
                    authorId: "user-ghost",
                    body: "Who am I"
                })
            ]
        });
        renderThread();

        const rows = screen.getAllByTestId("comment-row");
        expect(rows).toHaveLength(3);
        // Author resolved via the roster.
        expect(within(rows[0]).getByText("alice")).toBeInTheDocument();
        // Current user (bob) shows the "You" label.
        expect(
            within(rows[1]).getByText(microcopy.comments.you)
        ).toBeInTheDocument();
        // Unknown author falls back to the neutral label.
        expect(
            within(rows[2]).getByText(microcopy.comments.unknownAuthor)
        ).toBeInTheDocument();
        expect(within(rows[0]).getByText("Hi all")).toBeInTheDocument();
        // A parseable createdAt renders a <time> element.
        expect(rows[0].querySelector("time")).toHaveAttribute(
            "datetime",
            "2026-06-01T10:00:00.000Z"
        );
    });

    it("omits the timestamp when createdAt is missing", () => {
        setComments({
            comments: [comment({ _id: "c1", createdAt: undefined })]
        });
        renderThread();
        expect(
            screen.getByTestId("comment-row").querySelector("time")
        ).toBeNull();
    });

    it("shows edit + delete for the author and saves an inline edit", async () => {
        // bob is the current user and the author.
        setComments({
            comments: [
                comment({ _id: "c1", authorId: "user-bob", body: "Mine" })
            ]
        });
        createComment.mockResolvedValue("Comment created");
        editComment.mockResolvedValue("Comment updated");
        renderThread();

        fireEvent.click(screen.getByTestId("comment-edit"));
        const editInput = screen.getByTestId("comment-edit-input");
        fireEvent.change(editInput, { target: { value: "Edited body" } });
        fireEvent.click(screen.getByTestId("comment-edit-save"));

        await waitFor(() =>
            expect(editComment).toHaveBeenCalledWith({
                _id: "c1",
                body: "Edited body"
            })
        );
    });

    it("hides edit + delete for a non-author, non-owner viewer", () => {
        // carol (viewer) is the current user; the comment is bob's.
        setUser("user-carol");
        setComments({
            comments: [comment({ _id: "c1", authorId: "user-bob" })]
        });
        renderThread();

        expect(screen.queryByTestId("comment-edit")).not.toBeInTheDocument();
        expect(screen.queryByTestId("comment-delete")).not.toBeInTheDocument();
    });

    it("lets a project owner delete another member's comment but not edit it", async () => {
        // alice is an owner; the comment is bob's.
        setUser("user-alice");
        deleteComment.mockResolvedValue("Comment deleted");
        setComments({
            comments: [comment({ _id: "c1", authorId: "user-bob" })]
        });
        renderThread();

        // No edit affordance (owner is not the author)…
        expect(screen.queryByTestId("comment-edit")).not.toBeInTheDocument();
        // …but a delete affordance is shown.
        fireEvent.click(screen.getByTestId("comment-delete"));
        // Confirm the Popconfirm.
        fireEvent.click(
            await screen.findByRole("button", {
                name: microcopy.actions.delete
            })
        );
        await waitFor(() => expect(deleteComment).toHaveBeenCalledWith("c1"));
    });

    it("posts a comment with the body and clears the composer (no mentions)", async () => {
        createComment.mockResolvedValue("Comment created");
        renderThread();

        const input = screen.getByTestId("comment-composer-input");
        fireEvent.change(input, { target: { value: "Hello team" } });
        fireEvent.click(screen.getByTestId("comment-post"));

        await waitFor(() =>
            expect(createComment).toHaveBeenCalledWith({
                body: "Hello team",
                mentions: undefined
            })
        );
        await waitFor(() => expect(input).toHaveValue(""));
    });

    it("disables the post button while the body is empty", () => {
        renderThread();
        expect(screen.getByTestId("comment-post")).toBeDisabled();
        fireEvent.change(screen.getByTestId("comment-composer-input"), {
            target: { value: "   " }
        });
        // Whitespace-only stays disabled.
        expect(screen.getByTestId("comment-post")).toBeDisabled();
    });

    it("offers other members in the mention picker and posts the selected ids", async () => {
        createComment.mockResolvedValue("Comment created");
        renderThread();

        // Open the mention multi-select.
        const mentionSelect = screen.getByTestId("comment-mention-select");
        fireEvent.mouseDown(within(mentionSelect).getByRole("combobox"));

        // The current user (bob) is excluded; the other members appear.
        expect(await screen.findByText("alice")).toBeInTheDocument();
        expect(await screen.findByText("carol")).toBeInTheDocument();
        expect(screen.queryByText("bob")).not.toBeInTheDocument();

        fireEvent.click(screen.getByText("carol"));

        fireEvent.change(screen.getByTestId("comment-composer-input"), {
            target: { value: "ping" }
        });
        fireEvent.click(screen.getByTestId("comment-post"));

        await waitFor(() =>
            expect(createComment).toHaveBeenCalledWith({
                body: "ping",
                mentions: ["user-carol"]
            })
        );
    });

    it("shows a post-error banner when the create fails", async () => {
        createComment.mockRejectedValue(new Error("nope"));
        renderThread();

        fireEvent.change(screen.getByTestId("comment-composer-input"), {
            target: { value: "boom" }
        });
        fireEvent.click(screen.getByTestId("comment-post"));

        expect(
            await screen.findByTestId("comments-post-error")
        ).toBeInTheDocument();
    });

    it("renders localized copy after switching to zh-CN", () => {
        setActiveLocale("zh-CN");
        setComments({ comments: [] });
        renderThread();
        expect(screen.getByText(microcopy.comments.heading)).toHaveTextContent(
            "评论"
        );
        expect(screen.getByText(microcopy.comments.empty)).toBeInTheDocument();
    });

    it("has no axe violations with a populated thread", async () => {
        setComments({
            comments: [
                comment({ _id: "c1", authorId: "user-bob", body: "Mine" }),
                comment({ _id: "c2", authorId: "user-alice", body: "Theirs" })
            ]
        });
        const { container } = renderThread();
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});
