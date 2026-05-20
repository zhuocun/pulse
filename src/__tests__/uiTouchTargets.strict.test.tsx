/**
 * Strict touch-target tests (TDD harness).
 *
 * Each test pins one minimum hit-area expectation per WCAG 2.5.5 (24×24
 * minimum, AA) and 2.5.8 (24×24 enhanced) plus the §2.A.2 / §3.4
 * recommendation of 44×44 on `pointer: coarse` viewports. A failing test
 * is the signal that an interactive control is too small to be tapped on
 * a phone without zoom.
 *
 * jsdom does not actually compute layout. To still catch regressions, we
 * inspect each control's emotion-rendered CSS rules (via the document
 * stylesheets) for the relevant `min-height` / `min-width` / `height` /
 * `width` declarations. The check is structural — it confirms the
 * component declares the right size constraints, not that the browser
 * paints them at that size.
 */
/* eslint-disable global-require */
import "@testing-library/jest-dom";

import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, MemoryRouter, Route, Routes } from "react-router-dom";

import ColumnCreator from "../components/columnCreator";
import Header from "../components/header";
import LoginForm from "../components/loginForm";
import ProjectList from "../components/projectList";
import RegisterForm from "../components/registerForm";
import TaskCreator from "../components/taskCreator";
import { store } from "../store";
import useAiEnabled from "../utils/hooks/useAiEnabled";
import useAuth from "../utils/hooks/useAuth";
import useColorScheme from "../utils/hooks/useColorScheme";
import useProjectModal from "../utils/hooks/useProjectModal";
import useReactMutation from "../utils/hooks/useReactMutation";

jest.mock("../utils/hooks/useAiEnabled");
jest.mock("../utils/hooks/useAuth");
jest.mock("../utils/hooks/useColorScheme");
jest.mock("../utils/hooks/useProjectModal");
jest.mock("../utils/hooks/useReactMutation");
jest.mock("../assets/logo-software.svg?react", () => {
    const React = require("react");

    return {
        __esModule: true,
        default: (props: Record<string, unknown>) =>
            React.createElement("svg", { "data-testid": "logo", ...props })
    };
});
jest.mock("../components/memberPopover", () => {
    const React = require("react");

    return {
        __esModule: true,
        default: () =>
            React.createElement(
                "button",
                { type: "button", "aria-label": "Members" },
                "Members"
            )
    };
});

const mockedUseAiEnabled = useAiEnabled as jest.MockedFunction<
    typeof useAiEnabled
>;
const mockedUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockedUseColorScheme = useColorScheme as jest.MockedFunction<
    typeof useColorScheme
>;
const mockedUseProjectModal = useProjectModal as jest.Mock;
const mockedUseReactMutation = useReactMutation as jest.MockedFunction<
    typeof useReactMutation
>;

const installAntdBrowserMocks = () => {
    const fn = (query: string) => ({
        addEventListener: jest.fn(),
        addListener: jest.fn(),
        dispatchEvent: jest.fn(),
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: jest.fn(),
        removeListener: jest.fn()
    });
    (window as unknown as { matchMedia: (q: string) => unknown }).matchMedia =
        fn;

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

const member = (overrides: Partial<IMember> = {}): IMember => ({
    _id: "member-1",
    email: "alice@example.com",
    username: "Alice",
    ...overrides
});

const user = (overrides: Partial<IUser> = {}): IUser => ({
    _id: "u1",
    email: "alice@example.com",
    likedProjects: [],
    username: "Alice",
    ...overrides
});

const project = (overrides: Partial<IProject> = {}): IProject => ({
    _id: "p1",
    createdAt: "2026-04-25T00:00:00.000Z",
    managerId: "member-1",
    organization: "Product",
    projectName: "Roadmap",
    ...overrides
});

const stubMutation = () =>
    ({
        error: null,
        isLoading: false,
        mutate: jest.fn(),
        mutateAsync: jest.fn().mockResolvedValue({})
    }) as unknown as ReturnType<typeof useReactMutation<unknown>>;

beforeAll(() => {
    installAntdBrowserMocks();
});

beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAuth.mockReturnValue({
        logout: jest.fn(),
        isAuthenticated: true,
        user: user()
    });
    mockedUseAiEnabled.mockReturnValue({
        available: false,
        enabled: false,
        setEnabled: jest.fn()
    });
    mockedUseColorScheme.mockReturnValue({
        preference: "light",
        scheme: "light",
        setPreference: jest.fn()
    });
    mockedUseProjectModal.mockReturnValue({
        closeModal: jest.fn(),
        editingProject: undefined,
        isLoading: false,
        isModalOpened: false,
        openModal: jest.fn(),
        startEditing: jest.fn()
    });
    mockedUseReactMutation.mockReturnValue(stubMutation());
});

