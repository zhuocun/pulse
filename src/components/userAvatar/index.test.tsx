import { render, screen } from "@testing-library/react";

import { avatarGradients } from "../../theme/tokens";

import UserAvatar, { gradientFor, initialsOf } from "./index";

describe("initialsOf", () => {
    it("falls back to '?' for empty / nullish input", () => {
        expect(initialsOf(undefined)).toBe("?");
        expect(initialsOf(null)).toBe("?");
        expect(initialsOf("")).toBe("?");
    });

    it("uses the single capitalised initial for one-word names", () => {
        expect(initialsOf("alice")).toBe("A");
        expect(initialsOf("Bob")).toBe("B");
    });

    it("combines first and last initials for multi-part names", () => {
        expect(initialsOf("Alice Smith")).toBe("AS");
        expect(initialsOf("john quincy adams")).toBe("JA");
    });

    it("trims surrounding whitespace before splitting", () => {
        expect(initialsOf("   Carla   Diaz  ")).toBe("CD");
    });
});

describe("gradientFor", () => {
    it("returns one of the brand-aligned avatar gradients", () => {
        expect(avatarGradients).toContain(gradientFor("p-1"));
        expect(avatarGradients).toContain(gradientFor("member-42"));
    });

    it("is deterministic for a given id", () => {
        expect(gradientFor("project-7")).toBe(gradientFor("project-7"));
    });

    it("returns a non-empty gradient for edge-case ids (empty, very long, emoji, CJK)", () => {
        ["", "0".repeat(200), "🤖", "你好"].forEach((id) => {
            const gradient = gradientFor(id);
            expect(typeof gradient).toBe("string");
            expect(gradient.length).toBeGreaterThan(0);
        });
    });
});

describe("initialsOf — edge cases", () => {
    it("returns a non-empty string for emoji-only names", () => {
        const result = initialsOf("🤖");
        expect(typeof result).toBe("string");
        expect(result.length).toBeGreaterThan(0);
    });
});

describe("UserAvatar", () => {
    it("renders the icon fallback when no name is supplied", () => {
        const { container } = render(<UserAvatar id="p-1" />);
        // Initials should not appear — the AntD UserOutlined glyph takes over.
        expect(container.textContent ?? "").toBe("");
        expect(container.querySelector("svg")).toBeInTheDocument();
    });

    it("renders the derived initials when a name is supplied", () => {
        render(<UserAvatar id="m-1" name="Alice Smith" />);
        expect(screen.getByText("AS")).toBeInTheDocument();
    });

    it("treats whitespace-only names as the default 'unknown user'", () => {
        const { container } = render(<UserAvatar id="m-2" name="   " />);
        expect(container.textContent ?? "").toBe("");
    });
});
