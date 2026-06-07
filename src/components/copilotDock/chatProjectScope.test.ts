import { resolveChatProjectId } from "./ChatTabBody";

describe("resolveChatProjectId", () => {
    it("prefers the hydrated project document id", () => {
        expect(
            resolveChatProjectId(
                {
                    _id: "p-hydrated",
                    projectName: "Roadmap"
                } as never,
                ["p-route"]
            )
        ).toBe("p-hydrated");
    });

    it("falls back to the route-level id while the project query is loading", () => {
        expect(resolveChatProjectId(null, ["p-route"])).toBe("p-route");
    });

    it("returns empty when neither source is available", () => {
        expect(resolveChatProjectId(null, [])).toBe("");
        expect(resolveChatProjectId(null, ["", "  "])).toBe("");
    });
});
