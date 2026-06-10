import { render, screen, within } from "@testing-library/react";
import { Navigate } from "react-router";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { ruleTextsFor, styledClassFor } from "../testUtils/styleRules";

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
        const { container } = renderDetail("/projects/project-1/board");

        const crumb = container.querySelector(".ant-breadcrumb");
        expect(crumb).toBeTruthy();
        expect(
            within(crumb as HTMLElement).getByRole("link", { name: "Projects" })
        ).toHaveAttribute("href", "/projects");
        expect(screen.getByText("Atlas")).toBeInTheDocument();
        expect(screen.getByText("Board outlet")).toBeInTheDocument();
    });

    it("no longer renders a Tabs row inside the project detail chrome", () => {
        const { container } = renderDetail("/projects/project-1/board");

        expect(container.querySelector(".ant-tabs")).toBeNull();
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
        const sheetText = () =>
            Array.from(document.styleSheets)
                .map((sheet) => {
                    let rules: CSSRuleList;
                    try {
                        rules = sheet.cssRules;
                    } catch {
                        return "";
                    }
                    return Array.from(rules)
                        .map((rule) => rule.cssText)
                        .join("\n");
                })
                .join("\n");

        it('marks the TopBar root with data-glass-context="true"', () => {
            renderDetail("/projects/project-1/board");
            const top = screen.getByTestId("project-detail-chrome");
            expect(top.getAttribute("data-glass-context")).toBe("true");
        });

        it("emits a ::before specular-rim layer with --glass-specular-top", () => {
            renderDetail("/projects/project-1/board");
            const css = sheetText();
            expect(css).toMatch(
                /::before[^}]*background:\s*var\(--glass-specular-top\)/
            );
        });

        it("emits a ::after companion + scroll-edge dissolve layer", () => {
            renderDetail("/projects/project-1/board");
            const css = sheetText();
            expect(css).toMatch(
                /::after[^}]*background:\s*var\(--glass-specular-bottom\)/
            );
            // 12 px scroll-edge mask, same shape the main Header ships
            expect(css).toMatch(
                /mask-image:\s*linear-gradient\([^)]*calc\(100% - 12px\)/
            );
        });

        it("applies gel-flex transform recipe to ChildNavLink", () => {
            renderDetail("/projects/project-1/board");
            const css = sheetText();
            expect(css).toMatch(/transform[^;]*var\(--motion-gel-flex/);
            expect(css).toMatch(/:active[^}]*transform:\s*scale\(0\.97\)/);
        });

        it("declares coarse-pointer touch targets for breadcrumb and child-nav links", () => {
            renderDetail("/projects/project-1/board");
            const board = screen.getByRole("link", { name: "Board" });
            const breadcrumbWrapper = screen
                .getByTestId("project-detail-chrome")
                .querySelector(".ant-breadcrumb")?.parentElement;
            expect(breadcrumbWrapper).not.toBeNull();

            const breadcrumbRuleText = ruleTextsFor(
                styledClassFor(breadcrumbWrapper as Element) ?? ""
            ).join("\n");
            const childRuleText = ruleTextsFor(
                styledClassFor(board) ?? ""
            ).join("\n");

            expect(breadcrumbRuleText).toContain("min-height: 44px");
            expect(childRuleText).toContain("min-height: 44px");
        });

        it("pins the Projects root crumb and ellipsizes the project name when space is tight", () => {
            mockProjectName =
                "Design system launch with a long-but-readable project name that should truncate";
            renderDetail("/projects/project-1/labels");
            const breadcrumbWrapper = screen
                .getByTestId("project-detail-chrome")
                .querySelector(".ant-breadcrumb")?.parentElement;
            expect(breadcrumbWrapper).not.toBeNull();

            const breadcrumbRuleText = ruleTextsFor(
                styledClassFor(breadcrumbWrapper as Element) ?? ""
            ).join("\n");
            const rootCrumbRule = Array.from(document.styleSheets)
                .flatMap((sheet) => Array.from(sheet.cssRules))
                .filter((rule): rule is CSSStyleRule => "selectorText" in rule)
                .find((rule) =>
                    rule.selectorText.includes(
                        ".ant-breadcrumb li:first-child a"
                    )
                );
            const middleCrumbRule = Array.from(document.styleSheets)
                .flatMap((sheet) => Array.from(sheet.cssRules))
                .filter((rule): rule is CSSStyleRule => "selectorText" in rule)
                .find((rule) =>
                    rule.selectorText.includes(
                        ".ant-breadcrumb li:not(:first-child):not(:last-child) a"
                    )
                );

            expect(breadcrumbRuleText).toContain(
                ".ant-breadcrumb li:first-child"
            );
            expect(rootCrumbRule?.style.getPropertyValue("flex-shrink")).toBe(
                "0"
            );
            expect(middleCrumbRule).toBeDefined();
            expect(middleCrumbRule?.style.getPropertyValue("max-width")).toBe(
                "100%"
            );
            expect(middleCrumbRule?.style.getPropertyValue("min-width")).toBe(
                "0"
            );
            expect(middleCrumbRule?.style.getPropertyValue("overflow")).toBe(
                "hidden"
            );
            expect(
                middleCrumbRule?.style.getPropertyValue("text-overflow")
            ).toBe("ellipsis");
            expect(middleCrumbRule?.style.getPropertyValue("white-space")).toBe(
                "nowrap"
            );
        });

        it("respects prefers-reduced-motion and prefers-reduced-transparency", () => {
            renderDetail("/projects/project-1/board");
            const css = sheetText();
            expect(css).toMatch(/prefers-reduced-motion[^}]*reduce/);
            expect(css).toMatch(/prefers-reduced-transparency[^}]*reduce/);
        });
    });

    describe("phone chrome section navigation", () => {
        const desktopMatchMedia = window.matchMedia;

        beforeAll(() => {
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

            const navRuleText = ruleTextsFor(styledClassFor(nav) ?? "").join(
                "\n"
            );
            expect(navRuleText).toContain("overflow-x: auto");
            expect(navRuleText).toContain("flex: 1 1 100%");
        });

        it("keeps nav links pan-friendly: fixed-size segments that never wrap", () => {
            renderDetail("/projects/project-1/labels");

            const board = screen.getByRole("link", { name: "Board" });
            const linkRuleText = ruleTextsFor(
                styledClassFor(board) ?? ""
            ).join("\n");
            expect(linkRuleText).toContain("flex: 0 0 auto");
            expect(linkRuleText).toContain("white-space: nowrap");
        });

        it("still hides the whole chrome on the phone board route", () => {
            renderDetail("/projects/project-1/board");

            expect(
                screen.queryByTestId("project-detail-chrome")
            ).not.toBeInTheDocument();
        });
    });
});
