/**
 * Strict UI resilience tests (TDD harness).
 *
 * Each test pins one edge-case the surface should already handle:
 *
 *   - Long content that would otherwise blow out a column.
 *   - Missing/optional data (no manager, no createdAt, no coordinator).
 *   - Mock/placeholder data that should never trigger a real mutation.
 *   - Heuristic safeguards (like pressing Enter on an empty AI search).
 *
 * A failing test means the surface is fragile in that edge case and the
 * fix is to harden the component (add a fallback, clamp the layout, or
 * guard the action). The plan calls these out across §1.16, §1.20, and
 * §3.6 (empty / loading / error states).
 */
/* eslint-disable global-require */
import "@testing-library/jest-dom";

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { BrowserRouter, MemoryRouter, Route, Routes } from "react-router-dom";

import AiSearchInput from "../components/aiSearchInput";
import EmptyState from "../components/emptyState";
import ErrorBox from "../components/errorBox";
import ProjectList from "../components/projectList";
import UserAvatar, { gradientFor, initialsOf } from "../components/userAvatar";
import { microcopy } from "../constants/microcopy";
import useAi from "../utils/hooks/useAi";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useAuth from "../utils/hooks/useAuth";
import useProjectModal from "../utils/hooks/useProjectModal";
import useReactMutation from "../utils/hooks/useReactMutation";

jest.mock("../utils/hooks/useAi");
jest.mock("../utils/hooks/useAiEnabled");
jest.mock("../utils/hooks/useAuth");
jest.mock("../utils/hooks/useProjectModal");
jest.mock("../utils/hooks/useReactMutation");
// AiSearchInput mounts useAgent unconditionally (v2.1 dual-engine pattern);
// stub it so these tests don't require a QueryClientProvider or agent server.
// The stub MUST return a stable reference so consumer effects with
// `remoteAgent` in their deps don't re-run on every render.
jest.mock("../utils/hooks/useAgent", () => {
    const stub = {
        start: jest.fn().mockResolvedValue(undefined),
        resume: jest.fn().mockResolvedValue(undefined),
        abort: jest.fn(),
        isStreaming: false,
        state: { messages: [] },
        pendingInterrupt: null,
        pendingProposal: null,
        citations: [],
        nudges: [],
        lastSuggestion: null,
        error: null,
        reset: jest.fn(),
        threadId: "t_test",
        ttftMs: null,
        clearPendingProposal: jest.fn(),
        clearSuggestion: jest.fn(),
        dismissNudge: jest.fn()
    };
    return { __esModule: true, default: () => stub };
});

type DropdownMenuItem = {
    key?: string | number;
    label?: ReactNode;
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
                    menu?.items?.map((item: DropdownMenuItem) =>
                        React.createElement(
                            "div",
                            { key: item.key },
                            item.label
                        )
                    )
                )
            )
    };
});

const mockedUseAi = useAi as jest.MockedFunction<typeof useAi>;
const mockedUseAiEnabled = useAiEnabled as jest.MockedFunction<
    typeof useAiEnabled
>;
const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseProjectModal = useProjectModal as jest.Mock;
const mockedUseReactMutation = useReactMutation as jest.MockedFunction<
    typeof useReactMutation
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

beforeAll(() => {
    installAntdBrowserMocks();
});

