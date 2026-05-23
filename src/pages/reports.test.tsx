import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { microcopy } from "../constants/microcopy";

import ProjectDetailPage from "./projectDetail";
import ReportsPage from "./reports";

/*
 * Both pages share the same react-query hook for the project record.
 * Mock it once at module level so the reports page can render its
 * project-aware title and the project detail shell can paint the
 * breadcrumb without a network round-trip.
 */
jest.mock("../utils/hooks/useReactQuery", () => ({
    __esModule: true,
    default: () => ({ data: { _id: "project-1", projectName: "Atlas" } })
}));

const renderReportsRoute = () =>
    render(
        <MemoryRouter initialEntries={["/projects/project-1/reports"]}>
            <Routes>
                <Route
                    path="/projects/:projectId"
                    element={<ProjectDetailPage />}
                >
                    <Route path="board" element={<div>Board outlet</div>} />
                    <Route path="reports" element={<ReportsPage />} />
                </Route>
            </Routes>
        </MemoryRouter>
    );

describe("ReportsPage", () => {
    /*
     * The page itself: heading + sparkle + empty-state copy + a
     * feedback CTA. These four contracts back the "we hear you"
     * messaging the Phase 4.7 spec calls for — drift on any one of
     * them would turn the placeholder into a vague "coming soon"
     * surface.
     */
    it("renders the page heading and the empty-state copy", () => {
        renderReportsRoute();

        expect(
            screen.getByRole("heading", {
                level: 1,
                name: new RegExp(microcopy.reports.heading)
            })
        ).toBeInTheDocument();
        expect(
            screen.getByText(microcopy.reports.emptyTitle)
        ).toBeInTheDocument();
        expect(
            screen.getByText(microcopy.reports.emptyDescription)
        ).toBeInTheDocument();
        expect(screen.getByTestId("reports-empty-state")).toBeInTheDocument();
    });

    it("surfaces a Share feedback CTA that links to the feedback channel", () => {
        renderReportsRoute();

        const cta = screen.getByRole("link", {
            name: microcopy.reports.feedbackCta
        });
        expect(cta).toBeInTheDocument();
        expect(cta).toHaveAttribute("href", microcopy.reports.feedbackHref);
    });

    it("sets the document title to '{project name} reports' format", () => {
        renderReportsRoute();

        // The title template is "Reports · {project}" — assert the
        // resolved project name lands in the format string so a
        // future template change (e.g. dropping the middle dot)
        // would trip this case.
        expect(document.title).toBe(
            microcopy.pageTitle.reportsWithProject.replace("{project}", "Atlas")
        );
    });

    it("renders the breadcrumb crumb 'Projects > Project Name > Reports'", () => {
        const { container } = renderReportsRoute();

        // The breadcrumb lives in the project detail shell — assert
        // all three crumbs are present and the Reports crumb carries
        // `aria-current="page"`. The middle (project) crumb becomes
        // a link back to the project root once a child route is
        // active so users can navigate up via the breadcrumb.
        const crumb = container.querySelector(".ant-breadcrumb");
        expect(crumb).toBeTruthy();
        const region = within(crumb as HTMLElement);
        expect(
            region.getByRole("link", { name: microcopy.breadcrumb.projects })
        ).toHaveAttribute("href", "/projects");
        expect(region.getByRole("link", { name: "Atlas" })).toHaveAttribute(
            "href",
            "/projects/project-1"
        );
        const reportsCrumb = region.getByText(microcopy.breadcrumb.reports);
        expect(reportsCrumb).toHaveAttribute("aria-current", "page");
    });

    it("highlights the Reports entry in the project detail nav with aria-current=page", () => {
        renderReportsRoute();

        const nav = screen.getByTestId("project-detail-child-nav");
        // Both nav entries are present so the user can swap between
        // surfaces; only the active one carries aria-current=page.
        const boardLink = within(nav).getByRole("link", {
            name: microcopy.labels.board
        });
        const reportsLink = within(nav).getByRole("link", {
            name: microcopy.labels.reports
        });
        expect(boardLink).not.toHaveAttribute("aria-current", "page");
        expect(reportsLink).toHaveAttribute("aria-current", "page");
    });

    it("renders an accent sparkle next to the heading to mark the AI-adjacent surface", () => {
        renderReportsRoute();
        // The sparkle is decorative (aria-hidden), so it's an SVG
        // inside the level-1 heading. Querying by tag + aria-hidden
        // pins the contract without depending on a fragile testid
        // emitted by AiSparkleIcon itself.
        const heading = screen.getByRole("heading", {
            level: 1,
            name: new RegExp(microcopy.reports.heading)
        });
        const sparkle = heading.querySelector("svg[aria-hidden='true']");
        expect(sparkle).toBeTruthy();
    });
});
