import { ReactElement } from "react";

import routes, { RootRedirect } from ".";

jest.mock("../pages/home", () => ({
    __esModule: true,
    default: () => null
}));
jest.mock("../pages/login", () => ({
    __esModule: true,
    default: () => null
}));
jest.mock("../pages/register", () => ({
    __esModule: true,
    default: () => null
}));
jest.mock("../pages/forgotPassword", () => ({
    __esModule: true,
    default: () => null
}));
jest.mock("../pages/terms", () => ({
    __esModule: true,
    default: () => null
}));
jest.mock("../pages/project", () => ({
    __esModule: true,
    default: () => null
}));
jest.mock("../pages/projectDetail", () => ({
    __esModule: true,
    default: () => null
}));
jest.mock("../pages/board", () => ({
    __esModule: true,
    default: () => null
}));

const element = <Props,>(route: { element?: unknown }) =>
    route.element as ReactElement<Props>;

describe("routes", () => {
    it("wraps the app in a Suspense shell with an auth-aware index redirect", () => {
        const root = routes[0];
        expect(root.path).toBe("/");
        // The root element wraps an Outlet in a Suspense boundary so the
        // lazily-loaded page chunks can suspend without blanking the page.
        expect(element(root).type).toBeInstanceOf(Function);

        const indexRedirect = root.children?.[0];
        expect(
            indexRedirect && "index" in indexRedirect && indexRedirect.index
        ).toBe(true);
        // The index renders <RootRedirect/>, which decides at runtime whether
        // to send the visitor to /login or /projects. The previous test that
        // hard-coded `/login` no longer applies.
        expect(element(indexRedirect as { element?: unknown }).type).toBe(
            RootRedirect
        );
    });

    it("contains auth, project, and catch-all child routes under the home shell", () => {
        const homeShell = routes[0].children?.[1];
        expect(
            homeShell && "path" in homeShell ? homeShell.path : undefined
        ).toBe(undefined);
        expect(homeShell?.children?.map((route) => route.path)).toEqual([
            "register",
            "login",
            "auth/forgot-password",
            "auth/terms",
            "projects",
            "projects/:projectId",
            "*"
        ]);
    });

    it("nests the board route below project detail", () => {
        const projectDetailRoute = routes[0].children?.[1]?.children?.find(
            (route) => route.path === "projects/:projectId"
        );

        expect(
            projectDetailRoute?.children?.map((route) => route.path)
        ).toEqual(["board"]);
    });
});
