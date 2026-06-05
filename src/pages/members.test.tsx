import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { microcopy } from "../constants/microcopy";

import MembersPage from "./members";

/*
 * The page resolves the project record only for the browser-tab title.
 * Mock the shared react-query hook so the title can compose without a
 * network round-trip, and stub the manager so the page test stays
 * focused on the shell (heading, title, projectId wiring) — the manager
 * has its own suite.
 */
jest.mock("../utils/hooks/useReactQuery", () => ({
    __esModule: true,
    default: () => ({ data: { _id: "project-1", projectName: "Atlas" } })
}));

jest.mock("../components/projectMembersManager", () => ({
    __esModule: true,
    default: ({ projectId }: { projectId: string }) => (
        <div data-testid="members-manager">{projectId}</div>
    )
}));

const renderMembersRoute = () =>
    render(
        <MemoryRouter initialEntries={["/projects/project-1/members"]}>
            <Routes>
                <Route
                    path="/projects/:projectId/members"
                    element={<MembersPage />}
                />
            </Routes>
        </MemoryRouter>
    );

describe("MembersPage", () => {
    it("renders the page heading", () => {
        renderMembersRoute();
        expect(
            screen.getByRole("heading", {
                level: 1,
                name: microcopy.members.heading
            })
        ).toBeInTheDocument();
    });

    it("mounts the members manager with the route's projectId", () => {
        renderMembersRoute();
        expect(screen.getByTestId("members-manager")).toHaveTextContent(
            "project-1"
        );
    });

    it("sets the document title to 'Members · {project}'", () => {
        renderMembersRoute();
        expect(document.title).toBe(
            microcopy.pageTitle.membersWithProject.replace("{project}", "Atlas")
        );
    });
});
