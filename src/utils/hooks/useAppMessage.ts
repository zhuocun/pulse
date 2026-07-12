/**
 * Compat re-export. The app's `message` seam is the sonner-backed
 * `@/components/ui/toast` module; this file keeps the historical
 * `useAppMessage` import path resolving for callers that have not yet been
 * repointed. Migrate remaining callers to `@/components/ui/toast` directly
 * (S9/S10), then delete this file. No antd runtime is imported here.
 */
export type {
    HideToast,
    MessageApi,
    MessageArgs,
    OpenArgs
} from "@/components/ui/toast";
export { default, message, useAppMessage } from "@/components/ui/toast";
