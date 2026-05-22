// Playwright capture script for the Pulse UI/UX visual audit.
// Mocks every /api/v1/* endpoint inside the browser context because
// the JSON-server middleware is not running and the real API is blocked.
//
// Usage: node docs/design/_review-2026-05/_capture/capture.mjs

import { chromium, devices } from "playwright";
import path from "node:path";
import fs from "node:fs";

const ROOT = path.resolve(process.cwd());
const SHOTS_DIR = path.join(
    ROOT,
    "docs/design/_review-2026-05/screenshots"
);
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const BASE_URL = "http://localhost:3000";

// --- Mock fixtures ------------------------------------------------
const USER = {
    _id: "u-1",
    username: "Avery Chen",
    email: "avery@pulse.dev",
    likedProjects: ["p-1"],
    ai_jwt: "fake.jwt.token"
};
const MEMBERS = [
    { _id: "u-1", username: "Avery Chen", email: "avery@pulse.dev" },
    { _id: "u-2", username: "Bao Nguyen", email: "bao@pulse.dev" },
    { _id: "u-3", username: "Carla Diaz", email: "carla@pulse.dev" },
    { _id: "u-4", username: "Diego Park", email: "diego@pulse.dev" },
    { _id: "u-5", username: "Esme Tran", email: "esme@pulse.dev" }
];
const PROJECTS = [
    {
        _id: "p-1",
        projectName: "Onboarding Redesign 2026",
        managerId: "u-1",
        organization: "Growth Pod",
        createdAt: "2026-05-12T10:00:00Z"
    },
    {
        _id: "p-2",
        projectName: "Billing v3 migration",
        managerId: "u-2",
        organization: "Platform",
        createdAt: "2026-05-10T10:00:00Z"
    },
    {
        _id: "p-3",
        projectName: "AI Composer launch",
        managerId: "u-3",
        organization: "Copilot",
        createdAt: "2026-05-08T10:00:00Z"
    },
    {
        _id: "p-4",
        projectName: "Mobile native polish (Q2)",
        managerId: "u-4",
        organization: "Apps",
        createdAt: "2026-05-01T10:00:00Z"
    },
    {
        _id: "p-5",
        projectName: "Customer Health Dashboard",
        managerId: "u-5",
        organization: "Insights",
        createdAt: "2026-04-22T10:00:00Z"
    }
];
const COLUMNS = [
    { _id: "c-1", columnName: "Backlog", projectId: "p-1", index: 0 },
    { _id: "c-2", columnName: "In progress", projectId: "p-1", index: 1 },
    { _id: "c-3", columnName: "Code review", projectId: "p-1", index: 2 },
    { _id: "c-4", columnName: "Done", projectId: "p-1", index: 3 }
];
const TASKS = [
    {
        _id: "t-1",
        columnId: "c-1",
        coordinatorId: "u-2",
        epic: "Sign-up flow",
        taskName: "Audit current sign-up funnel for drop-off",
        type: "research",
        note: "Pull mixpanel data for the last 30d.",
        projectId: "p-1",
        storyPoints: 3,
        index: 0
    },
    {
        _id: "t-2",
        columnId: "c-1",
        coordinatorId: "u-3",
        epic: "Sign-up flow",
        taskName: "Draft 3 alt sign-up layouts (low-fi)",
        type: "design",
        note: "Try inline validation, magic link, and SSO-first variants.",
        projectId: "p-1",
        storyPoints: 5,
        index: 1
    },
    {
        _id: "t-3",
        columnId: "c-1",
        coordinatorId: "u-1",
        epic: "Backend",
        taskName: "Plan API contract for the new user table",
        type: "feature",
        note: "",
        projectId: "p-1",
        storyPoints: 5,
        index: 2
    },
    {
        _id: "t-4",
        columnId: "c-2",
        coordinatorId: "u-2",
        epic: "Sign-up flow",
        taskName: "Implement magic-link sign-up endpoint",
        type: "feature",
        note: "Wire up Postmark templates and confirm token TTL is 15 min.",
        projectId: "p-1",
        storyPoints: 8,
        index: 0
    },
    {
        _id: "t-5",
        columnId: "c-2",
        coordinatorId: "u-4",
        epic: "Sign-up flow",
        taskName: "Move email-template rendering to background worker",
        type: "chore",
        note: "",
        projectId: "p-1",
        storyPoints: 3,
        index: 1
    },
    {
        _id: "t-6",
        columnId: "c-3",
        coordinatorId: "u-3",
        epic: "Sign-up flow",
        taskName: "PR #1422 — inline validation refactor",
        type: "feature",
        note: "Waiting on a second approval.",
        projectId: "p-1",
        storyPoints: 2,
        index: 0
    },
    {
        _id: "t-7",
        columnId: "c-4",
        coordinatorId: "u-1",
        epic: "Sign-up flow",
        taskName: "Drafted the kickoff doc",
        type: "doc",
        note: "Linked from the project page.",
        projectId: "p-1",
        storyPoints: 1,
        index: 0
    },
    {
        _id: "t-8",
        columnId: "c-4",
        coordinatorId: "u-5",
        epic: "Backend",
        taskName: "Shipped the new audit-log table",
        type: "feature",
        note: "",
        projectId: "p-1",
        storyPoints: 5,
        index: 1
    }
];

