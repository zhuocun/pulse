import { Typography } from "antd";
import React from "react";

import { microcopy } from "../../constants/microcopy";
import extractErrorMessage from "../../utils/extractErrorMessage";

const isErrorPayload = (error: unknown): error is IError =>
    error !== null && typeof error === "object" && "error" in error;

export const resolveAuthPageErrorMessage = (
    error: Error | IError | unknown
): string | null => {
    if (error instanceof Error) {
        return error.message || microcopy.feedback.operationFailed;
    }
    if (isErrorPayload(error) && error.error != null) {
        return (
            extractErrorMessage(error.error) ??
            microcopy.feedback.operationFailed
        );
    }
    return null;
};

/**
 * Displays the most recent error from a form submission. Renders an empty
 * placeholder when no error is set so the surrounding layout doesn't shift,
 * and exposes the message to screen readers via `role="alert"`.
 */
const ErrorBox = React.forwardRef<
    HTMLDivElement,
    { error: Error | IError | unknown }
>(({ error }, ref) => {
    const message = resolveAuthPageErrorMessage(error);
    return (
        <div
            aria-atomic="true"
            aria-live="assertive"
            ref={ref}
            role="alert"
            style={{ minHeight: "1.5em" }}
            tabIndex={message ? -1 : undefined}
        >
            {message ? (
                <Typography.Text type="danger">{message}</Typography.Text>
            ) : null}
        </div>
    );
});

ErrorBox.displayName = "ErrorBox";

export default ErrorBox;
