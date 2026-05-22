import { Button } from "antd";
import { lazy, Suspense } from "react";
import { Navigate, Outlet, useNavigate } from "react-router-dom";

import EmptyState from "../components/emptyState";
import { PageSpin } from "../components/status";
import { microcopy } from "../constants/microcopy";
import AuthLayout from "../layouts/authLayout";
import MainLayout from "../layouts/mainLayout";
import useAuth from "../utils/hooks/useAuth";

/**
 * Route-level code splitting (Phase B). Each page becomes its own chunk so the
 * login screen does not have to download project / board / AI code on first
 * paint. The Suspense boundary lives one level above the page elements so the
 * layout chrome stays mounted while a page chunk fetches.
 *
 * Tests that exercise the routes (App.test, route integration suites) already
 * use `jest.mock("../pages/...")` to swap each page for a sync stub. Combined
 * with `findBy*` / `waitFor` they handle the one-tick suspension `lazy()`
 * introduces. Page-only tests (board.test, project.test, projectDetail.test)
 * import the page directly and are not affected.
 */
const LoginPage = lazy(() => import("../pages/login"));
const RegisterPage = lazy(() => import("../pages/register"));
const ForgotPasswordPage = lazy(() => import("../pages/forgotPassword"));
const TermsPage = lazy(() => import("../pages/terms"));
const ProjectPage = lazy(() => import("../pages/project"));
const ProjectDetailPage = lazy(() => import("../pages/projectDetail"));
const BoardPage = lazy(() => import("../pages/board"));
const SharePage = lazy(() => import("../pages/share"));
const InboxPage = lazy(() => import("../pages/inbox"));
const CopilotLandingPage = lazy(() => import("../pages/copilotLanding"));
const SettingsPage = lazy(() => import("../pages/settings"));

/**
 * Resolves the root URL by consulting authentication once, at the route
 * level. Authenticated visitors land on `/projects` directly; unauthenticated
 * visitors go to `/login`. The previous setup always redirected to `/login`
 * and let `HomePage` redirect a second time, which produced a brief
 * login-screen flash for users who already had a session.
 */
const RootRedirect = () => {
    const { isAuthenticated } = useAuth();
    return isAuthenticated ? (
        <Navigate to="/projects" replace />
    ) : (
        <Navigate to="/login" replace />
    );
};

/**
 * Wraps protected routes: renders `<MainLayout />` (with its `<Outlet />`) for
 * authenticated users, and redirects unauthenticated visitors to `/login`.
 *
 * Replaces the legacy `pages/home.tsx` wrapper that did the same job in a
 * stray `<div>` and force-redirected on every render. Centralising the guard
 * here means `RootRedirect`, the auth-pages branch, and any protected page
 * no longer all independently re-implement the same predicate.
 */
const RequireAuth = () => {
    const { isAuthenticated } = useAuth();
    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }
    return <MainLayout />;
};

/**
 * Wraps guest-only routes (login / register / forgot-password):
 * renders `<AuthLayout />` (with its `<Outlet />`) for visitors without a
 * session, and bounces authenticated users straight to `/projects`. Mirrors
 * `RequireAuth` so the auth predicate is owned in exactly one place.
 *
 * Note: `auth/terms` is intentionally NOT guarded — see `PublicAuthShell`
 * below. The Terms link is reachable both from the login/register forms
 * (guest context) and from any authenticated surface that exposes a
 * "Terms" footer link, so it lives on a public branch that still renders
 * the branded AuthLayout chrome.
 */
const RequireGuest = () => {
    const { isAuthenticated } = useAuth();
    if (isAuthenticated) {
        return <Navigate to="/projects" replace />;
    }
    return <AuthLayout />;
};

/**
 * Public-but-branded shell: renders `<AuthLayout />` for everyone —
 * guests AND authenticated users — so the Terms page is reachable from
 * either context. The legacy guarded version sent authenticated visitors
 * to `/projects`, which made the in-form `Terms` link a dead route once
 * the user had a session. See Bug 1 in
 * `docs/design/ui-ux-comprehensive-review-2026-05.md`.
 */
