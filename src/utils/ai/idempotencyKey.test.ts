import { newIdempotencyKey } from "./idempotencyKey";

describe("newIdempotencyKey", () => {
    it("returns crypto.randomUUID when available", () => {
        const spy = jest
            .spyOn(crypto, "randomUUID")
            .mockReturnValue("11111111-2222-4333-8444-555555555555");
        try {
            expect(newIdempotencyKey()).toBe(
                "11111111-2222-4333-8444-555555555555"
            );
        } finally {
            spy.mockRestore();
        }
    });

    it("falls back to a UUIDv4-shaped string when randomUUID is absent", () => {
        const original = (crypto as unknown as { randomUUID?: unknown })
            .randomUUID;
        (crypto as unknown as { randomUUID?: unknown }).randomUUID = undefined;
        try {
            const key = newIdempotencyKey();
            // 8-4-4-4-12 hex with v4 marker (third group starts with 4) and
            // variant marker (fourth group starts with 8/9/a/b).
            expect(key).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            );
        } finally {
            (crypto as unknown as { randomUUID?: unknown }).randomUUID =
                original;
        }
    });

    it("generates a fresh key on every invocation", () => {
        const keys = new Set(
            Array.from({ length: 25 }, () => newIdempotencyKey())
        );
        expect(keys.size).toBe(25);
    });

    it("falls back when randomUUID throws", () => {
        const spy = jest.spyOn(crypto, "randomUUID").mockImplementation(() => {
            throw new Error("blocked");
        });
        try {
            const key = newIdempotencyKey();
            expect(typeof key).toBe("string");
            expect(key.length).toBeGreaterThan(0);
        } finally {
            spy.mockRestore();
        }
    });
});