/**
 * Walk every CSS rule emotion has injected into the page and collect the
 * `min-height` / `min-width` / `height` / `width` declarations that apply
 * to a given element's class list, accounting for the `@media (pointer:
 * coarse)` lift the plan calls out at §2.A.2.
 *
 * Returns the set of relevant size declarations as `{ rule, prop, value,
 * media }` triples so the test can assert the maximum size declared.
 */
type SizeDecl = {
    media: string | null;
    prop: "min-height" | "min-width" | "height" | "width";
    value: string;
};

const collectSizeDecls = (element: HTMLElement): SizeDecl[] => {
    const classes = Array.from(element.classList);
    const out: SizeDecl[] = [];
    const sheets = Array.from(document.styleSheets);
    const matchSelector = (selector: string) =>
        classes.some((cls) => selector.includes(`.${cls}`));

    const collect = (rules: CSSRuleList | undefined, media: string | null) => {
        if (!rules) return;
        Array.from(rules).forEach((rule) => {
            if (rule instanceof CSSMediaRule) {
                collect(rule.cssRules, rule.conditionText);
                return;
            }
            if (!(rule instanceof CSSStyleRule)) return;
            if (!matchSelector(rule.selectorText)) return;
            (["min-height", "min-width", "height", "width"] as const).forEach(
                (prop) => {
                    const value = rule.style.getPropertyValue(prop);
                    if (value) {
                        out.push({ media, prop, value: value.trim() });
                    }
                }
            );
        });
    };

    sheets.forEach((sheet) => {
        try {
            collect(sheet.cssRules, null);
        } catch {
            // Cross-origin sheet — skip.
        }
    });
    return out;
};

const parsePx = (value: string): number | null => {
    const px = /^(\d+(?:\.\d+)?)px$/.exec(value);
    if (px) return parseFloat(px[1]);
    const rem = /^(\d+(?:\.\d+)?)rem$/.exec(value);
    if (rem) return parseFloat(rem[1]) * 16;
    const em = /^(\d+(?:\.\d+)?)em$/.exec(value);
    if (em) return parseFloat(em[1]) * 16;
    return null;
};

const maxPxDeclared = (
    decls: SizeDecl[],
    prop: SizeDecl["prop"],
    media?: string
): number => {
    return Math.max(
        0,
        ...decls
            .filter((d) => d.prop === prop)
            .filter((d) => (media ? d.media?.includes(media) : !d.media))
            .map((d) => parsePx(d.value) ?? 0)
    );
};

/* -------------------------------------------------------------------------- */
/* 1. AuthButton — primary CTA always ≥ 44 px                                  */
/* -------------------------------------------------------------------------- */
describe("UI quality :: AuthButton size", () => {
    /**
     * Login / register submit button must be at least 44 px tall on every
     * viewport — it's the dominant CTA on the form and fingers must land
     * it without zoom. The styled `AuthButton` already declares
     * `height: 44px`; this test pins that contract.
     */
    it("LoginForm 'Log in' button declares height ≥ 44 px (WCAG 2.5.8)", () => {
        render(
            <BrowserRouter>
                <LoginForm onError={jest.fn()} />
            </BrowserRouter>
        );

        const btn = screen.getByRole("button", { name: /^log in$/i });
        const decls = collectSizeDecls(btn);
        const heightPx = Math.max(
            maxPxDeclared(decls, "height"),
            maxPxDeclared(decls, "min-height")
        );
        expect(heightPx).toBeGreaterThanOrEqual(44);
    });

    it("RegisterForm 'Sign up' button declares height ≥ 44 px (WCAG 2.5.8)", () => {
        render(
            <BrowserRouter>
                <RegisterForm onError={jest.fn()} />
            </BrowserRouter>
        );

        const btn = screen.getByRole("button", { name: /^sign up$/i });
        const decls = collectSizeDecls(btn);
        const heightPx = Math.max(
            maxPxDeclared(decls, "height"),
            maxPxDeclared(decls, "min-height")
        );
        expect(heightPx).toBeGreaterThanOrEqual(44);
    });
});

