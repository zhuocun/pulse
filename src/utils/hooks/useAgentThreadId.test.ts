import { generateThreadId, TTFT_SLO_MS } from "./useAgentThreadId";

describe("useAgentThreadId", () => {
    describe("generateThreadId", () => {
        it("prefixes ids with t_", () => {
            expect(generateThreadId()).toMatch(/^t_/);
        });

        it("uses crypto.randomUUID when available", () => {
            const randomUUID = jest.fn(() => "uuid-abc");
            const original = globalThis.crypto;
            Object.defineProperty(globalThis, "crypto", {
                value: { randomUUID },
                configurable: true
            });
            try {
                expect(generateThreadId()).toBe("t_uuid-abc");
                expect(randomUUID).toHaveBeenCalledTimes(1);
            } finally {
                Object.defineProperty(globalThis, "crypto", {
                    value: original,
                    configurable: true
                });
            }
        });

        it("falls back when crypto.randomUUID is missing", () => {
            const original = globalThis.crypto;
            Object.defineProperty(globalThis, "crypto", {
                value: {},
                configurable: true
            });
            try {
                const id = generateThreadId();
                expect(id).toMatch(/^t_[a-z0-9]+_[a-z0-9]+$/);
            } finally {
                Object.defineProperty(globalThis, "crypto", {
                    value: original,
                    configurable: true
                });
            }
        });
    });

    describe("TTFT_SLO_MS", () => {
        it("is 1500ms", () => {
            expect(TTFT_SLO_MS).toBe(1500);
        });
    });
});
