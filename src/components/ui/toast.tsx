import * as React from "react";
import { Toaster as SonnerToaster, toast as sonnerToast } from "sonner";

import { cn } from "@/lib/utils";

/**
 * Toast — sonner-backed replacement for `useAppMessage` (antd `message`).
 *
 * Preserves the antd call ergonomics so the existing call sites migrate by
 * swapping the import path only:
 *
 *     const message = useAppMessage();
 *     message.success(microcopy.feedback.saved);
 *     message.error(content, 2);            // antd: seconds
 *     message.warning({ content });         // antd: config object
 *     const hide = message.loading(content); hide();
 *
 * Test-safe fallback: every method no-ops until one of our `<Toaster>`
 * surfaces is mounted (tracked by `mountedToasters`). This mirrors the old
 * hook's behavior — a component rendered in isolation can fire
 * `message.*` without a provider and without throwing. Duration is antd
 * seconds (0 = sticky); it's converted to sonner milliseconds.
 */
type Content = React.ReactNode;

export interface MessageArgs {
    content: Content;
    /** antd seconds; 0 keeps the toast until dismissed. */
    duration?: number;
    key?: string | number;
    description?: React.ReactNode;
    onClose?: () => void;
    icon?: React.ReactNode;
}

type MessageInput = Content | MessageArgs;

/** Function returned by each method to dismiss the toast (antd's hide thunk). */
export type HideToast = () => void;

let mountedToasters = 0;

const isMessageArgs = (value: MessageInput): value is MessageArgs =>
    typeof value === "object" &&
    value !== null &&
    !React.isValidElement(value) &&
    !Array.isArray(value) &&
    "content" in value;

const toSonnerOptions = (
    args: Omit<MessageArgs, "content">
): {
    id?: string | number;
    duration?: number;
    description?: React.ReactNode;
    icon?: React.ReactNode;
    onAutoClose?: () => void;
    onDismiss?: () => void;
} => {
    const duration =
        args.duration === undefined
            ? undefined
            : args.duration === 0
              ? Infinity
              : args.duration * 1000;
    return {
        id: args.key,
        duration,
        description: args.description,
        icon: args.icon,
        onAutoClose: args.onClose,
        onDismiss: args.onClose
    };
};

type SonnerVariant = "success" | "error" | "info" | "warning" | "loading";

/** antd `message.open` config: a `MessageArgs` plus the toast `type`. */
export interface OpenArgs extends MessageArgs {
    type?: SonnerVariant;
}

const emit = (
    variant: SonnerVariant,
    input: MessageInput,
    duration?: number,
    onClose?: () => void
): HideToast => {
    if (mountedToasters === 0) return () => undefined;
    const args: MessageArgs = isMessageArgs(input)
        ? input
        : { content: input, duration, onClose };
    const { content, ...rest } = args;
    const id = sonnerToast[variant](content, toSonnerOptions(rest));
    return () => sonnerToast.dismiss(id);
};

export interface MessageApi {
    success(
        input: MessageInput,
        duration?: number,
        onClose?: () => void
    ): HideToast;
    error(
        input: MessageInput,
        duration?: number,
        onClose?: () => void
    ): HideToast;
    info(
        input: MessageInput,
        duration?: number,
        onClose?: () => void
    ): HideToast;
    warning(
        input: MessageInput,
        duration?: number,
        onClose?: () => void
    ): HideToast;
    loading(
        input: MessageInput,
        duration?: number,
        onClose?: () => void
    ): HideToast;
    /**
     * antd `message.open({ content, type, duration, key, … })` — a single
     * config-object entrypoint. `type` defaults to `info`.
     */
    open(args: OpenArgs): HideToast;
    /** Dismiss one toast by key, or all when omitted (antd `message.destroy`). */
    destroy(key?: string | number): void;
}

export const message: MessageApi = {
    success: (input, duration, onClose) =>
        emit("success", input, duration, onClose),
    error: (input, duration, onClose) =>
        emit("error", input, duration, onClose),
    info: (input, duration, onClose) => emit("info", input, duration, onClose),
    warning: (input, duration, onClose) =>
        emit("warning", input, duration, onClose),
    loading: (input, duration, onClose) =>
        emit("loading", input, duration, onClose),
    open: ({ type = "info", ...rest }) => emit(type, rest),
    destroy: (key) => {
        if (mountedToasters === 0) return;
        sonnerToast.dismiss(key);
    }
};

/**
 * Drop-in replacement for the default export of `useAppMessage`. Returns the
 * stable `message` API; keeping the hook shape means call sites only change
 * the import path.
 */
const useAppMessage = (): MessageApi => message;

export type ToasterProps = React.ComponentProps<typeof SonnerToaster>;

/** Tab-bar height (66px) + bar outset + 8px gap — shared phone chrome clearance. */
export const ABOVE_BOTTOM_TAB_BAR =
    "calc(66px + max(24px, calc(env(safe-area-inset-bottom) + 12px)) + 8px)";

const MOBILE_TOAST_OFFSET = {
    bottom: ABOVE_BOTTOM_TAB_BAR
};

/**
 * Themed sonner `<Toaster>`. Mount once near the app root. Registers itself
 * so `message.*` stops no-op'ing; unmount reverts to the test-safe fallback.
 */
const Toaster = ({
    className,
    toastOptions,
    offset = 16,
    mobileOffset = MOBILE_TOAST_OFFSET,
    ...props
}: ToasterProps) => {
    React.useEffect(() => {
        mountedToasters += 1;
        return () => {
            mountedToasters -= 1;
        };
    }, []);
    return (
        <SonnerToaster
            className={cn("toaster group", className)}
            toastOptions={{
                classNames: {
                    toast: cn(
                        "group toast rounded-md border border-border bg-popover p-md text-popover-foreground shadow-lg"
                    ),
                    description: "text-muted-foreground",
                    actionButton: "bg-primary text-primary-foreground",
                    cancelButton: "bg-muted text-muted-foreground",
                    error: "text-destructive",
                    success: "text-success",
                    warning: "text-warning",
                    info: "text-info"
                },
                ...toastOptions
            }}
            offset={offset}
            mobileOffset={mobileOffset}
            {...props}
        />
    );
};

/** Test seam: reset the mounted-Toaster counter between suites. */
export const resetToastersForTests = (): void => {
    mountedToasters = 0;
};

export { Toaster, useAppMessage };
export default useAppMessage;