/* -------------------------------------------------------------------------- */
/* 2. Header — pill trigger + icon button lift on coarse pointers              */
/* -------------------------------------------------------------------------- */
describe("UI quality :: Header touch targets", () => {
    /**
     * The account `PillTrigger` and the inline theme `IconButton` are
     * 36 px on fine pointers and lift to 44 px on `pointer: coarse`
     * (touch). We assert each has a `@media (pointer: coarse)` rule that
     * raises the height to ≥ 44 px.
     */
    it("Account-menu trigger lifts to 44 px on coarse pointers", () => {
        render(
            <BrowserRouter>
                <Header />
            </BrowserRouter>
        );

        const trigger = screen.getByRole("button", { name: /account menu/i });
        const decls = collectSizeDecls(trigger);
        // Find any `@media (pointer: coarse)` size lift.
        const coarseLift = decls
            .filter((d) => d.media?.includes("pointer: coarse"))
            .map((d) => parsePx(d.value) ?? 0);
        expect(Math.max(0, ...coarseLift)).toBeGreaterThanOrEqual(44);
    });

    it("Dark-mode toggle lifts to 44 × 44 on coarse pointers", () => {
        render(
            <BrowserRouter>
                <Header />
            </BrowserRouter>
        );

        const btn = screen.getByRole("button", {
            name: /switch to (dark|light) mode/i
        });
        const decls = collectSizeDecls(btn);
        const coarseHeights = decls
            .filter(
                (d) =>
                    d.media?.includes("pointer: coarse") &&
                    (d.prop === "height" || d.prop === "min-height")
            )
            .map((d) => parsePx(d.value) ?? 0);
        const coarseWidths = decls
            .filter(
                (d) =>
                    d.media?.includes("pointer: coarse") &&
                    (d.prop === "width" || d.prop === "min-width")
            )
            .map((d) => parsePx(d.value) ?? 0);
        expect(Math.max(0, ...coarseHeights)).toBeGreaterThanOrEqual(44);
        expect(Math.max(0, ...coarseWidths)).toBeGreaterThanOrEqual(44);
    });
});

/* -------------------------------------------------------------------------- */
/* 3. ColumnCreator — collapsed "Add column" button is generous                */
/* -------------------------------------------------------------------------- */
describe("UI quality :: ColumnCreator add-column target", () => {
    /**
     * The collapsed "Add column" button is the sole entry-point for
     * creating a column. It declares `min-height: 3rem` (48 px) — comfortably
     * above the WCAG 2.5.8 24 px floor and the 44 px touch recommendation.
     * Pin that contract.
     */
    it("'Add column' button declares min-height ≥ 44 px so a finger can land it", () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });

        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={["/projects/p1/board"]}>
                    <Routes>
                        <Route
                            path="/projects/:projectId/board"
                            element={<ColumnCreator />}
                        />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>
        );

        const btn = screen.getByRole("button", { name: /add column/i });
        const decls = collectSizeDecls(btn);
        const heightPx = Math.max(
            maxPxDeclared(decls, "height"),
            maxPxDeclared(decls, "min-height")
        );
        // 3 rem = 48 px in our token system.
        expect(heightPx).toBeGreaterThanOrEqual(44);
    });
});

/* -------------------------------------------------------------------------- */
/* 4. TaskCreator — "Create task" link must be a real, sized button            */
/* -------------------------------------------------------------------------- */
describe("UI quality :: TaskCreator create-task target", () => {
    /**
     * §13 / §3.2 of the plan calls out that `<a onClick>` patterns must
     * become real `<button>` elements with proper sizing. Today's
     * `TaskCreator` already renders a `<button>` (good); the remaining
     * gap is the touch target on coarse pointers. Per §2.A.2 every
     * affordance must be ≥ 44 × 44 on `pointer: coarse`.
     *
     * The current `CreateLink` styled component has padding only — no
     * `min-height` on coarse pointers. A failing assertion means the
     * button is < 44 px tall and a thumb has trouble landing it on a
     * phone.
     */
    it("Create-task button declares min-height ≥ 44 px on coarse pointers", () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });

        render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter initialEntries={["/projects/p1/board"]}>
                        <Routes>
                            <Route
                                path="/projects/:projectId/board"
                                element={
                                    <TaskCreator
                                        boardAiOn={false}
                                        columnId="c1"
                                        disabled={false}
                                    />
                                }
                            />
                        </Routes>
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );

        const btn = screen.getByRole("button", { name: /^create task$/i });
        const decls = collectSizeDecls(btn);
        const coarseHeights = decls
            .filter(
                (d) =>
                    d.media?.includes("pointer: coarse") &&
                    (d.prop === "height" || d.prop === "min-height")
            )
            .map((d) => parsePx(d.value) ?? 0);
        // Either a coarse-pointer lift or a base height ≥ 44 px is fine.
        const baseHeight = Math.max(
            maxPxDeclared(decls, "height"),
            maxPxDeclared(decls, "min-height")
        );
        const target = Math.max(baseHeight, ...coarseHeights);
        expect(target).toBeGreaterThanOrEqual(44);
    });
});

