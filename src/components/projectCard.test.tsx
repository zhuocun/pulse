import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

import useIsPhoneChrome from "../utils/hooks/useIsPhoneChrome";
import useReducedMotion from "../utils/hooks/useReducedMotion";

import ProjectCard from "./projectCard";

/*
 * The card warms the board queries on hover/focus via
 * `usePrefetchProject`, which calls `useQueryClient()`. Wrap every render
 * in a real `QueryClientProvider` so that hook resolves; retries are off
 * so a prefetch's mock fetch failure can't dangle a timer past the test.
 */
const makeQueryClient = () =>
    new QueryClient({
        defaultOptions: { queries: { retry: false } }
    });

expect.extend(toHaveNoViolations);

/*
 * The card wraps its body in `SwipeableRow`, which reads the phone-chrome /
 * reduced-motion predicates through these two hooks (not `matchMedia`). Mock
 * them directly — the same pattern the `swipeableRow` suite uses. The
 * default in `beforeEach` is the DESKTOP branch (non-phone, motion on), so
 * `SwipeableRow` is a no-listener passthrough and every pre-existing
 * assertion in this file sees the card exactly as before; the phone-swipe
 * block opts into the coarse branch explicitly.
 */
jest.mock("../utils/hooks/useIsPhoneChrome");
jest.mock("../utils/hooks/useReducedMotion");

const mockedUseIsPhoneChrome = useIsPhoneChrome as jest.MockedFunction<
    typeof useIsPhoneChrome
>;
const mockedUseReducedMotion = useReducedMotion as jest.MockedFunction<
    typeof useReducedMotion
>;

beforeEach(() => {
    jest.clearAllMocks();
    mockedUseIsPhoneChrome.mockReturnValue(false);
    mockedUseReducedMotion.mockReturnValue(false);
});

/**
 * Pin a real row width on the swipe viewport — jsdom reports 0 (no layout),
 * which the primitive falls back off of, but a fixed width makes the
 * distance-threshold math deterministic (320 * 0.4 = 128 px commit point).
 * Mirrors `stubRowWidth` in the swipeableRow suite.
 */
const stubRowWidth = (node: HTMLElement, width = 320): void => {
    node.getBoundingClientRect = jest.fn(
        () =>
            ({
                width,
                height: 100,
                top: 0,
                left: 0,
                right: width,
                bottom: 100,
                x: 0,
                y: 0,
                toJSON: () => ({})
            }) as DOMRect
    );
};

type DropdownMenuItem = {
    key?: string | number;
    label?: ReactNode;
    onClick?: () => void;
    danger?: boolean;
};

type DropdownMockProps = {
    children: ReactNode;
    menu?: {
        items?: DropdownMenuItem[];
    };
};

/**
 * Lightweight Dropdown mock. The real AntD Dropdown attaches menu
 * items as `role="menuitem"` elements that invoke their `onClick` on
 * both pointer and keyboard activation; this mock mirrors the
 * minimum surface area the tests need:
 *
 *  - Render the trigger (children) untouched.
 *  - Render each `items[]` entry as a `role="menuitem"` button so the
 *    tests can assert keyboard activation (Enter / Space on a
 *    menuitem fires the wired `onClick`, exactly what the production
 *    Dropdown does at the rc-menu layer).
 *  - Wire the per-item `onClick` to the menuitem's `click` handler
 *    rather than calling the production AntD `MenuInfo` callback —
 *    the production handler only needs to fire on activation.
 *
 * Lets the suite assert the QW-rewire contract: each menuitem is a
 * single AT-readable element (no nested `<button>` wrapper anymore)
 * with its own activation handler, and Enter on the menuitem invokes
 * the wired callback.
 */
jest.mock("antd", () => {
    const actual = jest.requireActual("antd");
    const React = jest.requireActual("react");

    return {
        ...actual,
        Dropdown: ({ children, menu }: DropdownMockProps) =>
            React.createElement(
                "div",
                { "data-testid": "project-card-actions-dropdown" },
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
                                role: "menuitem",
                                type: "button"
                            },
                            item.label
                        )
                    )
                )
            )
    };
});

const manager: IMember = {
    _id: "member-1",
    email: "alice@example.com",
    username: "Alice"
};

const sampleProject: IProject = {
    _id: "project-1",
    createdAt: "2026-04-25T00:00:00.000Z",
    managerId: "member-1",
    organization: "Product",
    projectName: "Roadmap"
};

