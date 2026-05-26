import styled from "@emotion/styled";
import { Link } from "react-router";

import { microcopy } from "../../constants/microcopy";
import { AuthSubtitle, AuthTitle } from "../../layouts/authLayout";
import { fontSize, space, touchTargetCoarse } from "../../theme/tokens";
import useTitle, { composeBrandedTitle } from "../../utils/hooks/useTitle";

const BackLink = styled(Link)`
    align-items: center;
    color: var(--ant-color-link);
    display: inline-flex;
    font-size: ${fontSize.base}px;
    margin-top: ${space.lg}px;

    @media (pointer: coarse) {
        min-height: ${touchTargetCoarse}px;
    }
`;

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
            <BackLink to="/login">{microcopy.auth.backToLogin}</BackLink>
        </>
    );
};

export default ForgotPasswordPage;