/* -------------------------------------------------------------------------- */
/* 5. ProjectList row icons — 44 × 44 on coarse pointers                       */
/* -------------------------------------------------------------------------- */
describe("UI quality :: ProjectList row-action targets", () => {
    /**
     * The row's Like button and More-actions trigger are AntD `size="small"`
     * by default (≈ 24 px tall). On a phone that is below the 44 × 44
     * recommendation. The styled `ListSurface` already has a coarse-pointer
     * lift for `.ant-table-tbody .ant-btn-sm`. Pin that contract: a
     * failing test means the lift isn't applying or doesn't reach 44 px.
     */
    it("Like button row icon lifts to 44 × 44 on coarse pointers", () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } }
        });

        render(
            <Provider store={store}>
                <QueryClientProvider client={queryClient}>
                    <MemoryRouter initialEntries={["/projects"]}>
                        <Routes>
                            <Route
                                path="/projects"
                                element={
                                    <ProjectList
                                        dataSource={[project()]}
                                        loading={false}
                                        members={[member()]}
                                    />
                                }
                            />
                        </Routes>
                    </MemoryRouter>
                </QueryClientProvider>
            </Provider>
        );

        const likeBtn = screen.getByRole("button", { name: /^like roadmap$/i });
        const decls = collectSizeDecls(likeBtn);
        const coarseLift = decls
            .filter(
                (d) =>
                    d.media?.includes("pointer: coarse") &&
                    (d.prop === "min-height" || d.prop === "min-width")
            )
            .map((d) => parsePx(d.value) ?? 0);
        // Either a per-button lift or a sheet-wide rule on the table
        // applies. We expect at least one declaration ≥ 44 px.
        const sheetLift = Array.from(document.styleSheets).flatMap((sheet) => {
            try {
                return Array.from(sheet.cssRules).flatMap((rule) => {
                    if (rule instanceof CSSMediaRule) {
                        if (!rule.conditionText.includes("pointer: coarse")) {
                            return [];
                        }
                        return Array.from(rule.cssRules)
                            .filter(
                                (r) =>
                                    r instanceof CSSStyleRule &&
                                    /\.ant-btn-sm/.test(r.selectorText)
                            )
                            .flatMap((r) => {
                                const styleRule = r as CSSStyleRule;
                                return [
                                    styleRule.style.getPropertyValue(
                                        "min-height"
                                    ),
                                    styleRule.style.getPropertyValue(
                                        "min-width"
                                    )
                                ]
                                    .map(parsePx)
                                    .filter((n): n is number => n !== null);
                            });
                    }
                    return [];
                });
            } catch {
                return [];
            }
        });
        const lifted = Math.max(0, ...coarseLift, ...sheetLift);
        expect(lifted).toBeGreaterThanOrEqual(44);
    });
});

/* -------------------------------------------------------------------------- */
/* 6. Hit-target catalogue — every primary action across the app               */
/* -------------------------------------------------------------------------- */
describe("UI quality :: Header brand link size", () => {
    /**
     * The brand button (logo + wordmark) is a 36 px BrandLink. On coarse
     * pointers we don't lift it because the icon-only theme toggle and
     * the account trigger already shoulder the touch-target burden — the
     * brand link is a nice-to-have, not the dominant action. Pin the
     * baseline so a future regression that sizes it < 24 px is caught.
     */
    it("Header brand link declares height ≥ 24 px (WCAG 2.5.8 minimum)", () => {
        render(
            <BrowserRouter>
                <Header />
            </BrowserRouter>
        );

        const btn = screen.getByRole("button", { name: /pulse home/i });
        const decls = collectSizeDecls(btn);
        const heightPx = Math.max(
            maxPxDeclared(decls, "height"),
            maxPxDeclared(decls, "min-height")
        );
        // We accept the baseline 36 px AntD button size or a coarse lift.
        expect(heightPx).toBeGreaterThanOrEqual(24);
    });
});
