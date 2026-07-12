import { Link } from "react-router";

import { AUTH_TERMS_PATH } from "../../constants/authPaths";
import { microcopy } from "../../constants/microcopy";

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
        <p className="mb-md text-sm leading-normal text-muted-foreground coarse:text-base">
            {prefix}{" "}
            <Link
                to={`/${AUTH_TERMS_PATH}`}
                className="text-primary underline-offset-4 hover:underline coarse:inline-flex coarse:min-h-[44px] coarse:items-center"
            >
                {microcopy.auth.termsLink}
            </Link>
            {suffix}
        </p>
    );
};