const NOW = Date.now();

// Each route handler returns a JSON body. Match is by URL substring.
const handle = (url, method) => {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/api\/v1\//, "");

    // Auth
    if (p === "auth/login") {
        return { status: 200, body: USER };
    }
    if (p === "auth/register") {
        return { status: 200, body: USER };
    }
    if (p === "auth/logout") {
        return { status: 200, body: "ok" };
    }
    if (p === "auth/me") {
        return { status: 200, body: USER };
    }
    if (p === "auth/forgot-password" || p === "auth/recover") {
        return { status: 200, body: { ok: true } };
    }

    // Session probe
    if (p === "users") {
        return { status: 200, body: USER };
    }
    if (p === "users/members") {
        return { status: 200, body: MEMBERS };
    }

    // Projects
    if (p === "projects" && method === "GET") {
        const projectId = u.searchParams.get("projectId");
        if (projectId) {
            const project = PROJECTS.find((p) => p._id === projectId);
            return { status: 200, body: project ?? null };
        }
        return { status: 200, body: PROJECTS };
    }
    if (p === "projects" && (method === "POST" || method === "PUT")) {
        return { status: 200, body: "ok" };
    }

    // Boards (columns)
    if (p === "boards" && method === "GET") {
        return { status: 200, body: COLUMNS };
    }
    if (p === "boards" && (method === "POST" || method === "PUT")) {
        return { status: 200, body: "ok" };
    }

    // Tasks
    if (p === "tasks" && method === "GET") {
        const projectId = u.searchParams.get("projectId");
        const taskId = u.searchParams.get("taskId");
        if (taskId) {
            const task = TASKS.find((t) => t._id === taskId);
            return { status: 200, body: task ?? null };
        }
        if (projectId) {
            return {
                status: 200,
                body: TASKS.filter((t) => t.projectId === projectId)
            };
        }
        return { status: 200, body: TASKS };
    }
    if (p === "tasks" && (method === "POST" || method === "PUT")) {
        return { status: 200, body: "ok" };
    }

    // AI / agent fallbacks (avoid noisy errors)
    if (p.startsWith("agents/") || p.startsWith("ai/")) {
        return { status: 200, body: { ok: true } };
    }

    // Default 200 to keep render going
    return { status: 200, body: {} };
};

