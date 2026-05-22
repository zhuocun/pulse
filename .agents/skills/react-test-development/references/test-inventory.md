# Test Inventory

Use this inventory to choose the next missing tests. Existing tests may already cover some scenarios; inspect before adding duplicates.

## Contents

- Highest Priority Utilities
- API And React Query
- Auth And Provider Hooks
- URL And Modal Hooks
- State Stores
- Optimistic Update Callbacks
- Layouts And Shared Components
- Auth Forms And Pages
- Header, Members, And Project Navigation
- Project List Workflow
- Board Workflow
- App And Routes
- Mock Backend Files

## Highest Priority Utilities

`src/utils/filterRequest.ts`

- Removes `undefined`, `null`, empty string, and `NaN` values.
- Keeps `0`, `false`, non-empty strings, arrays, and objects.
- Mutates and returns the same object. If refactored to immutable behavior, update tests intentionally.

`src/utils/getError.ts`

- Returns the same `Error` instance.
- Wraps non-error values with `Object(error)`.
- Handles strings, objects, `null`, and `undefined`.

`src/utils/resetRoute.ts`

- Sets `window.location.href` to `${window.location.origin}/projects`.

`src/utils/hooks/useDebounce.ts`

- Returns initial value immediately.
- Updates only after delay.
- Cancels previous timeout on rapid changes.
- Restores timers after each test.

`src/utils/hooks/useTitle.ts`

- Sets `document.title`.
- Restores old title on unmount when `keepOnMount` is false.
- Keeps new title when `keepOnMount` is true.

## API And React Query

`src/constants/env.ts`

- Uses `process.env.REACT_APP_API_URL` and appends `/api/v1`.
- Test with `jest.resetModules()` when changing env values.

`src/utils/hooks/useApi.ts`

- Adds `Authorization: Bearer <token>` when token exists.
- Uses `Content-Type: application/json` when data exists.
- Serializes `GET` and `DELETE` params with `qs`.
- Serializes non-GET/DELETE data into JSON body.
- Resolves parsed JSON on `res.ok`.
- Rejects `error` as string.
- Rejects `error[0].msg` as validation shape.
- Rejects raw response data when no `error` field exists.
- Uses `user.jwt` over token fallback.

`src/utils/hooks/useReactQuery.ts`

- Builds query key as endpoint when no params exist.
- Builds query key as `[specialQueryKey || endpoint, filteredParams]` when params exist.
- Filters void params before API call.
- Supports `enabled=false`.
- Calls `onSuccess`.
- Converts errors through `getError` before `onError`.

`src/utils/hooks/useReactMutation.ts`

- Calls API with filtered data and method.
- Invalidates `queryKey` on success by default.
- Sets cache directly when `setCache` is true.
- Applies optimistic `callback` in `onMutate`.
- Returns previous cache items from `onMutate`.
- Converts errors through `getError` before `onError`.
- Covers behavior when `queryKey` is omitted.

`src/utils/authApis.ts`

- `login` posts to `/auth/login`, stores `Token` from returned `jwt`, returns user.
- `login` maps 404 to `Failed to connect`.
- `login` rejects other failures with response JSON.
- `register` posts to `/auth/register`, returns JSON on success.
- `register` maps 404 to `Failed to connect`.
- `register` maps 400 validation shape to first `error[0].msg`.

## Auth And Provider Hooks

`src/utils/hooks/useAuth.ts`

- Reads `user` from React Query cache and `token` from localStorage.
- `logout()` clears query cache and token, then navigates to `login`.
- `refreshUser()` does nothing without token or when user already exists.
- `refreshUser()` refetches `"users"` when token exists and no cached user exists.
- `refreshUser()` stores `jwt: token` after refetch.
- `refreshUser()` logs out on refetch failure.

`src/utils/authProvider.tsx`

- Calls `refreshUser` on mount.
- Shows `PageSpin` when token exists and user query is idle/loading.
- Shows `PageError` when user query errors.
- Renders children when no auth blocking state exists.

