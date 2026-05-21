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
        functions?: Record<string, { maxDuration?: number }>;
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

    it("registers only api/index.ts as a serverless function", () => {
        expect(Object.keys(config.functions ?? {})).toEqual(["api/index.ts"]);
    });
});

describe("api/index Vercel entrypoint", () => {
    it("default-exports the Node (req, res) proxy handler", async () => {
        const entry = await import("./index");
        expect(typeof entry.default).toBe("function");
        expect(entry.config?.runtime).toBe("nodejs");
        expect(entry.config?.api?.bodyParser).toBe(false);
    });
});