describe("ProjectCard", () => {
    const renderCard = (
        props?: Partial<React.ComponentProps<typeof ProjectCard>>
    ) => {
        const onLike = jest.fn();
        const onEdit = jest.fn();
        const onDelete = jest.fn();
        const merged = {
            liked: false,
            manager,
            onDelete,
            onEdit,
            onLike,
            project: sampleProject,
            ...props
        };
        render(
            <QueryClientProvider client={makeQueryClient()}>
                <MemoryRouter>
                    <ProjectCard {...merged} />
                </MemoryRouter>
            </QueryClientProvider>
        );
        return { onDelete, onEdit, onLike };
    };

    it("invokes onLike when the heart control is clicked", async () => {
        const user = userEvent.setup();
        const { onLike } = renderCard();

        await user.click(screen.getByRole("button", { name: /like roadmap/i }));

        expect(onLike).toHaveBeenCalledTimes(1);
    });

    // Each menu entry now renders as a single AT-readable element
    // (`role="menuitem"`) with no nested `<button>` wrapper. Clicking
    // the menuitem fires the wired `onClick` directly — no more
    // double-announce ("Edit · Edit roadmap") or stopPropagation
    // gymnastics inside the label.
    it("invokes onEdit from the row actions menu on click", async () => {
        const user = userEvent.setup();
        const { onEdit } = renderCard();

        const dropdown = screen.getByTestId("project-card-actions-dropdown");
        await user.click(
            within(dropdown).getByRole("button", {
                name: /more actions for roadmap/i
            })
        );

        await user.click(
            within(dropdown).getByRole("menuitem", { name: /^edit$/i })
        );

        expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it("invokes onDelete from the row actions menu on click", async () => {
        const user = userEvent.setup();
        const { onDelete } = renderCard();

        const dropdown = screen.getByTestId("project-card-actions-dropdown");
        await user.click(
            within(dropdown).getByRole("button", {
                name: /more actions for roadmap/i
            })
        );

        await user.click(
            within(dropdown).getByRole("menuitem", { name: /^delete$/i })
        );

        expect(onDelete).toHaveBeenCalledTimes(1);
    });

    // Keyboard activation: tabbing to a menuitem and pressing Enter
    // must fire the wired handler. The new structure routes activation
    // through the menuitem directly (no inner button to swallow the
    // event), so Enter triggers `onEdit` without the previously needed
    // `e.stopPropagation()` workaround.
    it("invokes onEdit when Enter is pressed on the menuitem", async () => {
        const user = userEvent.setup();
        const { onEdit } = renderCard();

        const editItem = within(
            screen.getByTestId("project-card-actions-dropdown")
        ).getByRole("menuitem", { name: /^edit$/i });

        editItem.focus();
        await user.keyboard("{Enter}");

        expect(onEdit).toHaveBeenCalledTimes(1);
    });

    // WCAG 2.5.8 (Target Size, Minimum) requires interactive targets be at
    // least 24×24 CSS px, with AAA at 44×44. The card's row-action cluster
    // ("like" + "more actions") wraps AntD's inline `size="small"` icon
    // buttons, which collapse to ~24 px by default — below the AAA target.
    // The styled `ActionsCluster` lifts each `.ant-btn-sm` descendant to
    // `min-height: 44px` / `min-width: 44px` under `@media (pointer: coarse)`
    // so a thumb can land it. Walk the rendered stylesheet (same approach as
    // `src/layouts/authLayout.test.tsx` for `AuthButton`) and assert the 44 px
    // declaration is still emitted — a future style refactor that drops it
    // below 44 must fail CI.
    it("declares a touch-target height of at least 44 px (WCAG 2.5.8)", () => {
        renderCard();
        // The styled `ActionsCluster` wraps both row-action buttons; grab it
        // via the like control and walk up the ancestor chain looking for
        // the nearest element that carries a bare `css-xxx` emotion class
        // (skipping AntD's `css-var-root` / `css-dev-only-...` markers,
        // which sit on every AntD descendant under its ConfigProvider).
        const likeButton = screen.getByRole("button", {
            name: /like roadmap/i
        });
        const isEmotionToken = (tok: string) =>
            /^css-[a-z0-9]{4,}$/i.test(tok) &&
            !tok.startsWith("css-var-") &&
            !tok.startsWith("css-dev-only-");
        let cluster: HTMLElement | null = likeButton;
        let styledCls: string | undefined;
        while (cluster) {
            styledCls = cluster.className
                ?.toString()
                .split(/\s+/)
                .find(isEmotionToken);
            if (styledCls) break;
            cluster = cluster.parentElement;
        }
        expect(styledCls).toBeTruthy();

        // Walk every stylesheet's rules — including nested rules inside
        // `@media (pointer: coarse)` where the touch-target lift lives —
        // and collect any `(min-)?height: <N>px` declaration on a rule
        // that mentions the styled class. The descendant selector
        // `.css-xxx .ant-btn-sm` keeps the same class token in the
        // selector text, so the same anchor works.
        const heights: number[] = [];
        const visit = (rule: CSSRule) => {
            if (rule instanceof CSSStyleRule) {
                if (!styledCls || !rule.selectorText.includes(styledCls))
                    return;
                const re = /(?:^|[\s;{])(?:min-)?height:\s*(\d+(?:\.\d+)?)px/gi;
                let m: RegExpExecArray | null = re.exec(rule.cssText);
                while (m !== null) {
                    heights.push(parseFloat(m[1] ?? "0"));
                    m = re.exec(rule.cssText);
                }
            } else if ("cssRules" in rule) {
                for (const child of Array.from(
                    (rule as CSSGroupingRule).cssRules
                )) {
                    visit(child);
                }
            }
        };
        Array.from(document.styleSheets).forEach((sheet) => {
            let rules: CSSRuleList;
            try {
                rules = sheet.cssRules;
            } catch {
                return;
            }
            for (const rule of Array.from(rules)) visit(rule);
        });

        expect(heights).toContain(44);
    });

    // Prefetch-on-hover (ui-todo §2.A.7 / §9). Hovering / focusing the card
    // warms the exact queries the board route consumes — project, board
    // columns, and tasks — so the board paints from cache on click. The
    // guard fires at most once per project id per hover session.
    it("prefetches the board queries on hover and focus, at most once", async () => {
        const user = userEvent.setup();
        const client = makeQueryClient();
        const prefetchSpy = jest
            .spyOn(client, "prefetchQuery")
            .mockResolvedValue(undefined);

        render(
            <QueryClientProvider client={client}>
                <MemoryRouter>
                    <ProjectCard
                        liked={false}
                        manager={manager}
                        onDelete={jest.fn()}
                        onEdit={jest.fn()}
                        onLike={jest.fn()}
                        project={sampleProject}
                    />
                </MemoryRouter>
            </QueryClientProvider>
        );

        const card = screen
            .getByRole("link", { name: /^roadmap$/i })
            .closest("article") as HTMLElement;

        await user.hover(card);

        // One prefetch per board-route query key, all carrying the project id.
        const prefetchedKeys = prefetchSpy.mock.calls.map(
            (call) => (call[0] as { queryKey: unknown[] }).queryKey
        );
        expect(prefetchedKeys).toEqual(
            expect.arrayContaining([
                ["projects", { projectId: "project-1" }],
                ["boards", { projectId: "project-1" }],
                ["tasks", { projectId: "project-1" }]
            ])
        );
        const callsAfterFirstHover = prefetchSpy.mock.calls.length;
        expect(callsAfterFirstHover).toBe(3);

        // Re-hover + focus the same card: the once-per-id guard suppresses
        // any further prefetch so a stream of pointer events can't spam the
        // network.
        await user.unhover(card);
        await user.hover(card);
        act(() => card.focus());
        expect(prefetchSpy.mock.calls.length).toBe(callsAfterFirstHover);

        prefetchSpy.mockRestore();
    });

    it("keeps the project title as the primary link target", async () => {
        const user = userEvent.setup();
        renderCard();

        const link = screen.getByRole("link", { name: /^roadmap$/i });
        expect(link).toHaveAttribute("href", "/projects/project-1");

        await user.click(link);
    });

    // Desktop (default mock branch): SwipeableRow is a no-listener
    // passthrough, so a leftward drag over its testid node must NOT fire the
    // delete path — the only delete affordance on desktop is the overflow
    // menu (asserted above). Guards against the wrap accidentally arming the
    // gesture on a fine pointer.
    it("does not commit a swipe-delete on desktop (passthrough)", () => {
        const { onDelete, onLike } = renderCard();
        const swipe = screen.getByTestId("project-card-swipe");
        stubRowWidth(swipe);

        act(() => {
            fireEvent.touchStart(swipe, {
                touches: [{ clientX: 300, clientY: 50 }]
            });
        });
        act(() => {
            fireEvent.touchMove(swipe, {
                touches: [{ clientX: 20, clientY: 50 }]
            });
        });
        act(() => {
            fireEvent.touchEnd(swipe);
        });

        expect(onDelete).not.toHaveBeenCalled();
        expect(onLike).not.toHaveBeenCalled();
    });
});

/* -- Phone swipe-to-action ---------------------------------------------- */

describe("ProjectCard — phone swipe-to-action", () => {
    const renderPhoneCard = (
        props?: Partial<React.ComponentProps<typeof ProjectCard>>
    ): {
        onDelete: jest.Mock;
        onEdit: jest.Mock;
        onLike: jest.Mock;
        swipe: HTMLElement;
        container: HTMLElement;
    } => {
        mockedUseIsPhoneChrome.mockReturnValue(true);
        mockedUseReducedMotion.mockReturnValue(false);
        const onLike = jest.fn();
        const onEdit = jest.fn();
        const onDelete = jest.fn();
        const merged = {
            liked: false,
            manager,
            onDelete,
            onEdit,
            onLike,
            project: sampleProject,
            ...props
        };
        const { container } = render(
            <QueryClientProvider client={makeQueryClient()}>
                <MemoryRouter>
                    <ProjectCard {...merged} />
                </MemoryRouter>
            </QueryClientProvider>
        );
        const swipe = screen.getByTestId("project-card-swipe");
        stubRowWidth(swipe);
        return { onDelete, onEdit, onLike, swipe, container };
    };

    it("commits delete on a leftward (trailing) swipe past the threshold", () => {
        const { onDelete, onLike } = renderPhoneCard();
        const swipe = screen.getByTestId("project-card-swipe");

        // 300 → 20 = -280 px leftward, past 320 * 0.4 = 128 → commit trailing
        // (delete). Velocity stays 0 under synthetic events, so the distance
        // path decides.
        act(() => {
            fireEvent.touchStart(swipe, {
                touches: [{ clientX: 300, clientY: 50 }]
            });
        });
        act(() => {
            fireEvent.touchMove(swipe, {
                touches: [{ clientX: 20, clientY: 50 }]
            });
        });
        act(() => {
            fireEvent.touchEnd(swipe);
        });

        expect(onDelete).toHaveBeenCalledTimes(1);
        expect(onLike).not.toHaveBeenCalled();
    });

    it("commits favorite on a rightward (leading) swipe past the threshold", () => {
        const { onDelete, onLike } = renderPhoneCard();
        const swipe = screen.getByTestId("project-card-swipe");

        // 20 → 300 = +280 px rightward, past 128 → commit leading (favorite).
        act(() => {
            fireEvent.touchStart(swipe, {
                touches: [{ clientX: 20, clientY: 50 }]
            });
        });
        act(() => {
            fireEvent.touchMove(swipe, {
                touches: [{ clientX: 300, clientY: 50 }]
            });
        });
        act(() => {
            fireEvent.touchEnd(swipe);
        });

        expect(onLike).toHaveBeenCalledTimes(1);
        expect(onDelete).not.toHaveBeenCalled();
    });

    it("reveals the trailing Delete pane and leading Favorite pane", () => {
        renderPhoneCard();
        const trailing = screen.getByTestId("project-card-swipe-trailing");
        const leading = screen.getByTestId("project-card-swipe-leading");
        expect(trailing).toHaveAttribute("aria-hidden", "true");
        expect(trailing).toHaveTextContent(/delete/i);
        expect(leading).toHaveAttribute("aria-hidden", "true");
        expect(leading).toHaveTextContent(/favorite/i);
    });

    it("labels the leading pane 'Unfavorite' when already liked", () => {
        renderPhoneCard({ liked: true });
        const leading = screen.getByTestId("project-card-swipe-leading");
        expect(leading).toHaveTextContent(/unfavorite/i);
    });

    // Even on phone, the overflow-menu Delete and the heart Like button stay
    // present and functional — the gesture only DUPLICATES them, it does not
    // replace them (and is the sole non-gesture path for reduced-motion).
    it("keeps the overflow-menu delete and heart toggle working on phone", async () => {
        const user = userEvent.setup();
        const { onDelete, onLike } = renderPhoneCard();

        await user.click(screen.getByRole("button", { name: /like roadmap/i }));
        expect(onLike).toHaveBeenCalledTimes(1);

        const dropdown = screen.getByTestId("project-card-actions-dropdown");
        await user.click(
            within(dropdown).getByRole("menuitem", { name: /^delete$/i })
        );
        expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it("has no axe violations in the phone-swipe render", async () => {
        const { container } = renderPhoneCard();
        /*
         * `aria-required-parent` is disabled: the file's lightweight
         * Dropdown mock renders bare `role="menuitem"` buttons without the
         * `role="menu"` parent the real AntD Dropdown supplies (it portals a
         * proper menu), so the violation is a fixture artifact, not a defect
         * in the swipe render under test. Every other rule (incl. the swipe
         * panes' `aria-hidden`) is enforced.
         */
        const results = await axe(container, {
            rules: { "aria-required-parent": { enabled: false } }
        });
        expect(results).toHaveNoViolations();
    });
});