`src/utils/appProviders.tsx`

- Renders children under router/query/auth/modal providers.
- Smoke-test with a child that uses `useQueryClient`, `useLocation`, and `useContext(ProjectModalStoreContext)`.

## URL And Modal Hooks

`src/utils/hooks/useUrl.ts`

- Returns requested keys from current URL search params.
- Updates one or more params.
- Removes void params.
- Preserves unrelated existing params where current implementation supports it.

`src/utils/hooks/useTaskModal.ts`

- Reads `editingTaskId` from URL.
- `startEditing(id)` writes `editingTaskId=id`.
- `closeModal()` removes `editingTaskId`.

`src/utils/hooks/useProjectModal.ts`

- Opens modal when `modal=on`.
- Opens modal when `editingProjectId` exists.
- Closes modal when neither is present.
- Fetches editing project with special query key `"editingProject"` only when editing.
- `openModal()` writes `modal=on`.
- `closeModal()` removes both `modal` and `editingProjectId`.
- `startEditing(id)` writes `editingProjectId=id`.

## State Stores

`src/store/projectModalStore.ts`

- Initial `isModalOpened` is false.
- `openModalMobX()` sets true.
- `closeModalMobX()` sets false.
- Methods stay bound when destructured.

`src/store/reducers/projectModalSlice.ts`

- Initial reducer state is closed.
- `openModal` sets open.
- `closeModal` sets closed.

`src/store/index.ts`

- Store contains `projectModal`.
- Dispatching project modal actions updates typed root state.

`src/utils/hooks/useRedux.ts`

- Hook wrappers can be smoke-tested in a Redux provider if needed for coverage.

## Optimistic Update Callbacks

`src/utils/optimisticUpdate/createTask.ts`

- Returns `undefined` when old tasks are missing.
- Appends a mock task with `_id: "mock"` and submitted fields.

`src/utils/optimisticUpdate/deleteTask.ts`

- Returns `undefined` when old tasks are missing.
- Removes matching task.
- Covers behavior when target id is missing. Current code removes index 0; treat as a defect if fixing is in scope, otherwise pin current behavior explicitly.

`src/utils/optimisticUpdate/createColumn.ts`

- Returns `undefined` when old columns are missing.
- Appends mock column with `_id: "mock"` and `index: old.length`.

`src/utils/optimisticUpdate/deleteColumn.ts`

- Returns `undefined` when old columns are missing.
- Removes matching column.
- Decrements indexes greater than removed column index.
- Covers behavior when target id is missing.

`src/utils/optimisticUpdate/deleteProject.ts`

- Returns `undefined` when old projects are missing.
- Removes matching project.
- Covers behavior when target id is missing.

`src/utils/optimisticUpdate/reorder.ts`

- `columnCallback` moves columns before and after reference column.
- `taskCallback` moves tasks before and after reference task.
- Moving to empty reference id places item at end when applicable.
- Same-column task move updates ordering without changing column.
- Cross-column task move updates moved task's `columnId`.
- No-op-like edge cases preserve array where applicable.

## Layouts And Shared Components

`src/layouts/authLayout.tsx`

- Renders logo header, background, card, and outlet content.
- `AuthButton` spans full width.

`src/layouts/mainLayout.tsx`

- Renders `Header`, main outlet, and `ProjectModal`.
- Provides scrollable full-height shell.

`src/components/pageContainer/index.tsx`

- Renders children with full-width container styles.

`src/components/row/index.tsx`

- Applies flex layout.
- Covers `between`, numeric `gap`, boolean `gap`, and `marginBottom`.

`src/components/status/index.tsx`

- `PageSpin` renders spinner.
- `PageError` renders supplied error message.
- `PageError` renders default message without error.

`src/components/errorBox/index.tsx`

- Renders `Error.message`.
- Renders string `error.error`.
- Renders first validation `error.error[0].msg`.
- Renders nothing for null/empty.

## Auth Forms And Pages

`src/components/loginForm/index.tsx`

