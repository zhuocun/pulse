export type { AiCopilotFeedbackSurface } from "./copilotSurfaceFeedback";
export { default as AiCopilotSurfaceFeedback } from "./copilotSurfaceFeedback";
export { default } from "./feedbackPopover";
export * from "./feedbackPopover";

/** Optional `surface` field on thumbs-feedback analytics payloads. */
export type AiAnalyticsThumbsFeedbackSurface =
    | import("./copilotSurfaceFeedback").AiCopilotFeedbackSurface
    | "chat";
