import { render, screen, within } from "@testing-library/react";
import { Navigate } from "react-router";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import ProjectDetailPage from "./projectDetail";

jest.mock("../utils/hooks/useReactQuery", () => ({
    __esModule: true,
    default: () => ({ data: { _id: "project-1", projectName: "Atlas" } })
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
});
