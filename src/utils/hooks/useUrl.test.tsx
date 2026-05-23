import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { NavigateOptions } from "react-router-dom";

import useUrl from "./useUrl";

/*
 * `react-router-dom` exports `useSearchParams` as a non-configurable
 * binding on its CJS module object, so `jest.spyOn(routerDom, ...)`
 * can't intercept it at runtime. We capture the most recent setter
 * argument via a manual mock at the top of the module — the variable
 * is mutable so individual tests can subscribe / read.
 */
let capturedSetterOptions: NavigateOptions | undefined;
const realRouterDom = jest.requireActual("react-router-dom") as Record<
    string,
    unknown
>;
jest.mock("react-router-dom", () => {
    const actual = jest.requireActual(
        "react-router-dom"
    ) as typeof import("react-router-dom");
    return {
        ...actual,
        useSearchParams: (
            ...args: Parameters<typeof actual.useSearchParams>
        ) => {
            const [params, setParams] = actual.useSearchParams(...args);
            const wrappedSet: typeof setParams = (next, options) => {
                capturedSetterOptions = options;
                return setParams(next, options);
            };
            return [params, wrappedSet];
        }
    };
});
// Suppress unused-warning — referenced from the module mock factory.
void realRouterDom;

const UrlProbe = () => {
    const [{ managerId, projectName }, setParams] = useUrl([
        "projectName",
        "managerId"
    ]);
    const location = useLocation();

    return (
        <div>
            <span data-testid="projectName">{projectName ?? "null"}</span>
            <span data-testid="managerId">{managerId ?? "null"}</span>
            <span data-testid="search">{location.search}</span>
            <button
                type="button"
                onClick={() =>
                    setParams({
                        managerId: "u2",
                        projectName: "Billing"
                    })
                }
            >
                update
            </button>
            <button
                type="button"
                onClick={() =>
                    setParams({
                        managerId: "u2",
                        projectName: undefined
                    })
                }
            >
                clear project
            </button>
        </div>
    );
};

const renderUrlProbe = (route: string) =>
    render(
        <MemoryRouter initialEntries={[route]}>
            <UrlProbe />
        </MemoryRouter>
    );

