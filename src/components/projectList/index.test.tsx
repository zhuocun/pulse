import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { message, Modal } from "antd";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { store } from "../../store";
import useAuth from "../../utils/hooks/useAuth";
import useProjectModal from "../../utils/hooks/useProjectModal";
import useReactMutation from "../../utils/hooks/useReactMutation";

import ProjectList from ".";

jest.mock("../../utils/hooks/useAuth");
jest.mock("../../utils/hooks/useProjectModal");
jest.mock("../../utils/hooks/useReactMutation");

type DropdownMenuItem = {
    key?: string | number;
    label?: ReactNode;
    onClick?: () => void;
};

type DropdownMockProps = {
    children: ReactNode;
    menu?: {
        items?: DropdownMenuItem[];
    };
};

jest.mock("antd", () => {
    const actual = jest.requireActual("antd");
    const React = jest.requireActual("react");

    return {
        ...actual,
        Dropdown: ({ children, menu }: DropdownMockProps) =>
            React.createElement(
                "div",
                null,
                children,
                React.createElement(
                    "div",
                    { "data-testid": "dropdown-menu" },
                    menu?.items?.map((item) =>
                        React.createElement(
                            "button",
                            {
                                key: item.key,
                                onClick: item.onClick,
                                type: "button"
                            },
                            item.label
                        )
                    )
                )
            )
    };
});

const mockedUseAuth = useAuth as jest.Mock;
const mockedUseProjectModal = useProjectModal as jest.Mock;
const mockedUseReactMutation = useReactMutation as jest.Mock;

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
            : { mutate: removeProject }
    );

    return render(
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
    );
};

describe("ProjectList", () => {
    beforeAll(() => {
        installAntdBrowserMocks();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        likeProject.mockResolvedValue({});
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
                project({ _id: "project-z", projectName: "Zulu" }),
                project({ _id: "project-a", projectName: "Alpha" })
            ]
        });

        // Default sort is "Name (A → Z)" — Alpha comes first.
        expect(
            screen.getAllByRole("link").map((link) => link.textContent)
        ).toEqual(["Alpha", "Zulu"]);
    });

    const projectNamesInGridOrder = () =>
        screen.getAllByRole("link").map((link) => link.textContent);

    const selectSortOrder = async (label: RegExp) => {
        fireEvent.mouseDown(
            screen.getByRole("combobox", { name: /sort projects/i })
        );
        fireEvent.click(await screen.findByText(label));
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

    it("opens the edit flow from row actions", () => {
        renderList({ dataSource: [project()] });

        fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));

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

    it("confirms project deletion before calling the delete mutation", () => {
        const confirmSpy = jest
            .spyOn(Modal, "confirm")
            .mockImplementation((config) => {
                config.onOk?.();
                return {
                    destroy: jest.fn(),
                    update: jest.fn()
                } as ReturnType<typeof Modal.confirm>;
            });
        renderList({ dataSource: [project()] });

        fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

        expect(confirmSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                content: "This action cannot be undone.",
                title: "Delete this project?"
            })
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

        confirmSpy.mockRestore();
    });

    it("clears the pending heart and toasts when the like mutation rejects", async () => {
        likeProject.mockRejectedValueOnce(new Error("offline"));
        const errorSpy = jest
            .spyOn(message, "error")
            .mockImplementation(() => "" as never);
        renderList();

        const likeButton = screen.getByRole("button", {
            name: /like roadmap/i
        });

        fireEvent.click(likeButton);

        await waitFor(() => expect(errorSpy).toHaveBeenCalledTimes(1));
        expect(errorSpy.mock.calls[0][0]).toMatch(/like/i);
        await waitFor(() => {
            expect(
                screen.getByRole("button", { name: /like roadmap/i })
            ).toHaveAttribute("aria-pressed", "false");
        });

        errorSpy.mockRestore();
    });

    it("renders skeleton placeholder cards while loading", () => {
        const { container } = renderList({
            dataSource: [],
            loading: true
        });

        // The skeleton dataset replaces the empty state when loading.
        expect(screen.queryByText(/no projects yet/i)).not.toBeInTheDocument();
        expect(
            container.querySelectorAll(".ant-skeleton").length
        ).toBeGreaterThan(0);
    });
});
