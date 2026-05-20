import { Navigate, useLocation } from "react-router";

import AuthLayout from "../layouts/authLayout";
import MainLayout from "../layouts/mainLayout";
import useAuth from "../utils/hooks/useAuth";

const HomePage = () => {
    const { isAuthenticated } = useAuth();
    const path = useLocation().pathname;
    const isAuthRoute =
        path === "/login" ||
        path === "/register" ||
        path === "/auth/forgot-password";

    if (isAuthenticated && isAuthRoute) {
        return <Navigate to="/projects" replace />;
    }

    if (!isAuthenticated && !isAuthRoute) {
        return <Navigate to="/login" replace />;
    }

    return <div>{isAuthenticated ? <MainLayout /> : <AuthLayout />}</div>;
};

export default HomePage;
