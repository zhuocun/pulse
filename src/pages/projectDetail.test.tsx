import { render, screen, within } from "@testing-library/react";
import { Navigate } from "react-router";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import ProjectDetailPage from "./projectDetail";

let mockProjectName = "Atlas";

jest.mock("../utils/hooks/useReactQuery", () => ({
    __esModule: true,
    default: () => ({
        data: { _id: "project-1", projectName: mockProjectName }
    })
}));

const LocationProbe = () => {
    const location = useLocation();

    return <div data-testid="location">{location.pathname}</div>;
};

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

/*
 * Mirrors the production route shape (`src/routes/index.tsx`): a declarative
 * `index` redirect under `projects/:projectId` sends bare detail URLs to the
 * board child. The previous `useEffect` force-redirect inside the page was
 * removed alongside the single-tab Tabs row in QW-11.
 */
const renderDetail = (route: string) =>
    render(
        <MemoryRouter initialEntries={[route]}>
            <Routes>
                <Route
                    path="/projects/:projectId"
                    element={<ProjectDetailPage />}
                >
                    <Route index element={<Navigate to="board" replace />} />
                    <Route path="board" element={<div>Board outlet</div>} />
                    <Route path="labels" element={<div>Labels outlet</div>} />
                    <Route path="members" element={<div>Members outlet</div>} />
                    <Route path="reports" element={<div>Reports outlet</div>} />
                </Route>
                <Route path="*" element={<LocationProbe />} />
            </Routes>
            <LocationProbe />
        </MemoryRouter>
    );

