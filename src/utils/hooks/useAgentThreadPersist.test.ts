import {
    clearPersistedThreadStorage,
    readPersistedThread,
    threadStorageKey,
    writePersistedThread
} from "./useAgentThreadPersist";

describe("useAgentThreadPersist", () => {
    const KEY = threadStorageKey("board-coach", "p1");

    beforeEach(() => {
        try {
            sessionStorage.clear();
        } catch {
            // jsdom: ignore
        }
    });

    describe("threadStorageKey", () => {
        it("includes agent name and project id", () => {
            expect(threadStorageKey("board-coach", "p1")).toBe(
                "pulse.agentThread.board-coach.p1"
            );
        });

        it("uses 'none' when project id is omitted", () => {
            expect(threadStorageKey("search-agent")).toBe(
                "pulse.agentThread.search-agent.none"
            );
        });
    });

    describe("readPersistedThread / writePersistedThread", () => {
        it("round-trips a thread id through sessionStorage", () => {
            expect(readPersistedThread(KEY)).toBeUndefined();
            writePersistedThread(KEY, "t_roundtrip");
            expect(readPersistedThread(KEY)).toBe("t_roundtrip");
        });

        it("returns undefined when storage throws on read", () => {
            const getItem = jest
                .spyOn(Storage.prototype, "getItem")
                .mockImplementation(() => {
                    throw new Error("quota");
                });
            expect(readPersistedThread(KEY)).toBeUndefined();
            getItem.mockRestore();
        });

        it("no-ops when storage throws on write", () => {
            const setItem = jest
                .spyOn(Storage.prototype, "setItem")
                .mockImplementation(() => {
                    throw new Error("quota");
                });
            expect(() => writePersistedThread(KEY, "t_fail")).not.toThrow();
            expect(sessionStorage.getItem(KEY)).toBeNull();
            setItem.mockRestore();
        });
    });

    describe("clearPersistedThreadStorage", () => {
        it("removes a persisted thread id", () => {
            writePersistedThread(KEY, "t_clear");
            clearPersistedThreadStorage(KEY);
            expect(readPersistedThread(KEY)).toBeUndefined();
        });

        it("no-ops when storage throws on remove", () => {
            writePersistedThread(KEY, "t_stays");
            const removeItem = jest
                .spyOn(Storage.prototype, "removeItem")
                .mockImplementation(() => {
                    throw new Error("quota");
                });
            expect(() => clearPersistedThreadStorage(KEY)).not.toThrow();
            removeItem.mockRestore();
        });
    });
});
