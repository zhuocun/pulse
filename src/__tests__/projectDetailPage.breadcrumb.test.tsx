import fs from "fs";
import path from "path";

import { render, screen, within } from "@testing-library/react";
import { Navigate } from "react-router";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import ProjectDetailPage from "../pages/projectDetail";

jest.mock("../utils/hooks/useReactQuery", () => ({
    __esModule: true,
    default: () => ({ data: { _id: "project-1", projectName: "Atlas" } })
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
                </Route>
                <Route path="*" element={<LocationProbe />} />
            </Routes>
            <LocationProbe />
        </MemoryRouter>
    );

describe("ProjectDetailPage breadcrumb", () => {
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
});