describe("useUrl", () => {
    it("returns requested keys from the current URL search params", () => {
        renderUrlProbe("/projects?projectName=Roadmap&managerId=u1");

        expect(screen.getByTestId("projectName")).toHaveTextContent("Roadmap");
        expect(screen.getByTestId("managerId")).toHaveTextContent("u1");
    });

    it("updates one or more search params", async () => {
        renderUrlProbe("/projects?projectName=Roadmap&managerId=u1&extra=keep");

        fireEvent.click(screen.getByRole("button", { name: "update" }));

        await waitFor(() =>
            expect(screen.getByTestId("projectName")).toHaveTextContent(
                "Billing"
            )
        );
        expect(screen.getByTestId("managerId")).toHaveTextContent("u2");
        expect(screen.getByTestId("search")).toHaveTextContent(
            "projectName=Billing"
        );
        expect(screen.getByTestId("search")).toHaveTextContent("managerId=u2");
        expect(screen.getByTestId("search")).toHaveTextContent("extra=keep");
    });

    it("removes void params before writing the URL", async () => {
        renderUrlProbe("/projects?projectName=Roadmap&managerId=u1");

        fireEvent.click(screen.getByRole("button", { name: "clear project" }));

        await waitFor(() =>
            expect(screen.getByTestId("projectName")).toHaveTextContent("null")
        );
        expect(screen.getByTestId("managerId")).toHaveTextContent("u2");
        expect(screen.getByTestId("search")).toHaveTextContent("?managerId=u2");
    });

    it("preserves unrelated search params when multiple useUrl hooks update independently", async () => {
        const MultiHookProbe = () => {
            const [{ modal }, setModal] = useUrl(["modal"]);
            const [{ editingProjectId }, setEditingProjectId] = useUrl([
                "editingProjectId"
            ]);
            const location = useLocation();

            return (
                <div>
                    <span data-testid="modal">{modal ?? "null"}</span>
                    <span data-testid="editingProjectId">
                        {editingProjectId ?? "null"}
                    </span>
                    <span data-testid="search">{location.search}</span>
                    <button
                        type="button"
                        onClick={() => setModal({ modal: "on" })}
                    >
                        open modal
                    </button>
                    <button
                        type="button"
                        onClick={() =>
                            setEditingProjectId({ editingProjectId: "p2" })
                        }
                    >
                        start editing
                    </button>
                </div>
            );
        };

        render(
            <MemoryRouter initialEntries={["/projects?extra=keep"]}>
                <MultiHookProbe />
            </MemoryRouter>
        );

        fireEvent.click(screen.getByRole("button", { name: "open modal" }));
        await waitFor(() =>
            expect(screen.getByTestId("search")).toHaveTextContent(
                "?extra=keep"
            )
        );

        fireEvent.click(screen.getByRole("button", { name: "start editing" }));

        await waitFor(() =>
            expect(screen.getByTestId("modal")).toHaveTextContent("on")
        );
        expect(screen.getByTestId("editingProjectId")).toHaveTextContent("p2");
        expect(screen.getByTestId("search")).toHaveTextContent("modal=on");
        expect(screen.getByTestId("search")).toHaveTextContent(
            "editingProjectId=p2"
        );
        expect(screen.getByTestId("search")).toHaveTextContent("extra=keep");
    });

    /*
     * Regression: on iOS Safari WebKit, modal/drawer state derived purely
     * from `useSearchParams()` was failing to flip in the same render as
     * the click — the URL did update (refreshing brought the modal up),
     * but the consumer never re-rendered with the new value. This asserts
     * the consumer-visible state flips synchronously with the click, so
     * UI binds to local React state regardless of how the URL change
     * propagates.
     */
    it("returns the new value synchronously after a click, without waiting for URL propagation", () => {
        renderUrlProbe("/projects");

        expect(screen.getByTestId("projectName")).toHaveTextContent("null");
        expect(screen.getByTestId("managerId")).toHaveTextContent("null");

        fireEvent.click(screen.getByRole("button", { name: "update" }));

        // No waitFor: the value must be visible in the very next render
        // produced by fireEvent's flushed state updates.
        expect(screen.getByTestId("projectName")).toHaveTextContent("Billing");
        expect(screen.getByTestId("managerId")).toHaveTextContent("u2");
    });

    it("clears the value synchronously when a key is set back to void", () => {
        renderUrlProbe("/projects?projectName=Roadmap&managerId=u1");

        expect(screen.getByTestId("projectName")).toHaveTextContent("Roadmap");

        fireEvent.click(screen.getByRole("button", { name: "clear project" }));

        expect(screen.getByTestId("projectName")).toHaveTextContent("null");
        expect(screen.getByTestId("managerId")).toHaveTextContent("u2");
    });

    /*
     * Regression: the Create-project button lives in `ProjectPage` and
     * writes `?modal=on`, but the modal that has to react is mounted in
     * `MainLayout` — a second, sibling `useUrl` instance. Earlier the
     * second instance never observed the write (on iOS Safari WebKit),
     * so the modal never opened. This asserts that a write from one
     * `useUrl` instance is observed by an unrelated instance in the
     * same render.
     */
    it("propagates a write from one useUrl instance to a sibling instance", async () => {
        const Trigger = () => {
            const [, setUrl] = useUrl(["modal"]);
            return (
                <button type="button" onClick={() => setUrl({ modal: "on" })}>
                    open
                </button>
            );
        };
        const Observer = () => {
            const [{ modal }] = useUrl(["modal"]);
            return <span data-testid="observer">{modal ?? "null"}</span>;
        };

        render(
            <MemoryRouter initialEntries={["/projects"]}>
                <Trigger />
                <Observer />
            </MemoryRouter>
        );

        expect(screen.getByTestId("observer")).toHaveTextContent("null");

        fireEvent.click(screen.getByRole("button", { name: "open" }));

        await waitFor(() =>
            expect(screen.getByTestId("observer")).toHaveTextContent("on")
        );
    });

    /*
     * R2-L1: `setUrlParams` accepts a second `NavigateOptions` arg and
     * forwards it verbatim to `setSearchParams`. Callers rely on this
     * to opt into `viewTransition: true` and `replace: true` — both
     * options need to land at the router's setter, not get dropped.
     * The module-level mock above captures whatever options the hook
     * passes through, so this test reads the captured value back.
     */
    it("forwards NavigateOptions to setSearchParams (R2-L1)", () => {
        capturedSetterOptions = undefined;
        const Probe = () => {
            const [, setParams] = useUrl(["modal"]);
            return (
                <button
                    type="button"
                    onClick={() =>
                        setParams(
                            { modal: "on" },
                            { replace: true, viewTransition: true }
                        )
                    }
                >
                    write with options
                </button>
            );
        };

        render(
            <MemoryRouter initialEntries={["/projects"]}>
                <Probe />
            </MemoryRouter>
        );

        fireEvent.click(
            screen.getByRole("button", { name: "write with options" })
        );

        expect(capturedSetterOptions).toEqual({
            replace: true,
            viewTransition: true
        });
    });
});
