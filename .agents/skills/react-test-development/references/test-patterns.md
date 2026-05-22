# Test Patterns

Use these patterns as the default implementation style unless existing tests in the repo establish a stronger convention.

## Contents

- Test File Placement
- Baseline Setup
- Shared Render Helper
- Test Data Factories
- Fetch Mock
- Router And Navigation
- Auth Strategies
- Ant Design Patterns
- React Query Patterns
- Drag And Drop
- Timer And Debounce
- Error Testing

## Test File Placement

- Pure utility: `src/utils/filterRequest.test.ts`.
- Hook: `src/utils/hooks/useAuth.test.tsx`.
- Component folder: `src/components/projectList/index.test.tsx`.
- Page: `src/pages/project.test.tsx`.
- Mock backend: `src/__tests__/jsonServerMiddleware.test.ts` importing `../../__json_server_mock__/middleware.js`.

## Baseline Setup

Extend `src/setupTests.ts` only when multiple tests need the same browser polyfill or cleanup. Keep test data factories and render helpers in `src/test-utils.tsx` or `src/test-utils/`.

Recommended setup additions when tests require them:

```ts
import "@testing-library/jest-dom";

Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn()
    }))
});

class ResizeObserverMock {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
}

window.ResizeObserver = ResizeObserverMock;
```

Use only the polyfills the current tests need.

## Shared Render Helper

Create or extend a helper similar to this when integration tests need router, React Query, or MobX state:

```tsx
import { ReactElement } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "react-query";
import { BrowserRouter } from "react-router-dom";

import {
    ProjectModalStoreContext,
    projectModalStore
} from "./store/projectModalStore";

export const createTestQueryClient = () =>
    new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false }
        }
    });

export const renderWithProviders = (
    ui: ReactElement,
    {
        route = "/",
        queryClient = createTestQueryClient()
    }: { route?: string; queryClient?: QueryClient } = {}
) => {
    window.history.pushState({}, "Test page", route);

    return {
        queryClient,
        ...render(
            <ProjectModalStoreContext.Provider value={projectModalStore}>
                <QueryClientProvider client={queryClient}>
                    <BrowserRouter>{ui}</BrowserRouter>
                </QueryClientProvider>
            </ProjectModalStoreContext.Provider>
        )
    };
};
```

If a test needs `AuthProvider`, wrap it explicitly. Many component tests should skip `AuthProvider` and seed or mock auth directly.

## Test Data Factories

Prefer factories over inline repeated objects:

```ts
export const member = (overrides: Partial<IMember> = {}): IMember => ({
    _id: "u1",
    username: "Alice",
    email: "alice@example.com",
    ...overrides
});

export const user = (overrides: Partial<IUser> = {}): IUser => ({
    ...member(),
    likedProjects: [],
    jwt: "token-1",
    ...overrides
});

export const project = (overrides: Partial<IProject> = {}): IProject => ({
    _id: "p1",
    projectName: "Roadmap",
    managerId: "u1",
    organization: "Product",
    createdAt: "2026-04-25T00:00:00.000Z",
    ...overrides
});
```

Place factories in `src/test-utils/factories.ts` when more than one test file uses them.

## Fetch Mock

Use an explicit queue when testing multiple API calls:

```ts
const mockJsonResponse = (body: unknown, ok = true, status = ok ? 200 : 400) =>
    Promise.resolve({
        ok,
        status,
        json: () => Promise.resolve(body)
    } as Response);

const fetchMock = jest.spyOn(global, "fetch");

beforeEach(() => {
    fetchMock.mockReset();
    localStorage.clear();
});

afterAll(() => {
    fetchMock.mockRestore();
});
```

Assert URL, method, headers, body, and query string when testing `api`, `useReactQuery`, `useReactMutation`, forms, and pages.

## Router And Navigation

For component tests that call `useNavigate`, prefer real `BrowserRouter` and assert `window.location.pathname` after user interaction. For low-level tests where real navigation is noisy, mock `react-router` narrowly:

```ts
const navigate = jest.fn();

jest.mock("react-router", () => ({
    ...jest.requireActual("react-router"),
    useNavigate: () => navigate
}));
```

Do not mock the entire router for route integration tests.

## Auth Strategies

Use one of these, in order of preference:

1. Real auth state: seed React Query with `queryClient.setQueryData("users", user())` and set `localStorage.Token`.
2. Mock network: let `AuthProvider` call `GET users` and return a user from `fetch`.
3. Mock `useAuth` only for leaf components whose auth behavior is not under test.

Always test logout behavior at least once with real query cache and localStorage clearing.

## Ant Design Patterns

- For `Modal.confirm`, spy on the static method and invoke `onOk` manually:

```ts
const confirmSpy = jest.spyOn(Modal, "confirm").mockImplementation((config) => {
    config.onOk?.();
    return { destroy: jest.fn(), update: jest.fn() } as any;
});
```

- For `Select`, prefer `fireEvent.mouseDown(screen.getByRole("combobox"))`, then click the option text. If Ant Design role output is unstable, use `getByText` with `within(document.body)`.
- For `Popover` and `Dropdown`, use `userEvent.hover`, `userEvent.click`, and assertions against `document.body`.
- For `Drawer` and `Modal`, pass `forceRender` when already present and assert by text/role after opening.

## React Query Patterns

Test query hooks through a tiny component:

```tsx
const Probe = () => {
    const result = useReactQuery<IProject[]>("projects", {
        projectName: "Road"
    });
    if (result.isLoading) return <div>loading</div>;
    if (result.isError) return <div>error</div>;
    return <div>{result.data?.[0].projectName}</div>;
};
```

Use `await screen.findByText(...)` for successful results and `waitFor` for fetch assertions.

When testing mutations, assert both server call and cache side effect:

```ts
await waitFor(() => expect(fetchMock).toHaveBeenCalled());
expect(queryClient.getQueryData("users")).toEqual(expectedUser);
```

## Drag And Drop

Do not try to fully simulate browser drag/drop unless necessary. Cover behavior with:

- Unit tests for `reorder.ts` callbacks.
- Hook tests for `useDragEnd` by mocking `useReactQuery` data and mutation callbacks.
- Component tests that verify columns/tasks render with correct `droppableId`, disabled states, and click-to-edit behavior where practical.

## Timer And Debounce

For `useDebounce` and pages using debounced filters:

```ts
jest.useFakeTimers();

// change input
act(() => {
    jest.advanceTimersByTime(1000);
});

jest.useRealTimers();
```

Always restore real timers in `afterEach`.

## Error Testing

Cover all supported error shapes:

- `Error` instance.
- `{ error: "message" }`.
- `{ error: [{ msg: "message" }] }`.
- Unknown non-error value passed through `getError`.

Do not assert the exact default `Error("[object Object]")` string unless the behavior is intentional for the file under test.
