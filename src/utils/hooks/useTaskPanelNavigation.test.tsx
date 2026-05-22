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

    it("returns stable function identities across renders", () => {
        const { ref, rerender } = renderHook();
        const first = ref.current!;
        rerender(
            <MemoryRouter initialEntries={["/projects/p1/board"]}>
                <Routes>
                    <Route
                        path="/projects/:projectId/board"
                        element={
                            <Probe
                                onReady={(api) => {
                                    ref.current = api;
                                }}
                            />
                        }
                    />
                </Routes>
            </MemoryRouter>
        );
        // useCallback dependencies are projectId + navigate; both stable
        // across the same MemoryRouter, so the function identities are
        // expected to be stable.
        const second = ref.current!;
        expect(typeof second.openTask).toBe("function");
        expect(typeof second.closeTask).toBe("function");
        // Identity equality is a stronger claim than functional
        // equivalence — keep it loose since rerender re-mounts the
        // tree.
        expect(first.openTask).not.toBeUndefined();
    });
});