const installMocks = async (context, { authed = true } = {}) => {
    await context.route("**/api/v1/**", async (route, request) => {
        const u = new URL(request.url());
        const p = u.pathname.replace(/^\/api\/v1\//, "");
        // For unauth pages, mock the session probe with 401 so the
        // user stays on /login or /register without being redirected.
        if (!authed && p === "users") {
            await route.fulfill({
                status: 401,
                contentType: "application/json",
                body: JSON.stringify({ error: "Not authenticated" })
            });
            return;
        }
        const r = handle(request.url(), request.method());
        await route.fulfill({
            status: r.status,
            contentType: "application/json",
            body: JSON.stringify(r.body)
        });
    });
    // Stub external font requests so cert errors don't slow us down
    await context.route(/https:\/\/(fonts\.|cdn\.|api\.)/, (route) =>
        route.fulfill({ status: 200, contentType: "text/plain", body: "" })
    );
};

const setColorScheme = async (page, scheme) => {
    await page.emulateMedia({ colorScheme: scheme });
};

const seedColorScheme = async (context, scheme) => {
    await context.addInitScript((s) => {
        try {
            window.localStorage.setItem("ui:colorScheme", s);
        } catch (e) {}
    }, scheme);
};

const VIEWPORTS = {
    "iphone13": { width: 390, height: 844, device: "iPhone 13" },
    "iphoneSE": { width: 375, height: 667, device: "iPhone SE" },
    "pixel7": { width: 412, height: 915, device: "Pixel 7" },
    "ipadPortrait": { width: 768, height: 1024 },
    "ipadLandscape": { width: 1024, height: 768 },
    "desktop": { width: 1280, height: 800 },
    "wide": { width: 1920, height: 1080 }
};

const seedAuth = async (context) => {
    // Cookie-based auth (HttpOnly Token) — but the FE only treats users as
    // authenticated when the cached `users` query is populated. We instead
    // just keep mocks returning the user, and prepopulate localStorage.
    await context.addInitScript(() => {
        try {
            window.sessionStorage.setItem("ai_jwt", "fake.jwt.token");
        } catch (e) {}
    });
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const safeShot = async (page, name) => {
    const filePath = path.join(SHOTS_DIR, `${name}.png`);
    try {
        // The app sets `body { overflow-y: auto }` (a side-effect of
        // overflow-x: hidden on body), so the document scroller is body,
        // not <html>. fullPage screenshots use documentElement.scrollHeight
        // (== viewport height here), which clips content. Resize the
        // viewport tall enough to render everything, take the shot, then
        // restore.
        const measure = await page.evaluate(() => ({
            bodyHeight: document.body.scrollHeight,
            innerHeight: window.innerHeight,
            innerWidth: window.innerWidth
        }));
        const ts = Math.min(Math.max(measure.bodyHeight, measure.innerHeight), 6000);
        if (ts > measure.innerHeight + 8) {
            await page.setViewportSize({ width: measure.innerWidth, height: ts });
            await page.waitForTimeout(200);
        }
        await page.screenshot({
            path: filePath,
            fullPage: true,
            animations: "disabled"
        });
        console.log("  captured", name);
    } catch (e) {
        console.error("  failed", name, e.message);
    }
};

const run = async () => {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });

    const captures = [
        // [routeSlug, urlPath, viewportKey, scheme, postLoadHook]
        // ---- Auth flow (unauth)
        ["login", "/login", "iphone13", "light"],
        ["login", "/login", "iphone13", "dark"],
        ["login", "/login", "desktop", "light"],
        ["login", "/login", "iphoneSE", "light"],
        ["register", "/register", "iphone13", "light"],
        ["register", "/register", "desktop", "light"],
        ["forgot-password", "/auth/forgot-password", "iphone13", "light"],

        // ---- Projects list (auth)
        ["projects", "/projects", "iphone13", "light", "auth"],
        ["projects", "/projects", "iphone13", "dark", "auth"],
        ["projects", "/projects", "iphoneSE", "light", "auth"],
        ["projects", "/projects", "pixel7", "light", "auth"],
        ["projects", "/projects", "ipadPortrait", "light", "auth"],
        ["projects", "/projects", "ipadLandscape", "light", "auth"],
        ["projects", "/projects", "desktop", "light", "auth"],
        ["projects", "/projects", "desktop", "dark", "auth"],
        ["projects", "/projects", "wide", "light", "auth"],

        // ---- Project modal open (create)
        ["projects-modal-create", "/projects", "iphone13", "light", "auth-then-create"],
        ["projects-modal-create", "/projects", "desktop", "light", "auth-then-create"],

        // ---- Board
        ["board", "/projects/p-1/board", "iphone13", "light", "auth"],
        ["board", "/projects/p-1/board", "ipadPortrait", "light", "auth"],
        ["board", "/projects/p-1/board", "desktop", "light", "auth"],
        ["board", "/projects/p-1/board", "desktop", "dark", "auth"],
        ["board", "/projects/p-1/board", "wide", "light", "auth"],

        // ---- Board, task modal open
        ["board-task-detail", "/projects/p-1/board", "iphone13", "light", "auth-then-task"],
        ["board-task-detail", "/projects/p-1/board", "desktop", "light", "auth-then-task"],

        // ---- Board, AI brief drawer
        ["board-brief-drawer", "/projects/p-1/board", "desktop", "light", "auth-then-brief"],

        // ---- Command palette open (Cmd+K)
        ["command-palette", "/projects", "desktop", "light", "auth-then-palette"],

        // ---- AI chat drawer open
        ["ai-chat-drawer", "/projects", "desktop", "light", "auth-then-chat"],
        ["ai-chat-drawer", "/projects", "iphone13", "light", "auth-then-chat"],

        // ---- 404
        ["not-found", "/this-route-does-not-exist", "desktop", "light", "auth"]
    ];

    for (const [
        slug,
        urlPath,
        viewportKey,
        scheme,
        hook
    ] of captures) {
        const vp = VIEWPORTS[viewportKey];
        const isPhone = vp.width < 600;
        const contextOptions = {
            viewport: { width: vp.width, height: vp.height },
            colorScheme: scheme,
            deviceScaleFactor: 2,
            hasTouch: isPhone,
            isMobile: isPhone,
            userAgent: isPhone
                ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
                : undefined
        };
        const context = await browser.newContext(contextOptions);
        const isAuthedScenario = !!hook && hook.startsWith("auth");
        if (isAuthedScenario) await seedAuth(context);
        await seedColorScheme(context, scheme);
        await installMocks(context, { authed: isAuthedScenario });
        const page = await context.newPage();
        page.on("console", (m) => {
            // silence
        });
        await setColorScheme(page, scheme);

        const isAuthHook = !!hook && hook.startsWith("auth");
        const initialUrl = isAuthHook
            ? `${BASE_URL}/login`
            : `${BASE_URL}${urlPath}`;
        try {
            await page.goto(initialUrl, {
                waitUntil: "domcontentloaded",
                timeout: 20000
            });
            await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
            // Wait for the spinner to clear.
            await page.waitForFunction(
                () => {
                    const status = document.querySelectorAll('[role="status"]');
                    for (const el of status) {
                        if (
                            el.textContent &&
                            el.textContent.toLowerCase().includes("loading")
                        ) {
                            return false;
                        }
                    }
                    return true;
                },
                { timeout: 12000 }
            ).catch(() => {});
            await sleep(800);

            // For authed routes: SPA-navigate via react-router (we
            // hit /login first to warm the cache and authenticate, then
            // change the URL using history.pushState which react-router
            // 7 picks up automatically via the BrowserRouter listener).
            if (isAuthHook && urlPath !== "/projects" && urlPath !== "/login") {
                try {
                    // Use react-router's navigation via a synthetic click
                    // on the Pulse brand mark which is itself a NavLink.
                    // Fall back to history.pushState + popstate.
                    await page.evaluate((u) => {
                        // BrowserRouter listens to popstate, but pushState
                        // alone does not fire popstate. Use replaceState +
                        // dispatch a synthetic event that's the convention.
                        window.history.pushState({}, "", u);
                        window.dispatchEvent(new PopStateEvent("popstate"));
                    }, urlPath);
                    await sleep(2000);
                    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
                    await page.waitForFunction(() => {
                        const status = document.querySelectorAll('[role="status"]');
                        for (const el of status) {
                            if (
                                el.textContent &&
                                el.textContent.toLowerCase().includes("loading")
                            ) {
                                return false;
                            }
                        }
                        return true;
                    }, { timeout: 8000 }).catch(() => {});
                    await sleep(800);
                } catch (e) {
                    console.log("    spa-nav failed:", e.message);
                }
            }

            if (hook === "auth-then-create") {
                // Click "Create project" CTA
                try {
                    const btn = page.locator('button:has-text("Create project")').first();
                    await btn.click({ timeout: 3000 });
                    await sleep(500);
                } catch (e) {
                    console.log("    create modal click failed:", e.message);
                }
            }
            if (hook === "auth-then-task") {
                try {
                    // Click first task card. Tasks have class via Card; try by task name.
                    const card = page
                        .locator("text=Audit current sign-up funnel for drop-off")
                        .first();
                    await card.click({ timeout: 4000 });
                    await sleep(700);
                } catch (e) {
                    console.log("    task click failed:", e.message);
                }
            }
            if (hook === "auth-then-brief") {
                try {
                    // Look for board brief button
                    const briefBtn = page
                        .locator('button:has-text("Brief"), [data-testid*="brief"]')
                        .first();
                    await briefBtn.click({ timeout: 3000 });
                    await sleep(700);
                } catch (e) {
                    console.log("    brief open failed:", e.message);
                }
            }
            if (hook === "auth-then-palette") {
                await page.keyboard.press("Control+K");
                await sleep(500);
            }
            if (hook === "auth-then-chat") {
                try {
                    const askBtn = page
                        .locator('button:has-text("Ask"), button[aria-label*="copilot" i], button[aria-label*="Ask" i]')
                        .first();
                    await askBtn.click({ timeout: 3000 });
                    await sleep(700);
                } catch (e) {
                    console.log("    chat open failed:", e.message);
                }
            }

            await safeShot(
                page,
                `${slug}__${viewportKey}__${scheme}`
            );
        } catch (e) {
            console.error("  page failed", slug, viewportKey, e.message);
            await safeShot(page, `ERROR-${slug}__${viewportKey}__${scheme}`);
        } finally {
            await context.close();
        }
    }

    await browser.close();
    console.log("done.");
};

run().catch((e) => {
    console.error("fatal", e);
    process.exit(1);
});
