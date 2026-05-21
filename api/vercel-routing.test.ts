/**
 * @jest-environment node
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("vercel.json API routing", () => {
    const config = JSON.parse(
        readFileSync(join(__dirname, "..", "vercel.json"), "utf-8")
    ) as {
        rewrites?: Array<{ source: string; destination: string }>;
    };

    it("rewrites nested /api/* paths to the single api/index function", () => {
        const apiRewrite = config.rewrites?.find((rule) =>
            rule.source.includes("/api/")
        );
        expect(apiRewrite).toEqual({
            source: "/api/:path*",
            destination: "/api"
        });
    });

    it("keeps SPA fallback from swallowing /api requests", () => {
        const spaRewrite = config.rewrites?.find((rule) =>
            rule.destination.includes("index.html")
        );
        expect(spaRewrite?.source).toMatch(/api/);
    });
});
