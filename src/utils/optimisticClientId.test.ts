import {
    createOptimisticClientId,
    isOptimisticPlaceholderId
} from "./optimisticClientId";

describe("optimisticClientId", () => {
    describe("createOptimisticClientId", () => {
        it("returns a string prefixed with 'tmp-'", () => {
            const id = createOptimisticClientId();
            expect(id.startsWith("tmp-")).toBe(true);
        });

        it("generates unique ids across many invocations", () => {
            const ids = new Set(
                Array.from({ length: 50 }, () => createOptimisticClientId())
            );
            expect(ids.size).toBe(50);
        });

        it("uses crypto.randomUUID when available", () => {
            const spy = jest
                .spyOn(crypto, "randomUUID")
                .mockReturnValue("00000000-0000-0000-0000-000000000001");
            try {
                expect(createOptimisticClientId()).toBe(
                    "tmp-00000000-0000-0000-0000-000000000001"
                );
            } finally {
                spy.mockRestore();
            }
        });

        it("falls back to Date.now + random when randomUUID is absent", () => {
            const original = (crypto as unknown as { randomUUID?: unknown })
                .randomUUID;
            (crypto as unknown as { randomUUID?: unknown }).randomUUID =
                undefined;
            try {
                const id = createOptimisticClientId();
                expect(id).toMatch(/^tmp-\d+-[a-z0-9]+$/);
            } finally {
                (crypto as unknown as { randomUUID?: unknown }).randomUUID =
                    original;
            }
        });
    });

    describe("isOptimisticPlaceholderId", () => {
        it("matches the legacy 'mock' literal", () => {
            expect(isOptimisticPlaceholderId("mock")).toBe(true);
        });

        it("matches a freshly-generated tmp- id", () => {
            expect(isOptimisticPlaceholderId(createOptimisticClientId())).toBe(
                true
            );
        });

        it("rejects server ids", () => {
            expect(isOptimisticPlaceholderId("abc123")).toBe(false);
            expect(isOptimisticPlaceholderId("64f1d0e5b8b4f1a9c8e7f0a1")).toBe(
                false
            );
        });

        it("rejects null / undefined / empty string", () => {
            expect(isOptimisticPlaceholderId(null)).toBe(false);
            expect(isOptimisticPlaceholderId(undefined)).toBe(false);
            expect(isOptimisticPlaceholderId("")).toBe(false);
        });
    });
});
