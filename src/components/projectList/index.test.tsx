import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import useAppMessage from "@/components/ui/toast";

import { store } from "../../store";
import { activityFeedActions } from "../../store/reducers/activityFeedSlice";
import useAuth from "../../utils/hooks/useAuth";
import useProjectModal from "../../utils/hooks/useProjectModal";
import useReactMutation from "../../utils/hooks/useReactMutation";

import ProjectList from ".";

jest.mock("../../utils/hooks/useAuth");
jest.mock("../../utils/hooks/useProjectModal");
jest.mock("../../utils/hooks/useReactMutation");
jest.mock("@/components/ui/toast");

/*
 * The grid's `ProjectCard` warms board queries on hover via
 * `usePrefetchProject` → `useQueryClient()`, so every render needs a
 * `QueryClientProvider`. One client per file is fine (no real fetches
 * fire in these tests); retries off so nothing dangles.
 */
const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
});

const mockedUseAuth = useAuth as jest.Mock;
const mockedUseProjectModal = useProjectModal as jest.Mock;
const mockedUseReactMutation = useReactMutation as jest.Mock;
const mockedUseAppMessage = useAppMessage as jest.Mock;

const messageApi = {
    destroy: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    loading: jest.fn(),
    success: jest.fn(),
    warning: jest.fn()
};

const member = (overrides: Partial<IMember> = {}): IMember => ({
    _id: "member-1",
    email: "alice@example.com",
    username: "Alice",
    ...overrides
});

const user = (overrides: Partial<IUser> = {}): IUser => ({
    ...member(),
    likedProjects: [],
    ...overrides
});

const project = (overrides: Partial<IProject> = {}): IProject => ({
    _id: "project-1",
    createdAt: "2026-04-25T00:00:00.000Z",
    managerId: "member-1",
    organization: "Product",
    projectName: "Roadmap",
    ...overrides
});

const members = [
    member(),
    member({
        _id: "member-2",
        email: "bob@example.com",
        username: "Bob"
    })
];

const likeProject = jest.fn();
const removeProject = jest.fn();
const startEditing = jest.fn();

const renderList = ({
    dataSource = [
        project(),
        project({
            _id: "project-2",
            createdAt: "",
            managerId: "missing-member",
            organization: "Design",
            projectName: "Design System"
        })
    ],
    currentUser = user(),
    loading = false
}: {
    dataSource?: IProject[];
    currentUser?: IUser;
    loading?: boolean;
} = {}) => {
    window.history.pushState({}, "Projects", "/projects");
    mockedUseAuth.mockReturnValue({
        logout: jest.fn(),
        isAuthenticated: true,
        user: currentUser
    });
    mockedUseProjectModal.mockReturnValue({
        openModal: jest.fn(),
        startEditing
    });
    mockedUseReactMutation.mockImplementation((endpoint: string) =>
        endpoint === "users/likes"
            ? { mutateAsync: likeProject }
            : { mutate: removeProject, mutateAsync: jest.fn() }
    );
    mockedUseAppMessage.mockReturnValue(messageApi);

    return render(
        <QueryClientProvider client={queryClient}>
            <Provider store={store}>
                <MemoryRouter initialEntries={["/projects"]}>
                    <Routes>
                        <Route
                            path="/projects"
                            element={
                                <ProjectList
                                    dataSource={dataSource}
                                    loading={loading}
                                    members={members}
                                />
                            }
                        />
                    </Routes>
                </MemoryRouter>
            </Provider>
        </QueryClientProvider>
    );
};