- Validates required email/password.
- Validates email format.
- Clears parent error on input changes.
- Calls login mutation with input.
- Stores returned `jwt` in localStorage.
- Navigates to `/projects` on success.
- Shows loading state while submitting.
- Calls `onError` for mutation errors.

`src/components/registerForm/index.tsx`

- Validates required email/username/password.
- Validates email format.
- Clears parent error on input changes.
- Calls register mutation with input.
- Navigates to `/login` on success.
- Calls `onError` for mutation errors.

`src/pages/login.tsx`

- Renders title, error box, login form, divider, register link.
- Clicking register link navigates to `/register`.
- Returns null when user and token exist.

`src/pages/register.tsx`

- Renders title, error box, register form, divider, login link.
- Clicking login link navigates to `/login`.
- Returns null when user and token exist.

`src/pages/home.tsx`

- Authenticated user visiting `/login` or `/register` resets to `/projects`.
- Unauthenticated user without token visiting protected route logs out/navigates to login.
- Authenticated user renders `MainLayout`.
- Anonymous auth route renders `AuthLayout`.

## Header, Members, And Project Navigation

`src/components/header/index.tsx`

- Renders logo, members popover, greeting with username.
- Clicking logo resets to projects unless already on `/projects`.
- Logout menu calls `logout()`.

`src/components/memberPopover/index.tsx`

- Fetches members.
- Renders member names.
- Refetches when popover opens.
- Handles empty member list.

`src/components/projectPopover/index.tsx`

- Fetches projects.
- Renders project list.
- Clicking project navigates to `/projects/:id`.
- Clicking create opens project modal.

`src/pages/projectDetail.tsx`

- Renders board menu and projects popover menu.
- Redirects nested project route to `board` when missing.
- Selects current menu key based on URL.

## Project List Workflow

`src/pages/project.tsx`

- Sets document title to `Project List` and restores according to hook options.
- Reads `projectName` and `managerId` URL params.
- Debounces project query params by 1000ms.
- Fetches projects and members.
- Opens project modal from create button.
- Shows error text when either query errors.
- Passes loading/data to search panel and project list.

`src/components/projectSearchPanel/index.tsx`

- Shows search input with current `projectName`.
- Updates URL params on input.
- Shows managers select loading state.
- Displays selected manager username when `managerId` matches.
- Updates `managerId` on select.
- Includes all members as options plus default Managers option.

`src/components/projectList/index.tsx`

- Maps projects to AntD table rows with stable keys.
- Renders liked star state from `user.likedProjects`.
- Optimistically flips star display while like mutation is in flight.
- Calls `users/likes` mutation with project id.
- Renders project link to project detail.
- Renders organization, manager username fallback `unknown`, and formatted created date.
- Renders `Null` when no created date exists.
- Edit action calls `startEditing(projectId)`.
- Delete action opens confirm modal and calls delete mutation on confirm.
- Handles loading and empty data through AntD table behavior.

`src/components/projectModal/index.tsx`

- Opens when modal store says open.
- Shows create title without editing project.
- Shows edit title and populates form with editing project.
- Shows spinner while editing project is loading.
- Fetches members and renders manager options.
- Validates required project name, organization, manager.
- Creates project with `POST projects` when no editing project.
- Updates project with `PUT projects` when editing.
- Closes and resets form after successful submit.
- Closes and clears URL state on drawer close.
- Renders mutation error through `ErrorBox`.

## Board Workflow

`src/pages/board.tsx`

- Sets page title to `Board`.
- Reads `projectId` route param.
- Fetches current project, board columns, members, and tasks.
- Enables task query only after board data exists.
- Shows `<projectName> Board` when project loaded and `...` while loading.
- Renders `TaskSearchPanel`.
- Shows board spinner while columns/tasks load.
- Renders columns ordered by board data.
- Disables column drag while column or task reorder is loading.
- Disables task drag while task reorder is loading.
- Does not drag column/task with `_id === "mock"`.
- Renders `ColumnCreator` and `TaskModal`.