/* -------------------------------------------------------------------------- */
/* 1. ProjectList — empty + missing data fallbacks                            */
/* -------------------------------------------------------------------------- */
describe("UI quality :: ProjectList resilience", () => {
    const renderList = (dataSource: IProject[]) => {
        mockedUseAuth.mockReturnValue({
            logout: jest.fn(),
            isAuthenticated: true,
            user: user()
        });
        mockedUseProjectModal.mockReturnValue({
            openModal: jest.fn(),
            startEditing: jest.fn()
        });
        mockedUseReactMutation.mockImplementation((endpoint: string) => {
            if (endpoint === "users/likes") {
                return {
                    isLoading: false,
                    mutate: jest.fn(),
                    mutateAsync: jest.fn().mockResolvedValue({})
                } as unknown as ReturnType<typeof useReactMutation<unknown>>;
            }
            return {
                isLoading: false,
                mutate: jest.fn(),
                mutateAsync: jest.fn().mockResolvedValue({})
            } as unknown as ReturnType<typeof useReactMutation<unknown>>;
        });

        return render(
            <MemoryRouter initialEntries={["/projects"]}>
                <Routes>
                    <Route
                        path="/projects"
                        element={
                            <ProjectList
                                dataSource={dataSource}
                                loading={false}
                                members={[member()]}
                            />
                        }
                    />
                </Routes>
            </MemoryRouter>
        );
    };

    it("renders the empty state and a CTA whose label is exactly microcopy.actions.createProject when there are zero projects", () => {
        renderList([]);

        // Empty-state heading still in the DOM.
        expect(
            screen.getByRole("heading", {
                name: microcopy.empty.projects.title
            })
        ).toBeInTheDocument();

        // The CTA is currently rendered as `${microcopy.actions.create} project`
        // — we want the label promoted to `microcopy.actions.createProject`
        // so word order is localizable. Match on the exact button name.
        expect(
            screen.getByRole("button", {
                name: microcopy.actions.createProject
            })
        ).toBeInTheDocument();
    });

    it("renders 'No manager' for a project whose managerId points at no member", () => {
        renderList([project({ _id: "p-orphan", managerId: "ghost" })]);

        expect(
            screen.getByText(microcopy.feedback.noManager)
        ).toBeInTheDocument();
    });

    it("renders 'No date' for a project with an empty createdAt", () => {
        renderList([project({ _id: "p-2", createdAt: "" })]);

        expect(screen.getByText(microcopy.feedback.noDate)).toBeInTheDocument();
    });

    it("formats createdAt with locale-aware Intl, never as a hard-coded YYYY-MM-DD string", () => {
        renderList([project({ createdAt: "2026-04-25T00:00:00.000Z" })]);

        // We expect an Intl-formatted "Apr 25, 2026" (or locale equivalent),
        // never the raw ISO string and never the dayjs-style "YYYY-MM-DD"
        // (§2.A.6: no `dayjs(...).format(...)` baked-in formats).
        const cells = Array.from(
            document.querySelectorAll<HTMLElement>("td, span")
        ).map((node) => (node.textContent ?? "").trim());

        expect(cells).not.toContain("2026-04-25T00:00:00.000Z");
        expect(cells).not.toContain("2026-04-25");
    });
});

/* -------------------------------------------------------------------------- */
/* 2. UserAvatar — deterministic, never empty, handles emoji                   */
/* -------------------------------------------------------------------------- */
describe("UI quality :: UserAvatar resilience", () => {
    it("gradientFor returns a non-empty gradient string for every id", () => {
        // Whatever the input, the gradient must be a CSS-valid string;
        // the test guards against an accidental "" / undefined return.
        ["", "abc", "0".repeat(200), "🤖", "你好"].forEach((id) => {
            const gradient = gradientFor(id);
            expect(typeof gradient).toBe("string");
            expect(gradient.length).toBeGreaterThan(0);
        });
    });

    it("gradientFor is deterministic — same id always returns the same gradient", () => {
        expect(gradientFor("alice")).toBe(gradientFor("alice"));
        expect(gradientFor("bob")).toBe(gradientFor("bob"));
    });

    it("initialsOf returns a non-empty string for emoji-only names", () => {
        const result = initialsOf("🤖");
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
    });

    it("UserAvatar renders the default profile icon for empty / null names without exposing 'undefined'", () => {
        const { container, rerender } = render(
            <UserAvatar id="x" name={null} />
        );
        // Default state is the AntD UserOutlined icon — no initials, no
        // literal "undefined", and no "?" leak from the old placeholder.
        expect(container.textContent).not.toMatch(/\bundefined\b/i);
        expect(container.querySelector(".anticon-user")).not.toBeNull();
        expect(container.textContent).not.toContain("?");

        rerender(<UserAvatar id="y" name={undefined} />);
        expect(container.textContent).not.toMatch(/\bundefined\b/i);
        expect(container.querySelector(".anticon-user")).not.toBeNull();
    });
});

