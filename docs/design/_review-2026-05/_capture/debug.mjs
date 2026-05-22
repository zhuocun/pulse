import { chromium } from "playwright";

const run = async () => {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const ctx = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        colorScheme: "light"
    });
    const page = await ctx.newPage();
    page.on("request", (r) => console.log("REQ", r.method(), r.url()));
    page.on("response", (r) => console.log("RES", r.status(), r.url()));
    page.on("console", (m) => console.log("LOG", m.type(), m.text()));
    page.on("pageerror", (e) => console.log("ERR", e.message));

    await page.route("**/api/v1/**", async (route, request) => {
        console.log("MOCK", request.method(), request.url());
        const u = new URL(request.url());
        const p = u.pathname.replace(/^\/api\/v1\//, "");
        let body = {};
        if (p === "users") body = { _id: "u-1", username: "Avery", email: "a@b.c", likedProjects: [], ai_jwt: "x" };
        else if (p === "users/members") body = [];
        else if (p === "projects") body = [];
        else if (p === "boards") body = [];
        else if (p === "tasks") body = [];
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });

    // expose a hook into the queryclient
    await page.addInitScript(() => {
        const orig = window.fetch;
        window.fetch = async (...args) => {
            const r = await orig(...args);
            console.log("FETCH", r.status, r.url);
            return r;
        };
    });
    await page.goto("http://localhost:3000/projects", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(8000);
    const html = await page.content();
    console.log("HTML LEN", html.length);
    const status = await page.locator('[role="status"]').allTextContents();
    console.log("status:", JSON.stringify(status));
    // Probe react-query state
    const qcInfo = await page.evaluate(() => {
        // not directly accessible, but render-id roots may help
        return {
            url: location.href,
            spinCount: document.querySelectorAll('[role="status"]').length,
            visibleTexts: Array.from(document.body.querySelectorAll("*"))
                .slice(0, 30)
                .map((n) => n.tagName + " " + (n.textContent || "").slice(0, 60))
        };
    });
    console.log("PROBE:", JSON.stringify(qcInfo, null, 2));
    await page.screenshot({ path: "/tmp/debug.png", fullPage: true });
    await browser.close();
};

run();
