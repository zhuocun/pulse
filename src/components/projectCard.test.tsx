import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { MemoryRouter } from "react-router-dom";

import { declaresTouchTarget } from "./ui/testHelpers";
import useIsPhoneChrome from "../utils/hooks/useIsPhoneChrome";
import useReducedMotion from "../utils/hooks/useReducedMotion";

import ProjectCard from "./projectCard";

/*
 * Radix `DropdownMenu` drives its trigger with pointer-capture APIs jsdom
 * doesn't ship; polyfill them so the row-actions menu can open under
 * `userEvent`.
 */
const installBrowserMocks = () => {
    Element.prototype.scrollIntoView = jest.fn();
    Element.prototype.hasPointerCapture = jest.fn(() => false);
    Element.prototype.releasePointerCapture = jest.fn();
};

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
    beforeAll(installBrowserMocks);

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

    // Each menu entry renders as a single AT-readable `role="menuitem"`
    // element (Radix `DropdownMenuItem`). Opening the overflow menu and
    // clicking an item fires its wired `onSelect` — no double-announce or
    // stopPropagation gymnastics inside the label.
    it("invokes onEdit from the row actions menu on click", async () => {
        const user = userEvent.setup();
        const { onEdit } = renderCard();

        await user.click(
            screen.getByRole("button", {
                name: /more actions for roadmap/i
            })
        );

        await user.click(
            await screen.findByRole("menuitem", { name: /^edit$/i })
        );

        expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it("invokes onDelete from the row actions menu on click", async () => {
        const user = userEvent.setup();
        const { onDelete } = renderCard();

        await user.click(
            screen.getByRole("button", {
                name: /more actions for roadmap/i
            })
        );

        await user.click(
            await screen.findByRole("menuitem", { name: /^delete$/i })
        );

        expect(onDelete).toHaveBeenCalledTimes(1);
    });

    // Keyboard activation: opening the menu and pressing Enter on a
    // focused menuitem fires the wired handler. Radix routes activation
    // through the menuitem's `onSelect` directly.
    it("invokes onEdit when Enter is pressed on the menuitem", async () => {
        const user = userEvent.setup();
        const { onEdit } = renderCard();

        await user.click(
            screen.getByRole("button", {
                name: /more actions for roadmap/i
            })
        );
        const editItem = await screen.findByRole("menuitem", {
            name: /^edit$/i
        });
        act(() => editItem.focus());
        await user.keyboard("{Enter}");

        expect(onEdit).toHaveBeenCalledTimes(1);
    });

    // WCAG 2.5.8 (Target Size, Minimum): the card's row-action cluster
    // ("like" + "more actions") are `ui/Button` primitives, which thread the
    // canonical `coarse:min-h-[44px]` touch-target token so a thumb can land
    // them on touch. Assert the token is present on both controls — a
    // refactor that drops it must fail CI.
    it("declares a touch-target height of at least 44 px (WCAG 2.5.8)", () => {
        renderCard();
        const likeButton = screen.getByRole("button", {
            name: /like roadmap/i
        });
        const moreButton = screen.getByRole("button", {
            name: /more actions for roadmap/i
        });
        expect(declaresTouchTarget(likeButton)).toBe(true);
        expect(declaresTouchTarget(moreButton)).toBe(true);
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

    it("truncates a long organization and preserves its full value", () => {
        const organization =
            "international-enterprise-platform-reliability-and-compliance".repeat(
                3
            );
        renderCard({
            project: { ...sampleProject, organization }
        });

        const organizationLabel = screen.getByTestId("project-organization");
        expect(organizationLabel).toHaveClass(
            "block",
            "max-w-full",
            "min-w-0",
            "truncate"
        );
        expect(organizationLabel).toHaveAttribute("title", organization);
    });

    it("keeps the no-organization fallback without an empty tooltip", () => {
        renderCard({
            project: { ...sampleProject, organization: "" }
        });

        const organizationLabel = screen.getByTestId("project-organization");
        expect(organizationLabel).toHaveTextContent("No organization");
        expect(organizationLabel).not.toHaveAttribute("title");
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
    beforeAll(installBrowserMocks);

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

        await user.click(
            screen.getByRole("button", {
                name: /more actions for roadmap/i
            })
        );
        await user.click(
            await screen.findByRole("menuitem", { name: /^delete$/i })
        );
        expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it("has no axe violations in the phone-swipe render", async () => {
        const { container } = renderPhoneCard();
        const results = await axe(container);
        expect(results).toHaveNoViolations();
    });
});
