import { microcopy } from "../../constants/microcopy";
import { AuthSubtitle, AuthTitle } from "../../layouts/authLayout";
import useTitle, { composeBrandedTitle } from "../../utils/hooks/useTitle";

const ForgotPasswordPage = () => {
    useTitle(composeBrandedTitle(microcopy.pageTitle.forgotPassword));

    return (
        <>
            <AuthTitle>
                {microcopy.auth.forgotPasswordPlaceholderTitle}
            </AuthTitle>
            <AuthSubtitle>
                {microcopy.auth.forgotPasswordPlaceholderBody}
            </AuthSubtitle>
        </>
    );
};

export default ForgotPasswordPage;
