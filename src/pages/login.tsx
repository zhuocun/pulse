import { useState } from "react";
import { Link, useLocation } from "react-router";

import LoginForm from "../components/loginForm";
import { microcopy } from "../constants/microcopy";
import { AuthSubtitle, AuthTitle } from "../layouts/authLayout";
import useTitle, { composeBrandedTitle } from "../utils/hooks/useTitle";

const SWITCH_ROW_CLASS =
    "m-0 mt-lg text-center text-sm coarse:text-base [color:var(--pulse-text-secondary,rgba(15,23,42,0.65))]";

const LoginPage = () => {
    useTitle(composeBrandedTitle(microcopy.pageTitle.login), false);
    const location = useLocation();
    const [error, setError] = useState<Error | IError | null>(null);

    return (
        <>
            <AuthTitle>{microcopy.auth.loginTitle}</AuthTitle>
            <AuthSubtitle>{microcopy.auth.loginSubtitle}</AuthSubtitle>
            <LoginForm onError={setError} serverError={error} />
            <p className={SWITCH_ROW_CLASS}>
                {microcopy.auth.switchToRegister}{" "}
                <Link
                    className="[color:var(--pulse-link)] coarse:inline-flex coarse:min-h-[44px] coarse:items-center"
                    state={location.state}
                    to="/register"
                >
                    {microcopy.actions.registerCta}
                </Link>
            </p>
        </>
    );
};

export default LoginPage;