/* -------------------------------------------------------------------------- */
/* 3. EmptyState — semantic, accessible, ships the CTA verbatim                */
/* -------------------------------------------------------------------------- */
describe("UI quality :: EmptyState resilience", () => {
    it("EmptyState renders the title as a real heading element so it's reachable by H navigation", () => {
        render(
            <EmptyState description="Nothing yet" title="Add your first item" />
        );
        expect(
            screen.getByRole("heading", { name: /add your first item/i })
        ).toBeInTheDocument();
    });

    it("EmptyState renders the CTA child verbatim — no wrapping that hides its accessible name", () => {
        render(
            <EmptyState
                cta={
                    <button type="button">
                        {microcopy.actions.createProject}
                    </button>
                }
                description="Get started"
                title="No projects"
            />
        );
        expect(
            screen.getByRole("button", {
                name: microcopy.actions.createProject
            })
        ).toBeInTheDocument();
    });

    it("EmptyState exposes a status / region landmark so screen readers announce the state change", () => {
        const { container } = render(
            <EmptyState description="Nothing yet" title="Empty board" />
        );
        // Either role="status" (announce on appearance) or role="region"
        // is acceptable — a bare `<div>` with no role would slip past
        // assistive tech entirely.
        const roles = Array.from(
            container.querySelectorAll<HTMLElement>("[role]")
        ).map((node) => node.getAttribute("role"));
        expect(roles).toEqual(
            expect.arrayContaining([expect.stringMatching(/status|region/)])
        );
    });
});

/* -------------------------------------------------------------------------- */
/* 4. ErrorBox — handles every error shape the API may throw                    */
/* -------------------------------------------------------------------------- */
describe("UI quality :: ErrorBox shape coverage", () => {
    /**
     * The mutation hook can pass an `Error`, an `IError` payload, a raw
     * string, an array of `{ msg }` objects, or a falsy value. The box
     * must render exactly one of: a hidden placeholder (no message), a
     * copy-friendly summary string, or the upstream message verbatim —
     * and never the literal `[object Object]`.
     */
    it("renders nothing visible when error is null", () => {
        render(<ErrorBox error={null} />);
        const alert = screen.getByRole("alert");
        expect(alert.textContent ?? "").toBe("");
    });

    it("renders the upstream message for a real Error instance", () => {
        render(<ErrorBox error={new Error("Server down")} />);
        expect(screen.getByText(/server down/i)).toBeInTheDocument();
    });

    it("renders a friendly fallback for an unknown / object-shape error — never the literal '[object Object]'", () => {
        // Pass an object that is neither an Error nor an IError so the
        // resolver must return the fallback message rather than rendering
        // `${error}` which would produce "[object Object]".
        render(<ErrorBox error={{ unknownShape: true } as unknown} />);
        const alert = screen.getByRole("alert");
        expect(alert.textContent ?? "").not.toMatch(/\[object Object\]/);
    });

    it("renders the API's array-of-msg payload as the first msg", () => {
        // Mirrors the shape json-server returns for validation errors.
        const payload = {
            error: [{ msg: "Email is invalid" }, { msg: "Password too short" }]
        } as IError;
        render(<ErrorBox error={payload} />);
        expect(screen.getByText(/email is invalid/i)).toBeInTheDocument();
    });
});