describe("ProjectDetailPage", () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeAll(() => {
        consoleErrorSpy = silenceExpectedConsoleErrors([
            ["An update to", "ForwardRef", "not wrapped in act"]
        ]);
    });

    beforeEach(() => {
        mockProjectName = "Atlas";
    });

    afterAll(() => {
        consoleErrorSpy.mockRestore();
    });

    it("redirects a project detail route to the board child via the index redirect", () => {
        renderDetail("/projects/project-1");

        expect(screen.getByTestId("location")).toHaveTextContent(
            "/projects/project-1/board"
        );
        expect(screen.getByText("Board outlet")).toBeInTheDocument();
    });

    it("renders breadcrumb, current project, and the outlet content", () => {
        renderDetail("/projects/project-1/board");

        const crumb = screen.getByTestId("project-breadcrumb");
        expect(crumb).toBeTruthy();
        expect(
            within(crumb).getByRole("link", { name: "Projects" })
        ).toHaveAttribute("href", "/projects");
        expect(screen.getByText("Atlas")).toBeInTheDocument();
        expect(screen.getByText("Board outlet")).toBeInTheDocument();
    });

    it("no longer renders a Tabs row inside the project detail chrome", () => {
        renderDetail("/projects/project-1/board");

        expect(screen.queryByRole("tablist")).toBeNull();
    });

    /*
     * Phase 5 "Liquid Glass" Wave 2 T3 — Liquid chrome recipe upgrade.
     * The project-detail TopBar (secondary sticky chrome below the main
     * Header) gains:
     *   1. Specular rim (::before / ::after gradient layers).
     *   2. Scroll-edge dissolve via mask-image on ::after (matches the
     *      header recipe — both sticky bands sit over scrolling content).
     *   3. Gel-flex micro-press on ChildNavLink breadcrumb tabs.
     *   4. data-glass-context="true" marker.
     */
    describe("Liquid Glass chrome recipe (Wave 2 T3)", () => {
        it('marks the TopBar root with data-glass-context="true"', () => {
            renderDetail("/projects/project-1/board");
            const top = screen.getByTestId("project-detail-chrome");
            expect(top.getAttribute("data-glass-context")).toBe("true");
        });

        it("emits a ::before specular-rim layer with --glass-specular-top", () => {
            renderDetail("/projects/project-1/board");
            const top = screen.getByTestId("project-detail-chrome");
            expect(top.className).toContain(
                "before:bg-[image:var(--glass-specular-top)]"
            );
        });

        it("emits a ::after companion + scroll-edge dissolve layer", () => {
            renderDetail("/projects/project-1/board");
            const top = screen.getByTestId("project-detail-chrome");
            expect(top.className).toContain(
                "after:bg-[image:var(--glass-specular-bottom)]"
            );
            // 12 px scroll-edge mask, same shape the main Header ships
            expect(top.className).toContain(
                "[mask-image:linear-gradient(to_bottom,black_calc(100%-12px),transparent_100%)]"
            );
        });

        it("applies gel-flex transform recipe to ChildNavLink", () => {
            renderDetail("/projects/project-1/board");
            const board = screen.getByRole("link", { name: "Board" });
            expect(board.className).toContain("var(--motion-gel-flex");
            expect(board.className).toContain("active:scale-[0.97]");
        });

        it("declares coarse-pointer touch targets for breadcrumb and child-nav links", () => {
            renderDetail("/projects/project-1/board");
            const board = screen.getByRole("link", { name: "Board" });
            const breadcrumbWrapper = screen.getByTestId("project-breadcrumb");

            expect(breadcrumbWrapper.className).toContain(
                "coarse:[&_a]:min-h-[44px]"
            );
            expect(board.className).toContain("coarse:min-h-[44px]");
        });

        it("pins the Projects root crumb and ellipsizes the project name when space is tight", () => {
            mockProjectName =
                "Design system launch with a long-but-readable project name that should truncate";
            renderDetail("/projects/project-1/labels");
            const breadcrumbWrapper = screen.getByTestId("project-breadcrumb");

            // Root crumb ("Projects") never shrinks.
            expect(breadcrumbWrapper.className).toContain(
                "[&_li:first-of-type_a]:flex-shrink-0"
            );
            // The middle (project-name) anchor stays a clipped inline-flex
            // box (touch target + clipping)…
            expect(breadcrumbWrapper.className).toContain(
                "[&_li[data-breadcrumb=middle]_a]:inline-flex"
            );
            expect(breadcrumbWrapper.className).toContain(
                "[&_li[data-breadcrumb=middle]_a]:max-w-full"
            );
            expect(breadcrumbWrapper.className).toContain(
                "[&_li[data-breadcrumb=middle]_a]:min-w-0"
            );
            expect(breadcrumbWrapper.className).toContain(
                "[&_li[data-breadcrumb=middle]_a]:overflow-hidden"
            );
            // …while the ellipsis lives on the inner span, because
            // text-overflow cannot ellipsize a flex container's contents.
            expect(breadcrumbWrapper.className).toContain(
                "[&_li[data-breadcrumb=middle]_a>span]:text-ellipsis"
            );
            // The project-name link wraps its text in the inner span the
            // ellipsis rule targets.
            const projectLink = screen.getByRole("link", {
                name: mockProjectName
            });
            expect(projectLink.querySelector("span")).not.toBeNull();
        });

        it("respects prefers-reduced-motion and prefers-reduced-transparency", () => {
            renderDetail("/projects/project-1/board");
            const top = screen.getByTestId("project-detail-chrome");
            const board = screen.getByRole("link", { name: "Board" });
            expect(top.className).toContain(
                "[@media(prefers-reduced-transparency:reduce)]:[backdrop-filter:none]"
            );
            expect(board.className).toContain(
                "motion-reduce:[transition:none]"
            );
        });
    });

    describe("phone chrome section navigation", () => {
        const desktopMatchMedia = window.matchMedia;

        beforeAll(() => {
            Element.prototype.scrollIntoView = jest.fn();
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
        });

        afterAll(() => {
            Object.defineProperty(window, "matchMedia", {
                writable: true,
                value: desktopMatchMedia
            });
        });

        it("renders the child nav as a horizontally scrollable row on phone chrome", () => {
            renderDetail("/projects/project-1/labels");

            const nav = screen.getByTestId("project-detail-child-nav");
            for (const name of [
                "Board",
                "Members",
                "Milestones",
                "Labels",
                "Reports"
            ]) {
                expect(within(nav).getByRole("link", { name })).toHaveAttribute(
                    "href",
                    expect.stringContaining("/projects/project-1/")
                );
            }

            expect(nav.className).toContain("overflow-x-auto");
            expect(nav.className).toContain("flex-[1_1_100%]");
            expect(nav.className).toContain("pe-xxs");
        });

        it("keeps nav links pan-friendly: fixed-size segments that never wrap", () => {
            renderDetail("/projects/project-1/labels");

            const board = screen.getByRole("link", { name: "Board" });
            expect(board.className).toContain("flex-[0_0_auto]");
            expect(board.className).toContain("whitespace-nowrap");
        });

        it("scrolls the active Reports link fully into the nearest view", () => {
            const scrollIntoView = jest.fn();
            Element.prototype.scrollIntoView = scrollIntoView;

            renderDetail("/projects/project-1/reports");

            expect(scrollIntoView).toHaveBeenCalledTimes(1);
            expect(scrollIntoView).toHaveBeenCalledWith({
                block: "nearest",
                inline: "nearest"
            });
            expect(
                screen.getByRole("link", { name: "Reports" })
            ).toHaveAttribute("aria-current", "page");
        });

        it("corrects a subpixel Reports overhang after the nearest scroll", () => {
            const rect = (left: number, right: number) =>
                ({
                    bottom: 44,
                    height: 44,
                    left,
                    right,
                    top: 0,
                    width: right - left,
                    x: left,
                    y: 0,
                    toJSON: () => ({})
                }) as DOMRect;
            const bounds = jest
                .spyOn(Element.prototype, "getBoundingClientRect")
                .mockImplementation(function (this: Element) {
                    if (
                        this instanceof HTMLElement &&
                        this.dataset.testid === "project-detail-child-nav"
                    ) {
                        return rect(12, 378);
                    }
                    if (
                        this instanceof HTMLAnchorElement &&
                        this.textContent === "Reports"
                    ) {
                        return rect(305.015625, 378.078125);
                    }
                    return rect(0, 0);
                });

            renderDetail("/projects/project-1/reports");

            expect(
                screen.getByTestId("project-detail-child-nav").scrollLeft
            ).toBe(1);
            bounds.mockRestore();
        });

        it("still hides the whole chrome on the phone board route", () => {
            renderDetail("/projects/project-1/board");

            expect(
                screen.queryByTestId("project-detail-chrome")
            ).not.toBeInTheDocument();
        });
    });
});
