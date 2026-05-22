# Project Map

Use this reference to reconstruct app context quickly before writing tests.

## Contents

- Runtime Stack
- Entry Points And Providers
- Routes
- API Contract Expected By Frontend
- Current Mock Backend Caveat
- Main Workflows
- State and cache behavior
- Known Test Hazards

## Runtime Stack

- React 18 with CRA and CRACO.
- TypeScript with strict mode enabled.
- Ant Design v4 plus `antd/dist/antd.less`.
- Emotion styled components.
- React Router v6 using route objects and `useRoutes`.
- React Query v3 for API cache and server state.
- MobX for the project modal open/close state.
- Redux Toolkit files exist but the provider is commented out.
- `react-beautiful-dnd` powers board and task drag/drop.
- JSON-server mock files exist under `__json_server_mock__`, but the current mock data is stale relative to the frontend.

## Entry Points And Providers

- `src/index.tsx`: renders `<AppProviders><App /></AppProviders>` inside `React.StrictMode`.
- `src/App.tsx`: calls `useRoutes(routes)`.
- `src/utils/appProviders.tsx`: creates `QueryClient`, wraps with `ProjectModalStoreContext.Provider`, `QueryClientProvider`, `BrowserRouter`, and `AuthProvider`.
- `src/utils/authProvider.tsx`: refreshes the current user from React Query if a token exists; renders full-page spinner/error while resolving.

Testing implications:

- Prefer custom test providers over `AppProviders` so tests can control `QueryClient` options and initial route.
- Use `AppProviders` only for high-level smoke/integration tests that intentionally exercise the full stack.
- Seed `localStorage.Token` and query data when testing authenticated states.

## Routes

Defined in `src/routes/index.tsx`:

- `/` redirects to `/login`.
- `/login` renders auth layout plus `LoginPage`.
- `/register` renders auth layout plus `RegisterPage`.
- `/projects` renders main layout plus `ProjectPage`.
- `/projects/:projectId` renders `ProjectDetailPage`, which redirects to `board`.
- `/projects/:projectId/board` renders `BoardPage`.

Testing implications:

- Route integration tests should assert redirects and layout switching.
- For `ProjectDetailPage`, test that navigating to `/projects/p1` eventually moves to `/projects/p1/board`.
- `resetRoute()` hard-sets `window.location.href` to `/projects`; test it with a controlled `window.location` mock or isolate it as a utility.

## API Contract Expected By Frontend

`src/constants/env.ts` builds:

```text
apiBaseUrl = `${process.env.REACT_APP_API_URL}/api/v1`
```

`src/utils/hooks/useApi.ts` then requests:

```text
${apiBaseUrl}/${endpoint}
```

Important endpoints:

- `POST auth/login` returns an `IUser` with `jwt`.
- `POST auth/register` returns success or validation error.
- `GET users` returns current `IUser`.
- `GET users/members` returns `IMember[]`.
- `PUT users/likes` toggles liked projects and returns/invalidates user data.
- `GET projects`, `POST projects`, `PUT projects`, `DELETE projects`.
- `GET boards`, `POST boards`, `DELETE boards`, `PUT boards/orders`.
- `GET tasks`, `POST tasks`, `PUT tasks`, `DELETE tasks`, `PUT tasks/orders`.

Expected TypeScript shapes:

```ts
interface IMember {
    _id: string;
    username: string;
    email: string;
}

interface IUser extends IMember {
    likedProjects: string[];
    jwt: string;
}

interface IProject {
    _id: string;
    projectName: string;
    managerId: string;
    organization: string;
    createdAt: string;
}

interface IColumn {
    _id: string;
    columnName: string;
    projectId: string;
    index: number;
}

interface ITask {
    _id: string;
    columnId: string;
    coordinatorId: string;
    epic: string;
    taskName: string;
    type: string;
    note: string;
    projectId: string;
    storyPoints: number;
    index: number;
}
```

## Current Mock Backend Caveat

`package.json` has:

```json
"server": "json-server __json_server_mock__/db.json --watch --port 8080 --middleware ./__json_server_mock__/middleware.js"
```

The installed JSON-server help documents `--middlewares`, not `--middleware`. The checked-in `middleware.js` handles `/login`, `/register`, and `/userInfo`, while the app calls `/api/v1/auth/login`, `/api/v1/auth/register`, and `/api/v1/users`. The checked-in `db.json` uses old fields like `id`, `name`, `personId`, and `department`.

Testing implications:

- Do not use the live JSON server for frontend tests.
- Mock `fetch` with the frontend contract.
- If testing `__json_server_mock__/middleware.js`, assert its current behavior separately and consider a future fix to align it with `/api/v1`.

## Main Workflows

Authentication:

- `LoginForm` posts to `auth/login`, caches returned user under query key `"users"`, stores `Token`, and navigates to `/projects`.
- `RegisterForm` posts to `auth/register` and navigates to `/login`.
- `useAuth` reads current user from React Query and token from `localStorage`; `logout()` clears both and navigates to `login`.
- `AuthProvider` refreshes user data when a token exists but no cached user exists.

Projects:

- `ProjectPage` reads URL params `projectName` and `managerId`, debounces them, fetches projects and members, renders search panel and list.
- `ProjectList` renders favorites, project links, manager names, created date, edit/delete actions.
- `ProjectModal` opens from URL state (`modal=on` or `editingProjectId`) via MobX, fetches members, creates or edits a project.
- `ProjectPopover` lists projects and can open the project modal.

Board:

- `BoardPage` fetches project, boards, members, then tasks once boards exist.
- URL params `taskName`, `coordinatorId`, `type`, and `editingTaskId` drive filters and task modal state.
- `Column` filters tasks and renders draggable task cards plus `TaskCreator`.
- `ColumnCreator` creates boards.
- `TaskModal` edits or deletes a task.
- `useDragEnd` maps drag/drop results to `boards/orders` or `tasks/orders` mutations.

State and cache:

- `ProjectModalStore` is a small MobX store with `isModalOpened`, `openModalMobX`, and `closeModalMobX`.
- Redux store/slice exist but are not wired into providers.
- React Query keys often include filtered params, for example `["projects", {}]`, `["boards", { projectId }]`, and `["tasks", { projectId }]`.

## Known Test Hazards

- `filterRequest` mutates its input object. Tests should assert current mutation behavior or drive a behavior-preserving refactor before changing it.
- Optimistic delete callbacks mutate the old array with `splice`. Tests should detect both returned value and mutation side effects.
- `useReactMutation` stores `previousItems` on mutate but does not currently roll back on error.
- `useUrl` spreads `URLSearchParams`; this can be surprising. Test actual URL behavior, not assumed object shape.
- Ant Design `Modal.confirm`, `Dropdown`, `Popover`, and `Drawer` often render portals and need `waitFor`, fake timers, or direct static method mocks.
- `react-beautiful-dnd` is hard to simulate in jsdom. Test `useDragEnd` payload mapping directly and use lighter integration tests for rendered drag/drop wrappers.
- The app uses rem sizing and fixed minimum layout widths; tests should not assert exact CSS unless testing a styled utility.
