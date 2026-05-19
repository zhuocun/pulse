import { Button } from "antd";
import { lazy, Suspense } from "react";
import { Navigate, Outlet, useNavigate } from "react-router-dom";

import EmptyState from "../components/emptyState";
import { PageSpin } from "../components/status";
import { microcopy } from "../constants/microcopy";
import useAuth from "../utils/hooks/useAuth";

/**
 * Route-level code splitting (Phase B). Each page becomes its own chunk so the
 * login screen does not have to download project / board / AI code on first
 * paint. The Suspense boundary lives one level above HomePage so the layout
 * chrome stays mounted while a page chunk fetches.
 *
 * Tests that exercise the routes (App.test, route integration suites) already
 * use `jest.mock("../pages/...")` to swap each page for a sync stub. Combined
 * with `findBy*` / `waitFor` they handle the one-tick suspension `lazy()`
 * introduces. Page-only tests (board.test, project.test, projectDetail.test)
 * import the page directly and are not affected.
 */
const HomePage = lazy(() => import("../pages/home"));
const LoginPage = lazy(() => import("../pages/login"));
const RegisterPage = lazy(() => import("../pages/register"));
const ForgotPasswordPage = lazy(() => import("../pages/forgotPassword"));
const TermsPage = lazy(() => import("../pages/terms"));
const ProjectPage = lazy(() => import("../pages/project"));
const ProjectDetailPage = lazy(() => import("../pages/projectDetail"));
const BoardPage = lazy(() => import("../pages/board"));

/**
 * Resolves the root URL by consulting authentication once, at the route
 * level. Authenticated visitors land on `/projects` directly; unauthenticated
 * visitors go to `/login`. The previous setup always redirected to `/login`
 * and let `HomePage` redirect a second time, which produced a brief
 * login-screen flash for users who already had a session.
 */
const RootRedirect = () => {
    const { token } = useAuth();
    return token ? (
        <Navigate to="/projects" replace />
    ) : (
        <Navigate to="/login" replace />
    );
};

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
 * Single "/" match: index redirects to login; sibling branch renders the auth/main shell.
 * Nested paths use relative segments (e.g. projects/:projectId/board).
 */
const routes = [
    {
        path: "/",
        element: <SuspenseShell />,
        children: [
            { index: true, element: <RootRedirect /> },
            {
                element: <HomePage />,
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
                    },
                    {
                        path: "auth/terms",
                        element: <TermsPage />
                    },
                    {
                        path: "projects",
                        element: <ProjectPage />
                    },
                    {
                        path: "projects/:projectId",
                        element: <ProjectDetailPage />,
                        children: [
                            {
                                path: "board",
                                element: <BoardPage />
                            }
                        ]
                    },
                    {
                        path: "*",
                        element: <NotFoundRoute />
                    }
                ]
            }
        ]
    }
];

export { RootRedirect };
export default routes;
