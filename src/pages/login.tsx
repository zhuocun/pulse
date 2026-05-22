import styled from "@emotion/styled";
import { useState } from "react";
import { Link, Navigate, useLocation } from "react-router";

import LoginForm from "../components/loginForm";
import { microcopy } from "../constants/microcopy";
import { AuthSubtitle, AuthTitle } from "../layouts/authLayout";
import { fontSize, space } from "../theme/tokens";
import useAuth from "../utils/hooks/useAuth";
import useTitle, { composeBrandedTitle } from "../utils/hooks/useTitle";

const SwitchRow = styled.p`
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
    font-size: ${fontSize.sm}px;
    margin: ${space.lg}px 0 0;
    text-align: center;
`;

const SwitchAuthLink = styled(Link)`
    color: var(--ant-color-link);
`;

const LoginPage = () => {
    useTitle(composeBrandedTitle(microcopy.pageTitle.login), false);
    const { isAuthenticated } = useAuth();
    const location = useLocation();
    const [error, setError] = useState<Error | IError | null>(null);

    if (isAuthenticated) {
        return <Navigate to="/projects" replace />;
    }

    return (
        <>
            <AuthTitle>{microcopy.auth.loginTitle}</AuthTitle>
            <AuthSubtitle>{microcopy.auth.loginSubtitle}</AuthSubtitle>
            <LoginForm onError={setError} serverError={error} />
            <SwitchRow>
                {microcopy.auth.switchToRegister}{" "}
                <SwitchAuthLink to="/register" state={location.state}>
                    {microcopy.actions.registerCta}
                </SwitchAuthLink>
            </SwitchRow>
        </>
    );
};

export default LoginPage;
