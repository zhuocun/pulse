import { microcopy } from "../../constants/microcopy";
import { AuthSubtitle, AuthTitle } from "../../layouts/authLayout";
import useTitle, { composeBrandedTitle } from "../../utils/hooks/useTitle";

const TermsPage = () => {
    useTitle(composeBrandedTitle(microcopy.pageTitle.terms), false);

    return (
        <>
            <AuthTitle>{microcopy.auth.termsPageTitle}</AuthTitle>
            <AuthSubtitle>{microcopy.auth.termsPageBody}</AuthSubtitle>
        </>
    );
};

export default TermsPage;