const PublicAuthShell = () => <AuthLayout />;

const NotFoundRoute = () => {
    const navigate = useNavigate();
    return (
        <EmptyState
            data-testid="not-found"
            title={microcopy.empty.notFound.title}
            description={microcopy.empty.notFound.description}
            cta={
                <Button
                    onClick={() =>
                        navigate("/projects", { viewTransition: true })
                    }
                    type="primary"
                >
                    {microcopy.empty.notFound.cta}
                </Button>
            }
        />
    );
};

const SuspenseShell = () => (
    <Suspense fallback={<PageSpin />}>
        <Outlet />
    </Suspense>
);

/**
 * Single "/" match: index redirects via `RootRedirect`. Sibling branches
 * mount the auth-pages shell (`RequireGuest`) and the authenticated app
 * shell (`RequireAuth`) — each acts as both the layout and the guard, so
 * the redirect predicate lives in exactly one place.
 *
 * Nested paths use relative segments (e.g. `projects/:projectId/board`).
 */
const routes = [
    {
        path: "/",
        element: <SuspenseShell />,
        children: [
            { index: true, element: <RootRedirect /> },
            {
                element: <RequireGuest />,
                children: [
                    {
                        path: "register",
                        element: <RegisterPage />
                    },
                    {
                        path: "login",
                        element: <LoginPage />
                    },
                    {
                        path: "auth/forgot-password",
                        element: <ForgotPasswordPage />
                    }
                ]
            },
            {
                element: <PublicAuthShell />,
                children: [
                    {
                        path: "auth/terms",
                        element: <TermsPage />
                    }
                ]
            },
            {
                element: <RequireAuth />,
                children: [
                    {
                        path: "projects",
                        element: <ProjectPage />
                    },
                    {
                        path: "projects/:projectId",
                        element: <ProjectDetailPage />,
                        children: [
                            /*
                             * Bare `/projects/:projectId` redirects to the
                             * board child route declaratively. The previous
                             * implementation force-redirected via a
                             * `useEffect` inside `ProjectDetailPage` that
                             * paired with a single-tab `Tabs` row (QW-11) —
                             * both deleted in the Phase 2 IA cleanup.
                             */
                            {
                                index: true,
                                element: <Navigate to="board" replace />
                            },
                            {
                                path: "board",
                                element: <BoardPage />
                            }
                        ]
                    },
                    /*
                     * Web Share Target landing page (Phase 3 A4). Wired to
                     * the manifest's `share_target.action = "/share"`
                     * entry — the browser navigates here with title / text
                     * / url URL params when an external app shares into
                     * Pulse. Guarded by `<RequireAuth>` because the page
                     * needs an authenticated session to fetch projects +
                     * post the resulting task; unauthenticated visitors
                     * follow the same `/login` redirect path as every
                     * other protected route.
                     */
                    {
                        path: "share",
                        element: <SharePage />
                    },
                    /*
                     * Bottom-tab destinations (Phase 3 A3). Inbox is the
                     * future home of triage / mentions / AI activity (a
                     * placeholder until A8 lands); Copilot is the no-board
                     * landing surface that delegates to the existing chat
                     * and brief drawers; Settings consolidates theme,
                     * language, AI on/off, and logout in one routed page
                     * so the phone header can drop its right-cluster
                     * dropdown.
                     */
                    {
                        path: "inbox",
                        element: <InboxPage />
                    },
                    {
                        path: "copilot",
                        element: <CopilotLandingPage />
                    },
                    {
                        path: "settings",
                        element: <SettingsPage />
                    }
                ]
            },
            {
                path: "*",
                element: <NotFoundRoute />
            }
        ]
    }
];

export { PublicAuthShell, RequireAuth, RequireGuest, RootRedirect };
export default routes;
