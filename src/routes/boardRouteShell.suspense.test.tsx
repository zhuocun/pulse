import { render, screen } from "@testing-library/react";
import { ReactElement, Suspense } from "react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";

import routes from ".";

/*
 * W2-01 — `BoardRouteShell` owns a Suspense boundary around its
 * task-panel Outlet. A deep link to `task/:taskId` whose chunk never
 * resolves (simulated by a child that suspends forever) must NOT
 * escape to the layout-level fallback: the board stays painted and
 * only the panel slot waits.
 *
 * Lives in its own file (rather than `index.test.tsx`) because the
 * shell is only registered when `environment.taskPanelRouted` is on,
 * and the flag has to be mocked before the routes module evaluates.
 */

jest.mock("../constants/env", () => {
    const actual = jest.requireActual("../constants/env");
    return {
        __esModule: true,
        default: { ...actual.default, taskPanelRouted: true }
    };
});

jest.mock("../pages/board", () => ({
    __esModule: true,
    default: () => <div data-testid="board-content">Board Route</div>
}));

describe("BoardRouteShell task-panel Suspense isolation (W2-01)", () => {
    it("keeps the board painted while a deep-linked task panel suspends", async () => {
        const protectedBranch = routes[0].children?.[3];
        const projectDetailRoute = protectedBranch?.children?.find(
            (route) => "path" in route && route.path === "projects/:projectId"
        );
        const boardRoute = projectDetailRoute?.children?.find(
            (route) => "path" in route && route.path === "board"
        );

        const SuspendsForever = () => {
            throw new Promise(() => {});
        };

        const router = createMemoryRouter(
            [
                {
                    path: "/projects/:projectId/board",
                    element: boardRoute?.element as ReactElement,
                    children: [
                        { index: true, element: null },
                        {
                            path: "task/:taskId",
                            element: <SuspendsForever />
                        }
                    ]
                }
            ],
            { initialEntries: ["/projects/project-1/board/task/task-1"] }
        );

        render(
            <Suspense fallback={<div data-testid="outer-fallback" />}>
                <RouterProvider router={router} />
            </Suspense>
        );

        // The lazy BoardPage stub resolves after a tick; the wedged
        // panel child stays suspended forever. Without the shell's own
        // boundary the suspension bubbles to the outer fallback and
        // blanks the board.
        expect(await screen.findByTestId("board-content")).toBeInTheDocument();
        expect(screen.queryByTestId("outer-fallback")).not.toBeInTheDocument();
    });
});
