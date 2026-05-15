import {
    assessPasswordStrength,
    passwordStrengthMeterValue,
    type PasswordStrengthLevel
} from "./passwordStrength";

describe("assessPasswordStrength", () => {
    it("returns 'empty' for empty / falsy input", () => {
        expect(assessPasswordStrength("")).toBe("empty");
    });

    it("returns 'tooShort' for any non-empty string below 8 chars", () => {
        expect(assessPasswordStrength("a")).toBe("tooShort");
        expect(assessPasswordStrength("Abc123!")).toBe("tooShort");
    });

    it("returns 'weak' when only one character class is present", () => {
        // 8 chars, only lowercase letters
        expect(assessPasswordStrength("abcdefgh")).toBe("weak");
        // 8 chars, only digits
        expect(assessPasswordStrength("12345678")).toBe("weak");
    });

    it("returns 'fair' for two classes or three classes under 10 chars", () => {
        expect(assessPasswordStrength("Abcdefgh")).toBe("fair");
        expect(assessPasswordStrength("Abc12345")).toBe("fair");
    });

    it("returns 'strong' for 10+ chars with 3+ character classes", () => {
        expect(assessPasswordStrength("Abcdefgh12")).toBe("strong");
        expect(assessPasswordStrength("Abcdef!@#1")).toBe("strong");
    });

    it("treats >=3 classes but length <10 as 'fair' (length still matters)", () => {
        expect(assessPasswordStrength("Abc1!xyz")).toBe("fair");
    });
});

describe("passwordStrengthMeterValue", () => {
    const expected: Record<PasswordStrengthLevel, number> = {
        empty: 0,
        tooShort: 1,
        weak: 2,
        fair: 3,
        strong: 4
    };

    it.each(Object.entries(expected) as [PasswordStrengthLevel, number][])(
        "maps %s to %s",
        (level, value) => {
            expect(passwordStrengthMeterValue(level)).toBe(value);
        }
    );

    it("returns 0 for unknown levels via the default branch", () => {
        // Intentionally cast — exercises the `default` arm of the switch.
        expect(
            passwordStrengthMeterValue(
                "unknown" as unknown as PasswordStrengthLevel
            )
        ).toBe(0);
    });
});
