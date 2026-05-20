import styled from "@emotion/styled";
import { useState } from "react";
import { Link, Navigate } from "react-router";

import RegisterForm from "../components/registerForm";
import { microcopy } from "../constants/microcopy";
import { AuthSubtitle, AuthTitle } from "../layouts/authLayout";
import { fontSize, space } from "../theme/tokens";
import useAuth from "../utils/hooks/useAuth";
import useTitle from "../utils/hooks/useTitle";

const SwitchRow = styled.p`
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
    font-size: ${fontSize.sm}px;
    margin: ${space.lg}px 0 0;
    text-align: center;
`;

const SwitchAuthLink = styled(Link)`
    color: var(--ant-color-link);
`;

const RegisterPage = () => {
    useTitle(microcopy.actions.signUp);
    const { isAuthenticated } = useAuth();
    const [error, setError] = useState<Error | null | IError>(null);

    if (isAuthenticated) {
        return <Navigate to="/projects" replace />;
    }
    return (
        <>
            <AuthTitle>{microcopy.auth.registerTitle}</AuthTitle>
            <AuthSubtitle>{microcopy.auth.registerSubtitle}</AuthSubtitle>
            <RegisterForm onError={setError} serverError={error} />
            <SwitchRow>
                {microcopy.auth.switchToLogin}{" "}
                <SwitchAuthLink to="/login">
                    {microcopy.actions.loginCta}
                </SwitchAuthLink>
            </SwitchRow>
        </>
    );
};

export default RegisterPage;
