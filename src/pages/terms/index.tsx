import { microcopy } from "../../constants/microcopy";
import { AuthSubtitle, AuthTitle } from "../../layouts/authLayout";
import useTitle from "../../utils/hooks/useTitle";

const TermsPage = () => {
    useTitle(microcopy.auth.termsPageTitle);

    return (
        <>
            <AuthTitle>{microcopy.auth.termsPageTitle}</AuthTitle>
            <AuthSubtitle>{microcopy.auth.termsPageBody}</AuthSubtitle>
        </>
    );
};

export default TermsPage;