describe("ProjectList", () => {
    // Radix Select/DropdownMenu drive their menus with pointer-capture and
    // scroll APIs jsdom doesn't ship; polyfill them so the sort picker,
    // page-size picker, and per-card action menu can open.
    beforeAll(() => {
        Element.prototype.scrollIntoView = jest.fn();
        Element.prototype.hasPointerCapture = jest.fn(() => false);
        Element.prototype.releasePointerCapture = jest.fn();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        likeProject.mockResolvedValue({});
        // Clear the activity feed so the Phase 4.3 integration
        // assertion below reads a deterministic event list.
        act(() => {
            store.dispatch(activityFeedActions.clearActivityFeed());
        });
    });

    afterEach(() => {
        act(() => {
            store.dispatch(activityFeedActions.clearActivityFeed());
        });
    });

    it("renders project cards with manager, fallback, date, and project links", async () => {
        renderList();

        expect(screen.getByRole("link", { name: /Roadmap/i })).toHaveAttribute(
            "href",
            "/projects/project-1"
        );
        expect(screen.getByText("Product")).toBeInTheDocument();
        expect(screen.getByText("Alice")).toBeInTheDocument();
        expect(screen.getByText("Apr 25, 2026")).toBeInTheDocument();
        expect(screen.getByText("Design System")).toBeInTheDocument();
        expect(screen.getByText(/no manager/i)).toBeInTheDocument();
        expect(screen.getAllByText(/no date/i).length).toBeGreaterThan(0);
        // The pre-cookie design called ``refreshUser`` from this
        // component on mount to reconcile the cached user with the
        // stored bearer. Cookie auth makes that handshake the
        // responsibility of ``AuthProvider`` -- a single ``GET
        // /users`` probe at app boot -- so nothing on this surface
        // should re-fetch when the project list mounts.
    });

    it("shows the empty state when there are no projects", () => {
        renderList({
            dataSource: [],
            loading: false
        });

        expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /create project/i })
        ).toBeInTheDocument();
    });

    it("calls the like mutation and flips the visible heart while pending", async () => {
        likeProject.mockReturnValue(
            new Promise(() => {
                // Keep the mutation pending so the optimistic heart state remains visible.
            })
        );
        renderList({
            currentUser: user({ likedProjects: ["project-1"] })
        });

        const unlikeButton = screen.getByRole("button", {
            name: /unlike roadmap/i
        });
        expect(unlikeButton).toHaveAttribute("aria-pressed", "true");

        fireEvent.click(unlikeButton);

        expect(likeProject).toHaveBeenCalledWith({ projectId: "project-1" });
        await waitFor(() => {
            expect(
                screen.getByRole("button", { name: /like roadmap/i })
            ).toHaveAttribute("aria-pressed", "false");
        });
    });

    it("clears the optimistic liked project when the like mutation resolves", async () => {
        likeProject.mockResolvedValue({});
        renderList();
        const likeButton = screen.getByRole("button", {
            name: /like roadmap/i
        });

        fireEvent.click(likeButton);

        await waitFor(() => {
            expect(
                screen.getByRole("button", { name: /like roadmap/i })
            ).toHaveAttribute("aria-pressed", "false");
        });
    });

    it("sorts project cards by name from the sort selector", async () => {
        renderList({
            dataSource: [
                project({
                    _id: "project-z",
                    projectName: "Zulu",
                    // Disambiguate the createdAt timestamps so the
                    // default `createdAt-desc` sort has a deterministic
                    // ordering (newest first → Zulu).
                    createdAt: "2026-05-02T00:00:00.000Z"
                }),
                project({
                    _id: "project-a",
                    projectName: "Alpha",
                    createdAt: "2026-04-25T00:00:00.000Z"
                })
            ]
        });

        // Phase 4.2 — the default sort is now `createdAt-desc` (newest
        // first) to match the saved-default fallback. Zulu has the
        // later createdAt, so it appears first.
        expect(
            screen.getAllByRole("link").map((link) => link.textContent)
        ).toEqual(["Zulu", "Alpha"]);
    });

    const projectNamesInGridOrder = () =>
        screen.getAllByRole("link").map((link) => link.textContent);

    const selectSortOrder = async (label: RegExp) => {
        const menuUser = userEvent.setup();
        await menuUser.click(
            screen.getByRole("combobox", { name: /sort projects/i })
        );
        await menuUser.click(
            await screen.findByRole("option", { name: label })
        );
    };

    it("keeps stable order for empty createdAt when sorting newest", async () => {
        renderList({
            dataSource: [
                project({
                    _id: "project-empty-a",
                    createdAt: "",
                    projectName: "Empty Alpha"
                }),
                project({
                    _id: "project-empty-b",
                    createdAt: "",
                    projectName: "Empty Beta"
                }),
                project({
                    _id: "project-dated",
                    createdAt: "2026-06-01T00:00:00.000Z",
                    projectName: "Dated"
                })
            ]
        });

        await selectSortOrder(/newest first/i);

        expect(projectNamesInGridOrder()).toEqual([
            "Dated",
            "Empty Alpha",
            "Empty Beta"
        ]);
    });

    it("keeps stable order for empty createdAt when sorting oldest", async () => {
        renderList({
            dataSource: [
                project({
                    _id: "project-empty-a",
                    createdAt: "",
                    projectName: "Empty Alpha"
                }),
                project({
                    _id: "project-empty-b",
                    createdAt: "",
                    projectName: "Empty Beta"
                }),
                project({
                    _id: "project-dated",
                    createdAt: "2026-06-01T00:00:00.000Z",
                    projectName: "Dated"
                })
            ]
        });

        await selectSortOrder(/oldest first/i);

        expect(projectNamesInGridOrder()).toEqual([
            "Empty Alpha",
            "Empty Beta",
            "Dated"
        ]);
    });

    const openRowMenu = async () => {
        const menuUser = userEvent.setup();
        await menuUser.click(
            screen.getByRole("button", { name: /more actions for/i })
        );
        return menuUser;
    };

    it("opens the edit flow from row actions", async () => {
        renderList({ dataSource: [project()] });

        const menuUser = await openRowMenu();
        await menuUser.click(
            await screen.findByRole("menuitem", { name: /^edit$/i })
        );

        expect(startEditing).toHaveBeenCalledWith("project-1");
    });

    it("uses the project-list prefix key for delete invalidation", () => {
        renderList();

        expect(mockedUseReactMutation).toHaveBeenCalledWith(
            "projects",
            "DELETE",
            ["projects"],
            expect.any(Function),
            expect.any(Function)
        );
    });

    /*
     * Phase 4.3 — integration assertion. The project-delete flow
     * must surface a corresponding row in the activity feed (the
     * bell-icon source of truth). The test exercises the mocked
     * delete mutation's `onSuccess` callback to mirror what
     * `useReactMutation`'s real `mutate(...)` would do on a
     * 2xx response, then reads Redux directly so the assertion is
     * independent of any particular drawer-UI affordance.
     */
    const confirmDeleteFlow = async () => {
        const menuUser = await openRowMenu();
        await menuUser.click(
            await screen.findByRole("menuitem", { name: /^delete$/i })
        );
        await menuUser.click(
            await screen.findByRole("button", { name: /delete project/i })
        );
    };

    it("records an activity-feed event when a project is deleted (Phase 4.3 integration)", async () => {
        renderList({ dataSource: [project()] });

        await confirmDeleteFlow();

        // The real `useReactMutation` would fire `onSuccess` after
        // the server returns 2xx. Our test mocks the mutation, so
        // the callback never runs unless we trigger it directly —
        // walk the mock's last call to grab the options object the
        // component passed in and invoke `onSuccess` ourselves.
        expect(removeProject).toHaveBeenCalled();
        const lastCall = removeProject.mock.calls.at(-1);
        const options = lastCall?.[1] as { onSuccess?: () => void } | undefined;
        act(() => {
            options?.onSuccess?.();
        });

        const events = store.getState().activityFeed.events;
        expect(events).toHaveLength(1);
        expect(events[0].kind).toBe("project");
        expect(events[0].action).toBe("delete");
        expect(events[0].summary).toContain("Roadmap");
    });

    it("confirms project deletion before calling the delete mutation", async () => {
        renderList({ dataSource: [project()] });

        // Opening the row menu and choosing Delete surfaces the confirm
        // dialog; the mutation only fires once the dialog is confirmed.
        const menuUser = await openRowMenu();
        await menuUser.click(
            await screen.findByRole("menuitem", { name: /^delete$/i })
        );
        expect(
            screen.getByText("This action cannot be undone.")
        ).toBeInTheDocument();
        expect(screen.getByText("Delete this project?")).toBeInTheDocument();
        expect(removeProject).not.toHaveBeenCalled();

        await menuUser.click(
            screen.getByRole("button", { name: /delete project/i })
        );

        expect(removeProject).toHaveBeenCalledWith(
            { projectId: "project-1" },
            expect.objectContaining({
                onError: expect.any(Function),
                onSuccess: expect.any(Function)
            })
        );
        expect(mockedUseReactMutation).toHaveBeenCalledWith(
            "projects",
            "DELETE",
            ["projects"],
            expect.any(Function),
            expect.any(Function)
        );
    });

    it("clears the pending heart and toasts when the like mutation rejects", async () => {
        likeProject.mockRejectedValueOnce(new Error("offline"));
        renderList();

        const likeButton = screen.getByRole("button", {
            name: /like roadmap/i
        });

        fireEvent.click(likeButton);

        await waitFor(() => expect(messageApi.error).toHaveBeenCalledTimes(1));
        expect(messageApi.error.mock.calls[0][0]).toMatch(/like/i);
        await waitFor(() => {
            expect(
                screen.getByRole("button", { name: /like roadmap/i })
            ).toHaveAttribute("aria-pressed", "false");
        });
    });

    it("renders skeleton placeholder cards while loading", () => {
        renderList({
            dataSource: [],
            loading: true
        });

        // The skeleton dataset replaces the empty state when loading.
        expect(screen.queryByText(/no projects yet/i)).not.toBeInTheDocument();
        expect(
            screen.getAllByTestId("project-skeleton").length
        ).toBeGreaterThan(0);
    });

    /*
     * Pagination coverage (Phase 2.2 §1.2 item 6). The grid caps at 12
     * cards per page; the helper below mints a sortable, name-ordered
     * fixture so the assertions can reason about which slice is visible.
     */
    const manyProjects = (count: number): IProject[] =>
        Array.from({ length: count }, (_, idx) => {
            // Zero-pad so name-asc string ordering matches numeric order
            // (Project 02 < Project 10).
            const n = String(idx + 1).padStart(2, "0");
            return project({
                _id: `project-${n}`,
                projectName: `Project ${n}`,
                // Descending createdAt so the default `createdAt-desc`
                // sort keeps "Project 01" first.
                createdAt: `2026-04-${String(28 - idx).padStart(2, "0")}T00:00:00.000Z`
            });
        });

    const visibleProjectNames = () =>
        screen.getAllByRole("link").map((link) => link.textContent);

    it("does not render the pager when the list fits on one page", () => {
        renderList({ dataSource: manyProjects(12) });

        expect(
            screen.queryByRole("listitem", { name: /pagination/i })
        ).not.toBeInTheDocument();
        // AntD pagination exposes a navigation landmark; absent here.
        expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
        expect(visibleProjectNames()).toHaveLength(12);
    });

    it("caps the grid at the default page size and paginates the rest", () => {
        renderList({ dataSource: manyProjects(20) });

        // First page shows the first 12 (createdAt-desc => Project 01..12).
        const firstPage = visibleProjectNames();
        expect(firstPage).toHaveLength(12);
        expect(firstPage[0]).toBe("Project 01");
        expect(firstPage[11]).toBe("Project 12");
        expect(screen.queryByText("Project 13")).not.toBeInTheDocument();

        // Jump to page 2 — the remaining 8 cards render.
        fireEvent.click(screen.getByRole("button", { name: "2" }));

        const secondPage = visibleProjectNames();
        expect(secondPage).toHaveLength(8);
        expect(secondPage[0]).toBe("Project 13");
        expect(screen.queryByText("Project 01")).not.toBeInTheDocument();
    });

    it("resets to page 1 when the filtered result set changes", () => {
        const { rerender } = renderList({ dataSource: manyProjects(20) });

        fireEvent.click(screen.getByRole("button", { name: "2" }));
        expect(visibleProjectNames()[0]).toBe("Project 13");

        // Simulate a parent-driven filter change: a narrower dataSource.
        // The result-signature effect must yank the user back to page 1.
        rerender(
            <QueryClientProvider client={queryClient}>
                <Provider store={store}>
                    <MemoryRouter initialEntries={["/projects"]}>
                        <Routes>
                            <Route
                                path="/projects"
                                element={
                                    <ProjectList
                                        dataSource={manyProjects(20).slice(
                                            0,
                                            15
                                        )}
                                        loading={false}
                                        members={members}
                                    />
                                }
                            />
                        </Routes>
                    </MemoryRouter>
                </Provider>
            </QueryClientProvider>
        );

        const afterFilter = visibleProjectNames();
        expect(afterFilter[0]).toBe("Project 01");
        expect(afterFilter).toHaveLength(12);
    });

    it("never renders an out-of-range (empty) page after the set shrinks", () => {
        const { rerender } = renderList({ dataSource: manyProjects(20) });

        fireEvent.click(screen.getByRole("button", { name: "2" }));
        expect(visibleProjectNames()[0]).toBe("Project 13");

        // Shrink to 13 projects. A different ID set trips the
        // result-signature reset back to page 1 (so the user lands on a
        // populated page rather than a blank page-2 slice). The clamp
        // guard in render is what keeps the in-between render in range.
        rerender(
            <QueryClientProvider client={queryClient}>
                <Provider store={store}>
                    <MemoryRouter initialEntries={["/projects"]}>
                        <Routes>
                            <Route
                                path="/projects"
                                element={
                                    <ProjectList
                                        dataSource={manyProjects(13)}
                                        loading={false}
                                        members={members}
                                    />
                                }
                            />
                        </Routes>
                    </MemoryRouter>
                </Provider>
            </QueryClientProvider>
        );

        const afterShrink = visibleProjectNames();
        // Page 1 of the 13-item set: a full grid of 12, never empty.
        expect(afterShrink).toHaveLength(12);
        expect(afterShrink[0]).toBe("Project 01");
    });

    it("widens the page through the size changer", async () => {
        renderList({ dataSource: manyProjects(20) });

        expect(visibleProjectNames()).toHaveLength(12);

        // Open the page-size select and pick 24 / page so the whole set fits.
        const menuUser = userEvent.setup();
        await menuUser.click(
            screen.getByRole("combobox", { name: /project list pages/i })
        );
        await menuUser.click(await screen.findByRole("option", { name: "24" }));

        expect(visibleProjectNames()).toHaveLength(20);
    });
});
