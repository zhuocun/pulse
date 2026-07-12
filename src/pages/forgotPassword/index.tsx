import { Link } from "react-router";

import { microcopy } from "../../constants/microcopy";
import { AuthSubtitle, AuthTitle } from "../../layouts/authLayout";
import useTitle, { composeBrandedTitle } from "../../utils/hooks/useTitle";

const BACK_LINK_CLASS =
    "mt-lg inline-flex items-center text-base [color:var(--pulse-link)] coarse:min-h-[44px]";

const ForgotPasswordPage = () => {
    useTitle(composeBrandedTitle(microcopy.pageTitle.forgotPassword), false);

    return (
        <>
            <AuthTitle>
                {microcopy.auth.forgotPasswordPlaceholderTitle}
            </AuthTitle>
            <AuthSubtitle>
                {microcopy.auth.forgotPasswordPlaceholderBody}
            </AuthSubtitle>
            <Link className={BACK_LINK_CLASS} to="/login">
                {microcopy.auth.backToLogin}
            </Link>
        </>
    );
};

export default ForgotPasswordPage;
