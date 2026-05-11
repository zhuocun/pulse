import {
    assessPasswordStrength,
    passwordStrengthMeterValue
} from "../constants/passwordStrength";

describe("assessPasswordStrength", () => {
    it('returns empty for ""', () => {
        expect(assessPasswordStrength("")).toBe("empty");
    });

    it("returns tooShort when below the 8-character rule", () => {
        expect(assessPasswordStrength("Aa1")).toBe("tooShort");
    });

    it("returns weak when long enough but not enough character classes", () => {
        expect(assessPasswordStrength("alllowercase")).toBe("weak");
    });

    it("returns fair when two classes meet the minimum length", () => {
        expect(assessPasswordStrength("Password")).toBe("fair");
    });

    it("returns strong when complexity and length thresholds are met", () => {
        expect(assessPasswordStrength("Password99")).toBe("strong");
    });

    it("maps levels to deterministic meter widths", () => {
        expect(passwordStrengthMeterValue("empty")).toBe(0);
        expect(passwordStrengthMeterValue("tooShort")).toBe(1);
        expect(passwordStrengthMeterValue("weak")).toBe(2);
        expect(passwordStrengthMeterValue("fair")).toBe(3);
        expect(passwordStrengthMeterValue("strong")).toBe(4);
    });
});
