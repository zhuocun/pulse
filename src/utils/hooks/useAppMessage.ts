import { App, message as staticMessage } from "antd";

/**
 * Theme-aware AntD message instance with a static fallback.
 *
 * AntD v6 warns at runtime when a `message.success(...)` (or sibling)
 * call comes from the static `import { message } from "antd"` API while
 * a dynamic theme is mounted via `ConfigProvider`. The official escape
 * hatch is `const { message } = App.useApp();`, which resolves a
 * theme-aware instance from the nearest `<App>` provider.
 *
 * The catch: tests render components in isolation (no `<App>` wrapper)
 * and `App.useApp()` then returns a no-op shape (`{ message: {} }`)
 * whose `.success` / `.error` / etc. are `undefined`. Code that calls
 * those would throw in jsdom, breaking dozens of tests that previously
 * went through the static API.
 *
 * `useAppMessage` returns the App-scoped instance when available and
 * silently falls back to the static `message` otherwise. The fallback
 * keeps the production warning suppressed inside the app shell
 * (`AppProviders` mounts `<App>`) while preserving the test ergonomics
 * — `message.success(...)` works whether or not a test wraps with
 * `<AntdApp>`.
 *
 * Production paths still warn if a callsite somehow lands outside the
 * `<App>` provider, because we hit the static fallback there — but the
 * shell has `<App>` at the root so every production callsite resolves
 * to the dynamic instance.
 */
const useAppMessage = (): typeof staticMessage => {
    const { message: dynamicMessage } = App.useApp();
    // `useApp()` returns `{ message: {} }` when no `<App>` is mounted
    // (test rendering in isolation). Detect by checking for one of the
    // expected methods — if it's missing the empty-object placeholder
    // is in play and we route to the static API.
    if (
        dynamicMessage &&
        typeof (dynamicMessage as { success?: unknown }).success === "function"
    ) {
        return dynamicMessage as typeof staticMessage;
    }
    return staticMessage;
};

export default useAppMessage;
