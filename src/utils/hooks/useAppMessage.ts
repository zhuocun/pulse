/**
 * Compat re-export. The app's `message` seam is the sonner-backed
 * `@/components/ui/toast` module; this file keeps the historical
 * `useAppMessage` import path resolving for callers that have not yet been
 * repointed. Remaining callers (and their jest.mock paths) can be migrated to
 * `@/components/ui/toast` directly in a later cleanup, then delete this file.
 * No antd runtime is imported here.
 */
export type {
    HideToast,
    MessageApi,
    MessageArgs,
    OpenArgs
} from "@/components/ui/toast";
export { default, message, useAppMessage } from "@/components/ui/toast";
