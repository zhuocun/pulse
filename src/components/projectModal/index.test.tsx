import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { DEFAULT_LOCALE, setActiveLocale } from "../../i18n";
import zhCN from "../../i18n/locales/zh-CN";
import { store } from "../../store";
import { projectActions } from "../../store/reducers/projectModalSlice";

import ProjectModal from ".";

const member = (overrides: Partial<IMember> = {}): IMember => ({
    _id: "member-1",
    email: "alice@example.com",
    username: "Alice",
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

const response = (body: unknown, ok = true) =>
    ({
        json: jest.fn().mockResolvedValue(body),
        ok,
        status: ok ? 200 : 400
    }) as unknown as Response;

const silenceExpectedConsoleErrors = (expectedMessages: string[][]) => {
    return jest
        .spyOn(console, "error")
        .mockImplementation((...args: Parameters<typeof console.error>) => {
            const message = args.map(String).join(" ");

            if (
                expectedMessages.some((fragments) =>
                    fragments.every((fragment) => message.includes(fragment))
                )
            ) {
                return;
            }

            throw new Error(`Unexpected console.error: ${message}`);
        });
};

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

    class ResizeObserverMock {
        observe = jest.fn();

        unobserve = jest.fn();

        disconnect = jest.fn();
    }

    Object.defineProperty(window, "ResizeObserver", {
        writable: true,
        value: ResizeObserverMock
    });
};

const LocationProbe = () => {
    const location = useLocation();

    return <div data-testid="location">{location.search}</div>;
};

const renderProjectModal = (
    initialAction?: { type: "open" } | { type: "edit"; id: string }
) => {
    if (initialAction?.type === "open") {
        store.dispatch(projectActions.openModal());
    } else if (initialAction?.type === "edit") {
        store.dispatch(projectActions.startEditing(initialAction.id));
    }
    const queryClient = new QueryClient({
        defaultOptions: {
            mutations: { retry: false },
            queries: { retry: false }
        }
    });

    return render(
        <Provider store={store}>
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/projects"]}>
                    <Routes>
                        <Route
                            path="/projects"
                            element={
                                <>
                                    <ProjectModal />
                                    <LocationProbe />
                                </>
                            }
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        </Provider>
    );
};

describe("ProjectModal", () => {
    const fetchMock = jest.spyOn(global, "fetch");
    let consoleErrorSpy: jest.SpyInstance;

    beforeAll(() => {
        installAntdBrowserMocks();
        consoleErrorSpy = silenceExpectedConsoleErrors([
            ["An update to", "null", "not wrapped in act"],
            ["An update to", "Field", "not wrapped in act"]
        ]);
    });

    beforeEach(() => {
        store.dispatch(projectActions.closeModal());
        fetchMock.mockReset();
        fetchMock.mockImplementation((input, init) => {
            const url = String(input);
            const method = init?.method?.toUpperCase() ?? "GET";

            if (url.includes("users/members")) {
                return Promise.resolve(response(members));
            }
            if (url.includes("projects?projectId=project-1")) {
                return Promise.resolve(response(project()));
            }
            if (url.includes("projects") && method === "POST") {
                return Promise.resolve(
                    response({
                        _id: "project-2",
                        ...(JSON.parse(init?.body as string) as object)
                    })
                );
            }
            if (url.includes("projects") && method === "PUT") {
                return Promise.resolve(
                    response(JSON.parse(init?.body as string))
                );
            }

            return Promise.resolve(response({}));
        });
    });

    afterAll(() => {
        consoleErrorSpy.mockRestore();
        fetchMock.mockRestore();
    });

    afterEach(() => {
        setActiveLocale(DEFAULT_LOCALE);
    });

    it("opens with the Create title and an empty form even when the project list cache is populated", async () => {
        // Regression: ``useProjectModal`` reads ``["projects", { projectId }]``
        // through ``useReactQuery`` which strips ``projectId: undefined`` via
        // ``filterRequest`` — that collapses the key to ``["projects", {}]``
        // and collides with the list page's project-array cache. Without
        // gating ``data`` on ``editingProjectId``, the modal reads the list,
        // ``Boolean(editingProject)`` flips true, and the Create CTA opens a
        // dialog titled "Edit project". Pre-seed the cache here to pin the
        // gate.
        const queryClient = new QueryClient({
            defaultOptions: {
                mutations: { retry: false },
                queries: { retry: false }
            }
        });
        queryClient.setQueryData(["projects", {}], [project()]);
        store.dispatch(projectActions.openModal());

        render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter initialEntries={["/projects"]}>
                        <Routes>
                            <Route
                                path="/projects"
                                element={
                                    <>
                                        <ProjectModal />
                                        <LocationProbe />
                                    </>
                                }
                            />
                        </Routes>
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );

        expect(
            await screen.findByRole("dialog", { name: "Create project" })
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Create project" })
        ).toBeInTheDocument();
        expect(
            (screen.getByLabelText("Project name") as HTMLInputElement).value
        ).toBe("");
        expect(
            (screen.getByLabelText("Organization") as HTMLInputElement).value
        ).toBe("");
    });

    it("renders a localized manager select placeholder when zh-CN is active", async () => {
        setActiveLocale("zh-CN");
        renderProjectModal({ type: "open" });

        expect(
            await screen.findByRole("dialog", {
                name: zhCN.actions.createProject
            })
        ).toBeInTheDocument();
        expect(
            screen.getByText(zhCN.placeholders.selectManager)
        ).toBeInTheDocument();
        expect(screen.queryByText(/Select a manager/i)).not.toBeInTheDocument();
    });

    it("validates required create fields", async () => {
        renderProjectModal({ type: "open" });

        expect(
            await screen.findByRole("dialog", { name: "Create project" })
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Create project" }));

        expect(
            await screen.findByText("Please enter the project name")
        ).toBeInTheDocument();
        expect(
            screen.getByText("Please enter the organization")
        ).toBeInTheDocument();
        expect(screen.getByText("Please select a manager")).toBeInTheDocument();
    });

    it("creates a project and clears modal URL state on success", async () => {
        renderProjectModal({ type: "open" });

        expect(
            await screen.findByRole("dialog", { name: "Create project" })
        ).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText("Project name"), {
            target: { value: "Billing" }
        });
        fireEvent.change(screen.getByLabelText("Organization"), {
            target: { value: "Finance" }
        });
        fireEvent.mouseDown(screen.getByRole("combobox"));
        fireEvent.click(await screen.findByText("Alice"));
        fireEvent.click(screen.getByRole("button", { name: "Create project" }));

        await waitFor(() =>
            expect(
                fetchMock.mock.calls.some(
                    ([url, init]) =>
                        String(url).includes("/api/v1/projects") &&
                        init?.method === "POST" &&
                        JSON.parse(init.body as string).projectName ===
                            "Billing"
                )
            ).toBe(true)
        );

        // The server derives the manager from the JWT on create and
        // ignores any `managerId` in the body. Pin that the FE does not
        // send the field on `POST` so future refactors of `onFinish`
        // can't regress to a payload that pretends the user can pick.
        const postCall = fetchMock.mock.calls.find(
            ([url, init]) =>
                String(url).includes("/api/v1/projects") &&
                init?.method === "POST"
        );
        expect(postCall).toBeDefined();
        const postBody = JSON.parse(postCall![1]!.body as string);
        expect(postBody).not.toHaveProperty("managerId");
    });

    it("surfaces a create error and keeps the modal open when POST fails", async () => {
        fetchMock.mockImplementation((input, init) => {
            const url = String(input);
            const method = init?.method?.toUpperCase() ?? "GET";

            if (url.includes("users/members")) {
                return Promise.resolve(response(members));
            }
            if (url.includes("projects") && method === "POST") {
                return Promise.resolve(
                    response({ error: "Create failed on server" }, false)
                );
            }

            return Promise.resolve(response({}));
        });
        renderProjectModal({ type: "open" });

        expect(
            await screen.findByRole("dialog", { name: "Create project" })
        ).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText("Project name"), {
            target: { value: "Billing" }
        });
        fireEvent.change(screen.getByLabelText("Organization"), {
            target: { value: "Finance" }
        });
        fireEvent.mouseDown(screen.getByRole("combobox"));
        fireEvent.click(await screen.findByText("Alice"));
        fireEvent.click(screen.getByRole("button", { name: "Create project" }));

        await waitFor(() =>
            expect(
                screen.getByText(/create failed on server/i)
            ).toBeInTheDocument()
        );
        expect(store.getState().projectModal.isModalOpened).toBe(true);
    });

    it("closes and resets the modal from the cancel button", async () => {
        renderProjectModal({ type: "open" });

        expect(
            await screen.findByRole("dialog", { name: "Create project" })
        ).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText("Project name"), {
            target: { value: "Draft" }
        });
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        await waitFor(() =>
            expect(screen.getByTestId("location")).toHaveTextContent("")
        );
        // Modal stays force-rendered; the input still exists in the DOM but
        // its value has been reset by the cancel handler.
        expect(
            (screen.getByLabelText("Project name") as HTMLInputElement).value
        ).toBe("");
    });

    it("shows edit loading, populates the form, and updates the project", async () => {
        let resolveProject: (value: Response) => void = () => undefined;
        fetchMock.mockImplementation((input, init) => {
            const url = String(input);
            const method = init?.method?.toUpperCase() ?? "GET";

            if (url.includes("users/members")) {
                return Promise.resolve(response(members));
            }
            if (url.includes("projects?projectId=project-1")) {
                return new Promise<Response>((resolve) => {
                    resolveProject = resolve;
                });
            }
            if (url.includes("projects") && method === "PUT") {
                return Promise.resolve(
                    response(JSON.parse(init?.body as string))
                );
            }

            return Promise.resolve(response({}));
        });
        renderProjectModal({ type: "edit", id: "project-1" });

        await waitFor(() =>
            expect(document.body.querySelector(".ant-spin")).toBeInTheDocument()
        );
        await act(async () => {
            resolveProject(response(project()));
        });

        expect(
            await screen.findByRole("dialog", { name: "Edit project" })
        ).toBeInTheDocument();
        expect(screen.getByDisplayValue("Roadmap")).toBeInTheDocument();
        await act(async () => {
            fireEvent.change(screen.getByDisplayValue("Product"), {
                target: { value: "Platform" }
            });
        });
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "Save" }));
        });

        await waitFor(() =>
            expect(
                fetchMock.mock.calls.some(
                    ([url, init]) =>
                        String(url).includes("/api/v1/projects") &&
                        init?.method === "PUT" &&
                        JSON.parse(init.body as string).organization ===
                            "Platform"
                )
            ).toBe(true)
        );
    });

    it("caps the modal body height with env(keyboard-inset-height) so the footer stays above the iOS soft keyboard", async () => {
        // Regression for QW-18 (docs/design/ui-ux-comprehensive-review-2026-05.md).
        // The Modal body's inline style must subtract
        // `env(keyboard-inset-height, 0px)` so the footer cannot drop
        // below the viewport when the iOS software keyboard rises.
        renderProjectModal({ type: "open" });

        const dialog = await screen.findByRole("dialog", {
            name: "Create project"
        });
        const body = dialog.querySelector(
            ".ant-modal-body"
        ) as HTMLElement | null;
        expect(body).not.toBeNull();
        expect(body!.style.maxHeight).toMatch(/env\(keyboard-inset-height/);
    });

    it("stacks the phone footer Cancel → Save so the primary lands in the thumb zone", async () => {
        // Regression for QW-19 (docs/design/ui-ux-comprehensive-review-2026-05.md).
        // The matchMedia mock returns `matches: false` so AntD resolves to
        // phone mode. The footer must render Cancel above Save so the
        // primary action is the bottom-most target a thumb can reach.
        renderProjectModal({ type: "open" });
        await screen.findByRole("dialog", { name: "Create project" });

        const footerButtons = Array.from(
            document.querySelectorAll(".ant-modal-footer button")
        ) as HTMLButtonElement[];
        const labels = footerButtons.map(
            (btn) => btn.textContent?.trim() ?? ""
        );
        const cancelIdx = labels.findIndex((label) => /^cancel$/i.test(label));
        const primaryIdx = labels.findIndex((label) =>
            /^create project$/i.test(label)
        );
        expect(cancelIdx).toBeGreaterThanOrEqual(0);
        expect(primaryIdx).toBeGreaterThan(cancelIdx);
    });

    it("surfaces a save error and keeps the modal open when PUT fails", async () => {
        fetchMock.mockImplementation((input, init) => {
            const url = String(input);
            const method = init?.method?.toUpperCase() ?? "GET";

            if (url.includes("users/members")) {
                return Promise.resolve(response(members));
            }
            if (url.includes("projects?projectId=project-1")) {
                return Promise.resolve(response(project()));
            }
            if (url.includes("projects") && method === "PUT") {
                return Promise.resolve(
                    response({ error: "Save failed on server" }, false)
                );
            }

            return Promise.resolve(response({}));
        });
        renderProjectModal({ type: "edit", id: "project-1" });

        expect(
            await screen.findByRole("dialog", { name: "Edit project" })
        ).toBeInTheDocument();
        await act(async () => {
            fireEvent.change(screen.getByDisplayValue("Product"), {
                target: { value: "Platform" }
            });
        });
        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: "Save" }));
        });

        await waitFor(() =>
            expect(
                screen.getByText(/save failed on server/i)
            ).toBeInTheDocument()
        );
        expect(store.getState().projectModal.isModalOpened).toBe(true);
        expect(store.getState().projectModal.editingProjectId).toBe(
            "project-1"
        );
    });
});