/* -------------------------------------------------------------------------- */
/* 5. AiSearchInput — guards against empty / pending state regressions          */
/* -------------------------------------------------------------------------- */
describe("UI quality :: AiSearchInput guards", () => {
    const projectContext = {
        project: { _id: "p1", projectName: "Roadmap" },
        columns: [],
        members: [member()],
        tasks: []
    };

    const renderInput = () => {
        mockedUseAiEnabled.mockReturnValue({
            available: true,
            enabled: true,
            setEnabled: jest.fn()
        });
        const run = jest.fn().mockResolvedValue({ ids: [], rationale: "" });
        mockedUseAi.mockReturnValue({
            data: undefined,
            error: null,
            isLoading: false,
            reset: jest.fn(),
            run
        } as unknown as ReturnType<typeof useAi<unknown>>);

        const setSemanticIds = jest.fn();
        render(
            <BrowserRouter>
                <AiSearchInput
                    kind="tasks"
                    projectContext={projectContext}
                    semanticIds={null}
                    setSemanticIds={setSemanticIds}
                />
            </BrowserRouter>
        );
        return { run, setSemanticIds };
    };

    it("does not call the AI run when the user presses Enter on an empty query", () => {
        const { run } = renderInput();
        const input = screen.getByLabelText(
            /Find related tasks with AI and filter the task list/i
        );

        fireEvent.keyDown(input, { code: "Enter", key: "Enter" });
        fireEvent.keyUp(input, { code: "Enter", key: "Enter" });

        expect(run).not.toHaveBeenCalled();
    });

    it("disables the AI filter button while the query is empty so a single-click can't fire a wasted request", () => {
        renderInput();
        // §2.A.1 — the AI filter button should only enable when there's a
        // non-whitespace query, and its accessible name must distinguish the
        // filter action from opening Board Copilot chat.
        const searchBtn = screen.getByRole("button", {
            name: microcopy.ai.findRelatedTasks
        });
        expect(searchBtn).toBeDisabled();
    });

    it("AI filter button label is sourced from AI microcopy", () => {
        renderInput();
        const search = microcopy.ai.findRelatedTasks;
        expect(search).toBeTruthy();
        if (search) {
            // Either as visible text or as `aria-label` — match by name.
            const matched = screen.getAllByRole("button").some((btn) => {
                const label =
                    btn.getAttribute("aria-label") ?? btn.textContent ?? "";
                return label.trim() === search;
            });
            expect(matched).toBe(true);
        }
    });

    it("tasks variant: undefined `tasks` on projectContext does not throw on mount", () => {
        mockedUseAiEnabled.mockReturnValue({
            available: true,
            enabled: true,
            setEnabled: jest.fn()
        });
        mockedUseAi.mockReturnValue({
            data: undefined,
            error: null,
            isLoading: false,
            reset: jest.fn(),
            run: jest.fn()
        } as unknown as ReturnType<typeof useAi<unknown>>);

        expect(() =>
            render(
                <BrowserRouter>
                    <AiSearchInput
                        kind="tasks"
                        projectContext={
                            {
                                ...projectContext,
                                tasks: undefined
                            } as unknown as typeof projectContext
                        }
                        semanticIds={null}
                        setSemanticIds={jest.fn()}
                    />
                </BrowserRouter>
            )
        ).not.toThrow();
    });

    it("projects variant: undefined `projects` on projectsContext does not throw on mount", () => {
        mockedUseAiEnabled.mockReturnValue({
            available: true,
            enabled: true,
            setEnabled: jest.fn()
        });
        mockedUseAi.mockReturnValue({
            data: undefined,
            error: null,
            isLoading: false,
            reset: jest.fn(),
            run: jest.fn()
        } as unknown as ReturnType<typeof useAi<unknown>>);

        expect(() =>
            render(
                <BrowserRouter>
                    <AiSearchInput
                        kind="projects"
                        projectsContext={
                            {
                                members: [],
                                projects: undefined
                            } as never
                        }
                        semanticIds={null}
                        setSemanticIds={jest.fn()}
                    />
                </BrowserRouter>
            )
        ).not.toThrow();
    });
});
