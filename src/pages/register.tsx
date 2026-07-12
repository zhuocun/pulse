import { useState } from "react";
import { Link, useLocation } from "react-router";

import RegisterForm from "../components/registerForm";
import { microcopy } from "../constants/microcopy";
import { AuthSubtitle, AuthTitle } from "../layouts/authLayout";
import useTitle, { composeBrandedTitle } from "../utils/hooks/useTitle";

const SWITCH_ROW_CLASS =
    "m-0 mt-lg text-center text-sm coarse:text-base [color:var(--pulse-text-secondary,rgba(15,23,42,0.65))]";

const RegisterPage = () => {
    useTitle(composeBrandedTitle(microcopy.pageTitle.register), false);
    const location = useLocation();
    const [error, setError] = useState<Error | null | IError>(null);

    return (
        <>
            <AuthTitle>{microcopy.auth.registerTitle}</AuthTitle>
            <AuthSubtitle>{microcopy.auth.registerSubtitle}</AuthSubtitle>
            <RegisterForm onError={setError} serverError={error} />
            <p className={SWITCH_ROW_CLASS}>
                {microcopy.auth.switchToLogin}{" "}
                <Link
                    className="[color:var(--pulse-link)]"
                    state={location.state}
                    to="/login"
                >
                    {microcopy.actions.loginCta}
                </Link>
            </p>
        </>
    );
};

export default RegisterPage;
