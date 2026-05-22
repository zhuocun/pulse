import { ReactElement } from "react";

import routes, { RequireAuth, RequireGuest, RootRedirect } from ".";

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
        // to send the visitor to /login or /projects.
        expect(element(indexRedirect as { element?: unknown }).type).toBe(
            RootRedirect
        );
    });

    it("guards auth-only pages with <RequireGuest /> and protects app pages with <RequireAuth /> (QW-4)", () => {
        // Layer 0: SuspenseShell. Layer 1 children are:
        //   [0] index → RootRedirect
        //   [1] RequireGuest wrapper for login / register / forgot / terms
        //   [2] RequireAuth wrapper for projects / projects/:projectId
        //   [3] "*" catch-all
        const guestBranch = routes[0].children?.[1];
        expect(element(guestBranch as { element?: unknown }).type).toBe(
            RequireGuest
        );
        expect(guestBranch?.children?.map((route) => route.path)).toEqual([
            "register",
            "login",
            "auth/forgot-password",
            "auth/terms"
        ]);

        const protectedBranch = routes[0].children?.[2];
        expect(element(protectedBranch as { element?: unknown }).type).toBe(
            RequireAuth
        );
        expect(protectedBranch?.children?.map((route) => route.path)).toEqual([
            "projects",
            "projects/:projectId"
        ]);

        const catchAll = routes[0].children?.[3];
        expect(catchAll && "path" in catchAll ? catchAll.path : undefined).toBe(
            "*"
        );
    });

    it("nests an index redirect and the board route below project detail", () => {
        const protectedBranch = routes[0].children?.[2];
        const projectDetailRoute = protectedBranch?.children?.find(
            (route) => route.path === "projects/:projectId"
        );

        // Bare `/projects/:projectId` is handled by a declarative `index`
        // redirect (Navigate to "board"). The previous `useEffect`
        // force-redirect inside `ProjectDetailPage` was removed in QW-11.
        const children = projectDetailRoute?.children ?? [];
        expect(
            children[0] && "index" in children[0] && children[0].index
        ).toBe(true);
        expect(children.slice(1).map((route) => route.path)).toEqual(["board"]);
    });
});
