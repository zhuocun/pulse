import fs from "fs";
import path from "path";

import { render, screen, within } from "@testing-library/react";
import { Navigate } from "react-router";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import ProjectDetailPage from "../pages/projectDetail";

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

const renderAt = (route: string) =>
    render(
        <MemoryRouter initialEntries={[route]}>
            <Routes>
                <Route
                    path="/projects/:projectId"
                    element={<ProjectDetailPage />}
                >
                    <Route index element={<Navigate to="board" replace />} />
                    <Route path="board" element={<div>Board outlet</div>} />
                    <Route path="members" element={<div>Members outlet</div>} />
                    <Route path="reports" element={<div>Reports outlet</div>} />
                </Route>
                <Route path="*" element={<LocationProbe />} />
            </Routes>
            <LocationProbe />
        </MemoryRouter>
    );

describe("ProjectDetailPage breadcrumb", () => {
    beforeEach(() => {
        mockProjectName = "Atlas";
    });

    it("renders an interactive breadcrumb (Projects link + current project), tokenized shadow, and redirects /projects/:id to board", () => {
        const detailSource = fs.readFileSync(
            path.join(__dirname, "../pages/projectDetail.tsx"),
            "utf8"
        );
        expect(detailSource).not.toMatch(/\b5\s+px\b/);
        expect(detailSource).toMatch(/shadow\.sm/);

        renderAt("/projects/project-1");

        const chrome = screen.getByTestId("project-detail-chrome");
        const chromeStyles = getComputedStyle(chrome);
        if (chromeStyles.boxShadow && chromeStyles.boxShadow !== "none") {
            expect(chromeStyles.boxShadow).not.toMatch(/5\s+px/);
        }

        const crumb = screen.getByTestId("project-breadcrumb");
        expect(crumb).toBeTruthy();
        expect(crumb.tagName).toBe("NAV");
        expect(crumb).toHaveAttribute("aria-label", "Breadcrumb");
        const projectsLink = within(crumb).getByRole("link", {
            name: "Projects"
        });
        expect(projectsLink).toHaveAttribute("href", "/projects");

        const current = within(crumb).getByText("Atlas");
        expect(current).toHaveAttribute("aria-current", "page");

        expect(screen.getByTestId("location")).toHaveTextContent(
            "/projects/project-1/board"
        );
    });

    it("lets only the long project crumb shrink", () => {
        mockProjectName =
            "International enterprise platform reliability and compliance roadmap";
        renderAt("/projects/project-1/members");

        const breadcrumb = screen.getByTestId("project-breadcrumb");
        expect(breadcrumb.className).toContain(
            "[&_li[data-breadcrumb=middle]]:flex-[1_1_auto]"
        );
        expect(breadcrumb.className).toContain(
            "[&_li[data-breadcrumb=current]]:flex-[0_0_auto]"
        );

        const middle = breadcrumb.querySelector('[data-breadcrumb="middle"]');
        const current = breadcrumb.querySelector('[data-breadcrumb="current"]');
        expect(middle).toHaveTextContent(mockProjectName);
        expect(
            within(breadcrumb).getByRole("link", { name: mockProjectName })
        ).toHaveAttribute("href", "/projects/project-1");
        expect(current).toBeNull();
        expect(within(breadcrumb).queryByText("Members")).toBeNull();
        expect(
            within(screen.getByTestId("project-detail-child-nav")).getByRole(
                "link",
                { name: "Members" }
            )
        ).toHaveAttribute("aria-current", "page");
    });
});
