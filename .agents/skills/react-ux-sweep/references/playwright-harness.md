# Playwright harness for the UX sweep

Recipes for the screenshot script. Reuse these verbatim — the four
critical traps below cost a fix attempt each before they were
documented.

## Environment

- Vite dev server runs on `http://localhost:3000` after `npm start`.
- Playwright lives at `/opt/node22/lib/node_modules/playwright/index.js`
  as a CommonJS build. Import as:
    ```js
    import pw from "/opt/node22/lib/node_modules/playwright/index.js";
    const { chromium } = pw;
    ```
- Chromium binaries are pre-installed under `/opt/pw-browsers/`. No
  download step needed.
- The remote API at `https://pulse-python-server.vercel.app` returns
  403 from this environment, so mock everything inside Playwright.

## Mock contract

Mirror the **frontend's** intended contract, not
`__json_server_mock__/db.json` (which predates the current shapes).
Auth header is required on every endpoint except `/auth/*`. Pre-seed
`localStorage.Token = "demo"` before navigating to authenticated
routes.

| Method       | Path                                | Response                                                          |
| ------------ | ----------------------------------- | ----------------------------------------------------------------- |
| POST         | `/api/v1/auth/login`                | `IUser` (single, includes `jwt`)                                  |
| POST         | `/api/v1/auth/register`             | 201 `{ message }`                                                 |
| GET          | `/api/v1/users`                     | single `IUser`                                                    |
| GET          | `/api/v1/users/members`             | `IMember[]`                                                       |
| GET          | `/api/v1/projects` (no `projectId`) | `IProject[]`; honor `?projectName=` and `?managerId=` filters     |
| GET          | `/api/v1/projects?projectId=p1`     | **single** `IProject` (board.tsx expects an object, not an array) |
| POST         | `/api/v1/projects`                  | 201 single `IProject`                                             |
| PATCH/DELETE | `/api/v1/projects/:id`              | 200 `{ ok: true }`                                                |
| GET          | `/api/v1/boards?projectId=`         | `IColumn[]`                                                       |
| GET          | `/api/v1/tasks?projectId=`          | `ITask[]`                                                         |
| GET          | `/api/v1/health`                    | `{ status: "ok" }`                                                |

Type shapes (see `src/types/*.d.ts`):

```ts
IProject = { _id, projectName, managerId, organization, createdAt }
IColumn  = { _id, columnName, projectId, index }
ITask    = { _id, columnId, coordinatorId, epic, taskName, type, note, projectId, storyPoints, index }
IMember  = { _id, username, email }
IUser    = IMember & { jwt: string; likedProjects: string[] }
```

## Critical traps

- **Catch-all route ordering.** A `page.route("**/*")` registered
  after `/api/v1/**` wins (Playwright runs the most-recently-added
  matching route first) and swallows the API mock. Don't register a
  catch-all, or register the API mock last.
- **Theme toggle is event-driven.** Don't click the moon icon —
  flake-prone. Set the preference directly:
    ```js
    await page.evaluate(() => {
        localStorage.setItem("ui:colorScheme", "dark");
        window.dispatchEvent(
            new CustomEvent("ui:colorScheme:changed", { detail: "dark" })
        );
    });
    ```
- **`fullPage: false` for mobile.** `fullPage: true` ignores
  `body { overflow-x: hidden }` and stretches the capture past the
  viewport, which makes desktop overflow bugs look bigger than users
  see and hides genuine mobile-only issues like clipped headers.
- **Mock the right query param.** The frontend sends `?projectId=p1`,
  not `?_id=p1`. Mocking the wrong key returns the array fallback and
  the board renders `" board"` with a leading space because
  `currentProject?.projectName` is undefined.
- **Token only for authed routes.** `/login` and `/register` redirect
  to `/projects` whenever `localStorage.Token` is set. Capture them in
  a separate browser context that does not seed `Token`, otherwise
  every "login" cell of the matrix shows the projects page.

## The matrix

For a full sweep, capture every cell of:

- **Routes**: `/login`, `/register`, `/projects`, `/projects/p1/board`.
- **Viewports**: `390 × 844` (mobile), `768 × 1024` (tablet),
  `1440 × 900` (laptop), `1920 × 1080` (wide).
