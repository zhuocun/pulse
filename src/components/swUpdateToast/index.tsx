import { ReloadOutlined } from "@ant-design/icons";
import { App, Button, Space, Typography } from "antd";
import React from "react";

import { microcopy } from "../../constants/microcopy";

/**
 * Service-worker update notification (Phase 2 QW-16). Mounted when the
 * registration's `updatefound` event reports a new SW reached `installed`
 * state AND the page is already controlled by a previous SW — the
 * combination is the canonical "this is an update, not a first install"
 * signal per the SW lifecycle spec.
 *
 * The toast renders once on mount via `App.useApp().notification.open`
 * and offers a "Reload" CTA that:
 *   1. Posts `{type: "SKIP_WAITING"}` to the waiting registration so the
 *      new worker calls `self.skipWaiting()` (the SW listens for that
 *      message — see `public/sw.js`).
 *   2. Subscribes to `controllerchange` on `navigator.serviceWorker` to
 *      detect when the new worker has taken over.
 *   3. Reloads the page so the next paint is served by the new bundle.
 *
 * The component is render-less — it returns null and drives its UX
 * entirely through the AntD notification system. The notification key is
 * stable (`pulse-sw-update`) so re-mounts (e.g. React StrictMode dev
 * double-invoke) coalesce into a single toast rather than stacking.
 */

interface SwUpdateToastProps {
    /**
     * Service worker registration with a `waiting` worker. The reload
     * CTA posts the SKIP_WAITING message to `registration.waiting`.
     */
    registration: ServiceWorkerRegistration;
    /**
     * Optional reload handler — overridable for tests so we can assert
     * the message-post wiring without actually reloading the jsdom page.
     */
    onReload?: () => void;
    /**
     * Called when the toast is dismissed (close button clicked or the
     * Reload CTA fires). The parent can drop the component from its tree
     * so a future update can mount a fresh instance.
     */
    onDismiss?: () => void;
}

const NOTIFICATION_KEY = "pulse-sw-update";

const SwUpdateToast: React.FC<SwUpdateToastProps> = ({
    registration,
    onReload,
    onDismiss
}) => {
    const { notification } = App.useApp();
    /*
     * `openedRef` guards against `App.useApp()` returning a fresh
     * notification API instance across renders (e.g. theme changes) —
     * we only want to surface the toast once per mount.
     */
    const openedRef = React.useRef(false);

    const handleReload = React.useCallback(() => {
        if (onReload) {
            onReload();
            return;
        }
        /*
         * Canonical update handshake:
         *   - Post `SKIP_WAITING` to the waiting worker; the SW message
         *     listener calls `self.skipWaiting()`.
         *   - Wait for `controllerchange` (the new worker has claimed
         *     this client) and only then reload — reloading before the
         *     swap is complete races the activation and can serve a
         *     half-old / half-new page.
         */
        if (typeof navigator !== "undefined" && navigator.serviceWorker) {
            const reloadOnce = () => {
                navigator.serviceWorker.removeEventListener(
                    "controllerchange",
                    reloadOnce
                );
                if (typeof window !== "undefined") {
                    // jsdom marks `Location.reload` non-configurable and
                    // throws if called outside a real browser; swallow
                    // the error so tests can drive the swap path without
                    // crashing the runner.
                    try {
                        window.location.reload();
                    } catch {
                        /* test environment — see comment above */
                    }
                }
            };
            navigator.serviceWorker.addEventListener(
                "controllerchange",
                reloadOnce
            );
        }
        if (registration.waiting) {
            registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }
    }, [onReload, registration]);

    const handleDismiss = React.useCallback(() => {
        notification.destroy(NOTIFICATION_KEY);
        onDismiss?.();
    }, [notification, onDismiss]);

    React.useEffect(() => {
        if (openedRef.current) return;
        openedRef.current = true;

        notification.open({
            key: NOTIFICATION_KEY,
            // AntD v6 renames `message` → `title` and `btn` → `actions`.
            title: microcopy.swUpdate.title,
            description: (
                <Typography.Paragraph
                    style={{ marginBottom: 0 }}
                    type="secondary"
                    aria-label={microcopy.swUpdate.ariaLabel}
                >
                    {microcopy.swUpdate.description}
                </Typography.Paragraph>
            ),
            // Persistent until the user acts — silent staleness is the
            // bug we're fixing, so a quick auto-dismiss would defeat
            // the point.
            duration: 0,
            placement: "topRight",
            role: "status",
            actions: (
                <Space>
                    <Button
                        onClick={() => {
                            handleReload();
                            notification.destroy(NOTIFICATION_KEY);
                            onDismiss?.();
                        }}
                        size="small"
                        type="primary"
                        icon={<ReloadOutlined aria-hidden />}
                    >
                        {microcopy.swUpdate.reload}
                    </Button>
                    <Button onClick={handleDismiss} size="small" type="text">
                        {microcopy.swUpdate.dismiss}
                    </Button>
                </Space>
            )
        });

        return () => {
            // Destroy on unmount so stale toasts can't linger after the
            // parent unmounts (e.g. user navigated to an auth route).
            notification.destroy(NOTIFICATION_KEY);
        };
    }, [handleDismiss, handleReload, notification, onDismiss]);

    return null;
};

export default SwUpdateToast;
