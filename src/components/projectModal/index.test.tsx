import {
    act,
    fireEvent,
    render,
    screen,
    waitFor
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { microcopy } from "../../constants/microcopy";
import { DEFAULT_LOCALE, setActiveLocale } from "../../i18n";
import zhCN from "../../i18n/locales/zh-CN";
import { store } from "../../store";
import { activityFeedActions } from "../../store/reducers/activityFeedSlice";
import { aiLedgerActions } from "../../store/reducers/aiLedgerSlice";
import { projectActions } from "../../store/reducers/projectModalSlice";
import useActivityFeed from "../../utils/hooks/useActivityFeed";
import useUndoToast from "../../utils/hooks/useUndoToast";

import ProjectModal from ".";

// The transient Undo toast routes through the out-of-scope, AntD-backed
// `useUndoToast`. Mock it so this suite stays free of AntD's global message
// container while still asserting the save flow raises the toast with the
// right copy and a working inverse-mutation undo closure.
jest.mock("../../utils/hooks/useUndoToast");

interface UndoOptions {
    description: string;
    analyticsTag?: string;
    undo: () => Promise<void>;
}
const showUndoToast = jest.fn();
let lastUndoOptions: UndoOptions | null = null;

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

const installBrowserMocks = () => {
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

    // Radix Select drives its listbox with pointer-capture + scroll APIs
    // jsdom doesn't ship; polyfill them so the manager picker can open.
    Element.prototype.scrollIntoView = jest.fn();
    Element.prototype.hasPointerCapture = jest.fn(() => false);
    Element.prototype.releasePointerCapture = jest.fn();
};

const pickManager = async (name: string) => {
    const menuUser = userEvent.setup();
    await menuUser.click(screen.getByRole("combobox"));
    await menuUser.click(await screen.findByRole("option", { name }));
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
                                    <button
                                        data-testid="project-modal-opener"
                                        onClick={() =>
                                            store.dispatch(
                                                projectActions.openModal()
                                            )
                                        }
                                        type="button"
                                    >
                                        Open project modal
                                    </button>
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
        installBrowserMocks();
        consoleErrorSpy = silenceExpectedConsoleErrors([
            ["An update to", "null", "not wrapped in act"],
            ["An update to", "Field", "not wrapped in act"]
        ]);
    });

    beforeEach(() => {
        lastUndoOptions = null;
        showUndoToast.mockReset();
        showUndoToast.mockImplementation((options: UndoOptions) => {
            lastUndoOptions = options;
            return { dismiss: jest.fn() };
        });
        (useUndoToast as jest.Mock).mockReturnValue({ show: showUndoToast });
        store.dispatch(projectActions.closeModal());
        // Clear both slices so cross-test pollution from earlier
        // suites doesn't pre-populate the activity feed.
        act(() => {
            store.dispatch(activityFeedActions.clearActivityFeed());
            store.dispatch(aiLedgerActions.clearAiLedger());
        });
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
        act(() => {
            store.dispatch(activityFeedActions.clearActivityFeed());
            store.dispatch(aiLedgerActions.clearAiLedger());
        });
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

    it("renders the desktop Manager list above the dialog overlay", async () => {
        const user = userEvent.setup();
        renderProjectModal({ type: "open" });

        await screen.findByRole("dialog", { name: "Create project" });
        await user.click(screen.getByRole("combobox", { name: "Manager" }));

        const listbox = await screen.findByRole("listbox");
        expect(listbox.className).toContain("z-[1200]");
        await user.click(screen.getByRole("option", { name: "Alice" }));
        expect(
            screen.getByRole("combobox", { name: "Manager" })
        ).toHaveTextContent("Alice");
    });

    it("opens the phone project form at the large detent", async () => {
        const originalMatchMedia = window.matchMedia;
        Object.defineProperty(window, "matchMedia", {
            writable: true,
            value: (query: string) => ({
                addEventListener: jest.fn(),
                addListener: jest.fn(),
                dispatchEvent: jest.fn(),
                matches: query === "(pointer: coarse)",
                media: query,
                onchange: null,
                removeEventListener: jest.fn(),
                removeListener: jest.fn()
            })
        });

        renderProjectModal({ type: "open" });

        expect(await screen.findByTestId("sheet-surface")).toHaveAttribute(
            "data-detent",
            "large"
        );
        Object.defineProperty(window, "matchMedia", {
            writable: true,
            value: originalMatchMedia
        });
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
        await pickManager("Alice");
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

    it("surfaces an Undo toast after create and re-DELETEs the project on click", async () => {
        // §2.A.4 — a create is reversible, so it surfaces a transient Undo
        // toast alongside the activity feed. Clicking Undo replays the
        // inverse mutation: a DELETE that removes the just-created project.
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
        await pickManager("Alice");
        await act(async () => {
            fireEvent.click(
                screen.getByRole("button", { name: "Create project" })
            );
        });

        // The create flow raises the transient Undo toast with the created
        // copy; its `undo` closure DELETEs the just-created project by id.
        await waitFor(() => expect(showUndoToast).toHaveBeenCalledTimes(1));
        expect(showUndoToast).toHaveBeenCalledWith(
            expect.objectContaining({
                description: microcopy.feedback.projectCreated
            })
        );
        await act(async () => {
            await lastUndoOptions?.undo();
        });

        await waitFor(() => {
            const deleteCall = fetchMock.mock.calls.find(
                ([, init]) =>
                    (init as RequestInit | undefined)?.method === "DELETE"
            );
            expect(deleteCall).toBeDefined();
            expect(String(deleteCall?.[0])).toContain("/api/v1/projects");
            expect(String(deleteCall?.[0])).toContain("projectId=project-2");
        });
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
        await pickManager("Alice");
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

        // §2.A.1 — a touched form prompts before discarding. Confirm the
        // discard to proceed with the close + reset.
        fireEvent.click(await screen.findByRole("button", { name: "Discard" }));

        await waitFor(() =>
            expect(screen.getByTestId("location")).toHaveTextContent("")
        );
        // The Radix Dialog unmounts on close, so the form leaves the DOM;
        // reopening it (a fresh mount) starts from the reset initial values.
        await waitFor(() =>
            expect(
                screen.queryByRole("dialog", { name: "Create project" })
            ).not.toBeInTheDocument()
        );
    });

    it("restores the connected opener after a clean close", async () => {
        const user = userEvent.setup();
        renderProjectModal();
        const opener = screen.getByTestId("project-modal-opener");

        await user.click(opener);
        await screen.findByRole("dialog", { name: "Create project" });
        await user.keyboard("{Escape}");

        await waitFor(() =>
            expect(
                screen.queryByRole("dialog", { name: "Create project" })
            ).not.toBeInTheDocument()
        );
        await waitFor(() => expect(opener).toHaveFocus());
    });

    it("restores the opener after confirming a dirty close", async () => {
        const user = userEvent.setup();
        renderProjectModal();
        const opener = screen.getByTestId("project-modal-opener");

        await user.click(opener);
        await screen.findByRole("dialog", { name: "Create project" });
        await user.type(screen.getByLabelText("Project name"), "Draft");
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        await user.click(
            await screen.findByRole("button", { name: "Discard" })
        );

        await waitFor(() =>
            expect(
                screen.queryByRole("dialog", { name: "Create project" })
            ).not.toBeInTheDocument()
        );
        await waitFor(() => expect(opener).toHaveFocus());
    });

    it("keeps focus inside the project form when discard is cancelled", async () => {
        const user = userEvent.setup();
        renderProjectModal();

        await user.click(screen.getByTestId("project-modal-opener"));
        const projectDialog = await screen.findByRole("dialog", {
            name: "Create project"
        });
        await user.type(screen.getByLabelText("Project name"), "Draft");
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        await user.click(
            await screen.findByRole("button", { name: "Keep editing" })
        );

        await waitFor(() =>
            expect(
                screen.queryByRole("dialog", { name: "Discard changes?" })
            ).not.toBeInTheDocument()
        );
        expect(projectDialog.contains(document.activeElement)).toBe(true);
    });

    it("does not focus a detached opener after close", async () => {
        const user = userEvent.setup();
        const opener = document.createElement("button");
        document.body.appendChild(opener);
        opener.focus();
        renderProjectModal({ type: "open" });

        await screen.findByRole("dialog", { name: "Create project" });
        opener.remove();
        await user.keyboard("{Escape}");

        await waitFor(() =>
            expect(
                screen.queryByRole("dialog", { name: "Create project" })
            ).not.toBeInTheDocument()
        );
        expect(document.body).toHaveFocus();
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
            expect(
                screen.getByText(microcopy.a11y.loadingProject)
            ).toBeInTheDocument()
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

    it("hydrates and submits the existing manager on the coarse-pointer edit branch", async () => {
        const originalMatchMedia = window.matchMedia;
        Object.defineProperty(window, "matchMedia", {
            writable: true,
            value: (query: string) => ({
                addEventListener: jest.fn(),
                addListener: jest.fn(),
                dispatchEvent: jest.fn(),
                matches: query === "(pointer: coarse)",
                media: query,
                onchange: null,
                removeEventListener: jest.fn(),
                removeListener: jest.fn()
            })
        });
        renderProjectModal({ type: "edit", id: "project-1" });

        expect(
            await screen.findByRole("dialog", { name: "Edit project" })
        ).toBeInTheDocument();
        await waitFor(() =>
            expect(
                screen.getByRole("combobox", { name: "Manager" })
            ).toHaveTextContent("Alice")
        );
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => {
            const putCall = fetchMock.mock.calls.find(
                ([url, init]) =>
                    String(url).includes("/api/v1/projects") &&
                    init?.method === "PUT"
            );
            expect(putCall).toBeDefined();
            expect(JSON.parse(putCall![1]!.body as string).managerId).toBe(
                "member-1"
            );
        });
        Object.defineProperty(window, "matchMedia", {
            writable: true,
            value: originalMatchMedia
        });
    });

    it("preserves the hydrated manager across a responsive branch remount", async () => {
        const originalMatchMedia = window.matchMedia;
        let isCoarse = false;
        const listeners = new Set<(event: MediaQueryListEvent) => void>();
        const coarseMedia = {
            get matches() {
                return isCoarse;
            },
            media: "(pointer: coarse)",
            onchange: null,
            addEventListener: (
                event: string,
                listener: (event: MediaQueryListEvent) => void
            ) => {
                if (event === "change") listeners.add(listener);
            },
            removeEventListener: (
                event: string,
                listener: (event: MediaQueryListEvent) => void
            ) => {
                if (event === "change") listeners.delete(listener);
            },
            addListener: jest.fn(),
            removeListener: jest.fn(),
            dispatchEvent: jest.fn()
        } as unknown as MediaQueryList;
        Object.defineProperty(window, "matchMedia", {
            writable: true,
            value: (query: string) =>
                query === "(pointer: coarse)"
                    ? coarseMedia
                    : ({
                          matches: false,
                          media: query,
                          onchange: null,
                          addEventListener: jest.fn(),
                          removeEventListener: jest.fn(),
                          addListener: jest.fn(),
                          removeListener: jest.fn(),
                          dispatchEvent: jest.fn()
                      } as unknown as MediaQueryList)
        });
        renderProjectModal({ type: "edit", id: "project-1" });

        await waitFor(() =>
            expect(
                screen.getByRole("combobox", { name: "Manager" })
            ).toHaveTextContent("Alice")
        );
        isCoarse = true;
        act(() => {
            listeners.forEach((listener) =>
                listener({ matches: true } as MediaQueryListEvent)
            );
        });

        expect(await screen.findByTestId("sheet-surface")).toHaveAttribute(
            "data-detent",
            "large"
        );
        expect(
            screen.getByRole("combobox", { name: "Manager" })
        ).toHaveTextContent("Alice");
        Object.defineProperty(window, "matchMedia", {
            writable: true,
            value: originalMatchMedia
        });
    });

    it("caps the modal body height with env(keyboard-inset-height) AND clamps it via max() so landscape + keyboard cannot produce a negative max-height (Bug 6)", async () => {
        // Regression for QW-18 + Bug 6 (docs/design/ui-ux-comprehensive-review-2026-05.md).
        // The Modal body's inline style must subtract
        // `env(keyboard-inset-height, 0px)` so the footer cannot drop
        // below the viewport when the iOS software keyboard rises, and
        // wrap the calc in `max(80px, …)` so the result cannot collapse
        // to a negative max-height in landscape orientation.
        renderProjectModal({ type: "open" });

        const dialog = await screen.findByRole("dialog", {
            name: "Create project"
        });
        const body = dialog.querySelector(
            '[style*="keyboard-inset-height"]'
        ) as HTMLElement | null;
        expect(body).not.toBeNull();
        expect(body!.style.maxHeight).toMatch(/env\(keyboard-inset-height/);
        expect(body!.style.maxHeight).toMatch(/max\(/);
    });

    it("stacks the footer Cancel → Create so the primary lands in the thumb zone", async () => {
        // Regression for QW-19 (docs/design/ui-ux-comprehensive-review-2026-05.md).
        // The footer must render Cancel before Create in DOM order so the
        // primary action is the bottom-most / right-most target — on phone
        // the stacked column puts it in the thumb zone.
        renderProjectModal({ type: "open" });
        await screen.findByRole("dialog", { name: "Create project" });

        const cancelButton = screen.getByRole("button", { name: /^cancel$/i });
        const primaryButton = screen.getByRole("button", {
            name: /^create project$/i
        });
        expect(
            cancelButton.compareDocumentPosition(primaryButton) &
                Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
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

    /*
     * Phase 4.3 — undo closure test. The brief required each
     * update site to register a fire-and-forget undo on the
     * activity feed so the 10s-window Undo button in the drawer
     * reverses the action. For project update the closure PUTs
     * the captured before-state; this test triggers the closure
     * through the public `undo(id)` surface and asserts the PUT
     * lands with the original organization.
     */
    it("registers an undo closure that PUTs the project before-state", async () => {
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

        await waitFor(() => {
            const events = store.getState().activityFeed.events;
            expect(events).toHaveLength(1);
            expect(events[0].kind).toBe("project");
            expect(events[0].action).toBe("update");
            expect(events[0].undoable).toBe(true);
        });

        // Drive the activity-feed undo from a probe that uses the
        // same Provider, so the module-scope closure Map is
        // reachable (mirrors the pattern in
        // `useActivityFeed.test.tsx`).
        let capturedUndo: ((id: string) => Promise<void>) | null = null;
        const UndoProbe: React.FC = () => {
            const api = useActivityFeed();
            capturedUndo = api.undo;
            return null;
        };
        render(
            <Provider store={store}>
                <UndoProbe />
            </Provider>
        );
        const eventId = store.getState().activityFeed.events[0].id;
        await act(async () => {
            await capturedUndo!(eventId);
        });

        // After undo, a second PUT should have been issued with the
        // original "Product" organization restored from before-state.
        await waitFor(() => {
            const putCalls = fetchMock.mock.calls.filter(
                ([, init]) =>
                    String(
                        (init as RequestInit | undefined)?.method
                    ).toUpperCase() === "PUT"
            );
            expect(putCalls.length).toBeGreaterThanOrEqual(2);
            const lastPut = putCalls.at(-1)!;
            const body = JSON.parse((lastPut[1] as RequestInit).body as string);
            expect(body.organization).toBe("Product");
        });
    });
});