- **Themes**: light, dark.
- **Interaction states** (one viewport each is enough):
    - empty list (`[]` for `projects` / `tasks`),
    - populated (default mocks),
    - error (`route.fulfill({ status: 500, ... })`),
    - long content (200-char project name; 500-char task note),
    - modal open (Create project, Task modal),
    - active filters (preset query like `?managerId=u2`).

## Skeleton script

Save to a path outside the repo (e.g. `/tmp/screenshots.mjs`):

```js
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import fs from "node:fs";
const { chromium } = pw;

const OUT = "/tmp/screens";
fs.mkdirSync(OUT, { recursive: true });

const json = (data, status = 200) => ({
    status,
    contentType: "application/json",
    body: JSON.stringify(data)
});

// Defaults; pass `overrides` to swap a single endpoint per test.
const setupMocks = async (page, overrides = {}) => {
    await page.route("**/api/v1/**", async (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname.replace(/^\/api\/v1\//, "");
        const method = route.request().method();
        const override = overrides[`${method} ${path}`];
        if (override) return override(route, url);

        if (path === "auth/login") return route.fulfill(json(USER));
        if (path === "auth/register")
            return route.fulfill(json({ message: "ok" }, 201));
        if (path === "users") return route.fulfill(json(USER));
        if (path === "users/members") return route.fulfill(json(MEMBERS));
        if (path === "projects" && url.searchParams.get("projectId")) {
            const id = url.searchParams.get("projectId");
            return route.fulfill(json(PROJECTS.find((p) => p._id === id)));
        }
        if (path === "projects") return route.fulfill(json(PROJECTS));
        if (path === "boards") return route.fulfill(json(COLUMNS));
        if (path === "tasks") return route.fulfill(json(TASKS));
        return route.fulfill(json({}));
    });
    // No catch-all. Last route added wins; do not let one swallow the API mock.
};

const shoot = async (page, name, opts = {}) => {
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({
        path: `${OUT}/${name}.png`,
        fullPage: opts.fullPage ?? true
    });
};
```

Drive it with one loop per viewport, set `localStorage.Token` before
navigating to authenticated routes, and call `setupMocks(page,
overrides)` before each navigation when you need a per-state override
(empty list, error, long content).

## Root-cause probes

When a screenshot reveals an issue, prove the cause with a one-shot
`page.evaluate` before editing.

**Which elements escape the viewport** (overflow):

```js
await page.evaluate(() => {
    const viewW = document.documentElement.clientWidth;
    const offenders = [];
    document.querySelectorAll("body *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right > viewW + 1 && r.width > 0) {
            offenders.push({
                tag: el.tagName,
                cls: String(el.className).slice(0, 80),
                right: Math.round(r.right),
                width: Math.round(r.width),
                overflowX: getComputedStyle(el).overflowX
            });
        }
    });
    return offenders.slice(0, 20);
});
```

**Where an AntD CSS variable is actually defined** (theming
cascade):

```js
await page.evaluate((varName) => {
    for (const el of document.querySelectorAll("*")) {
        const v = getComputedStyle(el).getPropertyValue(varName);
        if (v && v.trim()) {
            return {
                tag: el.tagName,
                cls: String(el.className),
                val: v.trim()
            };
        }
    }
    return null;
}, "--ant-color-bg-layout");
```

**Why a flex item is wider than expected** (parent-chain sizing):

```js
await page.evaluate(() => {
    let el = document.querySelector(".ant-tag"); // start from the offender
    const chain = [];
    for (let i = 0; i < 10 && el; i++) {
        const r = el.getBoundingClientRect();
        const c = getComputedStyle(el);
        chain.push({
            tag: el.tagName,
            cls: String(el.className).slice(0, 60),
            width: Math.round(r.width),
            display: c.display,
            flex: c.flex,
            minWidth: c.minWidth
        });
        el = el.parentElement;
    }
    return chain;
});
```

The first row whose `width` jumps far above its siblings is the
ancestor whose `flex-basis: auto` is resolving to a child's max-content
— not the element you started from.
