import styled from "@emotion/styled";

import {
    PasswordStrengthLevel,
    assessPasswordStrength,
    passwordStrengthMeterValue
} from "../../constants/passwordStrength";
import { microcopy } from "../../constants/microcopy";
import { bodyCopyCoarseFontCss } from "../../theme/tokens";

const StrengthBlock = styled.div`
    margin-bottom: 4px;
`;

const BarTrack = styled.div`
    block-size: 6px;
    border-radius: 3px;
    background: var(--ant-color-fill-secondary, rgba(15, 23, 42, 0.08));
    overflow: hidden;
    inline-size: 100%;
`;

const BarFill = styled.div<{ $color: string; $value: number }>`
    block-size: 100%;
    border-radius: inherit;
    background: ${(p) => p.$color};
    inline-size: ${(p) => (p.$value / 4) * 100}%;

    @media (prefers-reduced-motion: no-preference) {
        transition:
            inline-size 160ms ease-out,
            background-color 160ms ease-out;
    }
`;

const StrengthText = styled.span`
    display: block;
    margin-top: 6px;
    color: var(--ant-color-text-secondary);
    ${bodyCopyCoarseFontCss}
    line-height: 1.4;
`;

const strengthCaption = (level: Exclude<PasswordStrengthLevel, "empty">) => {
    switch (level) {
        case "tooShort":
            return microcopy.auth.passwordStrength.tooShort;
        case "weak":
            return microcopy.auth.passwordStrength.weak;
        case "fair":
            return microcopy.auth.passwordStrength.fair;
        case "strong":
            return microcopy.auth.passwordStrength.strong;
        default:
            return "";
    }
};

const strengthColor = (
    level: Exclude<PasswordStrengthLevel, "empty">
): string => {
    switch (level) {
        case "tooShort":
            return "var(--ant-color-error, #ff4d4f)";
        case "weak":
            return "var(--ant-color-warning, #faad14)";
        case "fair":
            return "var(--ant-color-info, #1677ff)";
        case "strong":
            return "var(--ant-color-success, #52c41a)";
        default:
            return "var(--ant-color-primary, #1677ff)";
    }
};

export const PasswordStrengthHint = ({ password }: { password: string }) => {
    const level = assessPasswordStrength(password);

    if (level === "empty") {
        return null;
    }

    const caption = strengthCaption(level);
    const value = passwordStrengthMeterValue(level);
    const fullLabel = `${microcopy.auth.passwordStrength.meterAriaLabel}: ${caption}`;

    return (
        <StrengthBlock>
            <BarTrack aria-hidden>
                <BarFill $color={strengthColor(level)} $value={value} />
            </BarTrack>
            <StrengthText
                aria-atomic="true"
                aria-label={fullLabel}
                aria-live="polite"
                role="status"
            >
                {caption}
            </StrengthText>
        </StrengthBlock>
    );
};
