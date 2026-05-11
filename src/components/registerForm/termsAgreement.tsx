import styled from "@emotion/styled";
import { Link } from "react-router";

import { AUTH_TERMS_PATH } from "../../constants/authPaths";
import { microcopy } from "../../constants/microcopy";
import { fontSize, space } from "../../theme/tokens";

const Wrapper = styled.p`
    color: var(--ant-color-text-secondary, rgba(15, 23, 42, 0.6));
    font-size: ${fontSize.sm}px;
    margin: 0 0 ${space.md}px;
    line-height: 1.5;
`;

const TermsLink = styled(Link)`
    font-size: inherit;
`;

export const AuthTermsAgreement = ({
    variant
}: {
    variant: "login" | "register";
}) => {
    const prefix =
        variant === "login"
            ? microcopy.auth.termsLoginPrefix
            : microcopy.auth.termsRegisterPrefix;
    const suffix =
        variant === "login"
            ? microcopy.auth.termsLoginSuffix
            : microcopy.auth.termsRegisterSuffix;

    return (
        <Wrapper>
            {prefix}{" "}
            <TermsLink to={`/${AUTH_TERMS_PATH}`}>
                {microcopy.auth.termsLink}
            </TermsLink>
            {suffix}
        </Wrapper>
    );
};
