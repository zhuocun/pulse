import { Button, Result, Space } from "antd";
import React from "react";

import { microcopy } from "../../constants/microcopy";
import { reportError } from "../../utils/observability/sinks";

interface ErrorBoundaryProps {
    children: React.ReactNode;
    fallback?: (error: Error, retry: () => void) => React.ReactNode;
}

interface ErrorBoundaryState {
    error: Error | null;
}

/**
 * Top-level error boundary used by routed pages. Recovers via Retry
 * (component remount) or by reloading the entire page (full reset of
 * client state). Implements Phase 3.7 of the optimization plan and
 * Nielsen heuristic #9 (help users recover from errors). The "Reload"
 * fallback covers cases where the cached state itself is corrupt and a
 * remount alone won't help.
 */
class ErrorBoundary extends React.Component<
    ErrorBoundaryProps,
    ErrorBoundaryState
> {
    state: ErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        // Report to the production error sink (registered in index.tsx via
        // VITE_ERROR_REPORT_ENDPOINT). `reportError` is a no-op when no sink
        // is registered, so this never breaks the boundary or floods tests.
        try {
            reportError({
                message: error.message,
                stack: error.stack,
                componentStack: info.componentStack ?? undefined
            });
        } catch {
            // A failing sink must never break the boundary.
        }
    }

    handleRetry = () => {
        this.setState({ error: null });
    };

    handleReload = () => {
        if (typeof window !== "undefined") {
            window.location.reload();
        }
    };

    render() {
        const { error } = this.state;
        const { children, fallback } = this.props;
        if (!error) return children;
        if (fallback) return fallback(error, this.handleRetry);
        // Wrap the AntD `Result` in a live region so screen readers
        // announce the failure (Nielsen #1 — visibility of system
        // status; WCAG 4.1.3 status messages). AntD's `Result` renders
        // a styled card but no role="alert" of its own.
        return (
            <div aria-atomic="true" aria-live="assertive" role="alert">
                <Result
                    status="error"
                    title={microcopy.feedback.renderFailed}
                    subTitle={
                        error.message || microcopy.feedback.renderFailedHint
                    }
                    extra={
                        <Space wrap>
                            <Button onClick={this.handleRetry} type="primary">
                                {microcopy.actions.retry}
                            </Button>
                            <Button onClick={this.handleReload}>
                                {microcopy.feedback.reloadPage}
                            </Button>
                        </Space>
                    }
                />
            </div>
        );
    }
}

export default ErrorBoundary;
