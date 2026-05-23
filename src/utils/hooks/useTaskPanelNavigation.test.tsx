import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import {
    MemoryRouter,
    Route,
    Routes,
    useLocation,
    useParams
} from "react-router-dom";

import useTaskPanelNavigation from "./useTaskPanelNavigation";

interface ProbeProps {
    onReady: (api: ReturnType<typeof useTaskPanelNavigation>) => void;
}

const Probe: React.FC<ProbeProps> = ({ onReady }) => {
    const api = useTaskPanelNavigation();
    useEffect(() => {
        onReady(api);
    }, [api, onReady]);
    return null;
};

const LocationProbe: React.FC = () => {
    const loc = useLocation();
    return <div data-testid="path">{loc.pathname}</div>;
};

const ParamProbe: React.FC = () => {
    const params = useParams();
    return <div data-testid="param">{params.projectId ?? ""}</div>;
};

const renderHook = (initialPath = "/projects/p1/board") => {
    const ref: { current: ReturnType<typeof useTaskPanelNavigation> | null } = {
        current: null
    };
    const utils = render(
        <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
                <Route
                    path="/projects/:projectId/board"
                    element={
                        <>
                            <Probe
                                onReady={(api) => {
                                    ref.current = api;
                                }}
                            />
                            <LocationProbe />
                            <ParamProbe />
                        </>
                    }
                />
                <Route
                    path="/projects/:projectId/board/task/:taskId"
                    element={
                        <>
                            <Probe
                                onReady={(api) => {
                                    ref.current = api;
                                }}
                            />
                            <LocationProbe />
                            <ParamProbe />
                        </>
                    }
                />
                <Route
                    path="/projects"
                    element={
                        <>
                            <Probe
                                onReady={(api) => {
                                    ref.current = api;
                                }}
                            />
                            <LocationProbe />
                        </>
                    }
                />
            </Routes>
        </MemoryRouter>
    );
    return { ref, ...utils };
};

describe("useTaskPanelNavigation", () => {
    it("navigates to /projects/:projectId/board/task/:taskId via openTask", () => {
        const { ref, getByTestId } = renderHook();
        expect(getByTestId("path").textContent).toBe("/projects/p1/board");

        act(() => {
            ref.current!.openTask("task-42");
        });

        expect(getByTestId("path").textContent).toBe(
            "/projects/p1/board/task/task-42"
        );
    });

    it("accepts an explicit projectId override", () => {
        const { ref, getByTestId } = renderHook();

        act(() => {
            ref.current!.openTask("task-99", "p2");
        });

        expect(getByTestId("path").textContent).toBe(
            "/projects/p2/board/task/task-99"
        );
    });

    it("closeTask navigates back to /projects/:projectId/board", () => {
        const { ref, getByTestId } = renderHook(
            "/projects/p1/board/task/task-1"
        );
        expect(getByTestId("path").textContent).toBe(
            "/projects/p1/board/task/task-1"
        );

        act(() => {
            ref.current!.closeTask();
        });

        expect(getByTestId("path").textContent).toBe("/projects/p1/board");
    });

    it("openTask refuses to navigate when projectId is unresolvable", () => {
        const { ref, getByTestId } = renderHook("/projects");
        expect(getByTestId("path").textContent).toBe("/projects");

        act(() => {
            ref.current!.openTask("task-1");
        });

        // No navigation occurred — the hook bailed silently.
        expect(getByTestId("path").textContent).toBe("/projects");
    });

    it("openTask refuses to navigate when taskId is empty", () => {
        const { ref, getByTestId } = renderHook();

        act(() => {
            ref.current!.openTask("");
        });

        expect(getByTestId("path").textContent).toBe("/projects/p1/board");
    });

    it("returns stable function identities across re-renders of the SAME tree (B-T3)", () => {
        // Capture every render's api ref so we can compare identities
        // across re-renders within a single MemoryRouter mount. A bare
        // wrapper `{ tick }` prop forces the Probe to re-render without
        // remounting the tree, isolating the hook's `useCallback`
        // identity claim.
        const captured: ReturnType<typeof useTaskPanelNavigation>[] = [];
        const Capture: React.FC<{ tick: number }> = ({ tick }) => {
            const api = useTaskPanelNavigation();
            captured.push(api);
            void tick;
            return null;
        };
        const { rerender } = render(
            <MemoryRouter initialEntries={["/projects/p1/board"]}>
                <Routes>
                    <Route
                        path="/projects/:projectId/board"
                        element={<Capture tick={0} />}
                    />
                </Routes>
            </MemoryRouter>
        );
        rerender(
            <MemoryRouter initialEntries={["/projects/p1/board"]}>
                <Routes>
                    <Route
                        path="/projects/:projectId/board"
                        element={<Capture tick={1} />}
                    />
                </Routes>
            </MemoryRouter>
        );
        expect(captured.length).toBeGreaterThanOrEqual(2);
        const first = captured[0];
        const last = captured[captured.length - 1];
        // Referential identity holds across the rerender because both
        // `useCallback` deps (currentProjectId + navigate) are stable
        // within a single MemoryRouter instance.
        expect(last.openTask).toBe(first.openTask);
        expect(last.closeTask).toBe(first.closeTask);
    });
});
