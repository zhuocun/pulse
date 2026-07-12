export type PasswordStrengthLevel =
    | "empty"
    | "tooShort"
    | "weak"
    | "fair"
    | "strong";

const countCharacterClasses = (value: string): number =>
    [
        /[a-z]/.test(value),
        /[A-Z]/.test(value),
        /\d/.test(value),
        /[^A-Za-z0-9]/.test(value)
    ].filter(Boolean).length;

/**
 * Offline heuristic aligned with the register field's minimum length (8) and
 * common password guidance (mix of character classes).
 */
export const assessPasswordStrength = (raw: string): PasswordStrengthLevel => {
    if (!raw) return "empty";
    const len = raw.length;
    const classes = countCharacterClasses(raw);
    if (len < 8) return "tooShort";
    if (classes <= 1) return "weak";
    if (classes >= 3 && len >= 10) return "strong";
    if (classes >= 2) return "fair";
    return "weak";
};

export const passwordStrengthMeterValue = (
    level: PasswordStrengthLevel
): number => {
    switch (level) {
        case "empty":
            return 0;
        case "tooShort":
            return 1;
        case "weak":
            return 2;
        case "fair":
            return 3;
        case "strong":
            return 4;
        default:
            return 0;
    }
};