`src/components/taskSearchPanel/index.tsx`

- Builds unique types from tasks.
- Builds unique coordinators from task/member relationship.
- Falls back to current user when no coordinators exist.
- Updates `taskName`, `coordinatorId`, and `type` URL params.
- Resets filters and form display.
- Shows default Task/Bug options when task types are not diverse.
- Shows loading state for selects.

`src/components/column/index.tsx`

- Renders column title uppercase.
- Renders delete dropdown.
- Delete disabled for mock column.
- Confirming delete calls `DELETE boards` with column id.
- Filters tasks by `type`, `coordinatorId`, and substring `taskName`.
- Renders task cards with task or bug icon.
- Clicking non-mock task writes editing task id.
- Does not open task modal for mock task.
- Passes disabled state to `TaskCreator`.

`src/components/taskCreator/index.tsx`

- Initially renders create link.
- Clicking link shows focused input.
- Blur exits input mode and clears typed name.
- Enter submits `POST tasks` with route `projectId`, column id, current user id, default type/epic/storyPoints/note.
- Disables input while mutation loading or parent disabled.

`src/components/columnCreator/index.tsx`

- Renders create column input.
- Enter submits `POST boards` with typed column name and route project id.
- Clears input after submit.
- Disables input while mutation loading.

`src/components/taskModal/index.tsx`

- Opens when URL contains `editingTaskId`.
- Finds editing task from provided tasks.
- Populates form from editing task.
- Renders coordinator options from React Query `users/members`.
- Renders task types from task list or default Task/Bug options.
- Submit closes without mutation when form values are unchanged.
- Submit calls `PUT tasks` with merged task and form values when changed.
- Cancel resets form and clears modal URL state.
- Delete closes modal, confirms, then calls `DELETE tasks`.
- Delete disabled when fewer than two tasks, delete loading, no tasks, or editing mock task.

`src/components/dragAndDrop/index.tsx`

- `Drop` clones valid child with droppable props, ref, and provided object.
- `Drop` renders empty div for invalid children.
- `DropChild` renders placeholder.
- `Drag` clones valid child with draggable props, drag handle props, and ref.
- `Drag` renders empty div for invalid children.

`src/utils/hooks/useDragEnd.ts`

- Ignores drops without destination.
- For column drags, maps source/destination to `fromId`, `referenceId`, and before/after type.
- Ignores column drag when ids are missing or same.
- For task drags, maps source/destination columns and tasks.
- Ignores same task.
- Uses after only for same-column downward moves, otherwise before.
- Exposes loading flags as drag-disabled flags.

## App And Routes

`src/App.tsx`

- Renders the route element from `useRoutes`.
- Smoke-test root redirect and a known route through providers.

`src/routes/index.tsx`

- Contains expected route definitions.
- Test through `App` rather than asserting the raw object unless closing coverage on the route file.

`src/index.tsx`

- Mocks `react-dom/client`, `App`, `AppProviders`, and `reportWebVitals`.
- Asserts `createRoot` receives `#root` and renders the provider/app tree.

`src/reportWebVitals.ts`

- If included in runtime coverage, mock `web-vitals` and assert callbacks are passed through.
- Otherwise exclude only if the team explicitly treats CRA reporting boilerplate as non-runtime.

`src/setupTests.ts`

- Usually excluded from coverage or covered indirectly by using matchers/polyfills.

## Mock Backend Files

`__json_server_mock__/middleware.js`

- Responds to `/login` success when email/password exist.
- Responds to `/login` failure when missing fields or email contains `wrong`.
- Responds to `/register` success when email/password exist.
- Responds to `/register` failure when missing fields or email contains `wrong`.
- Rejects missing Authorization for other routes with 401.
- Responds to `/userInfo` with email/token from Authorization header.
- Calls `next()` for authorized non-special routes.

`__json_server_mock__/db.json`

- Usually do not unit test static JSON.
- If coverage scope includes it, require it and assert expected top-level resources exist.
