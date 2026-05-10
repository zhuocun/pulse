import { microcopy } from "../../constants/microcopy";
import { AuthSubtitle, AuthTitle } from "../../layouts/authLayout";
import useTitle from "../../utils/hooks/useTitle";

const ForgotPasswordPage = () => {
    useTitle(microcopy.auth.forgotPasswordPlaceholderTitle);

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
