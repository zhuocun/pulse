import { Alert, Button, Space } from "antd";
import React from "react";

import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import { space as themeSpace } from "../../theme/tokens";
import {
    acknowledgeRemoteAi,
    useRemoteAiConsent
} from "../../utils/ai/remoteAiConsent";
import CopilotPrivacyPopover from "../copilotPrivacyPopover";

/**
 * One-shot consent notice for remote AI processing (Optimization Plan §3
 * P0-2).
 *
 * `EngineModeTag` and `CopilotPrivacyPopover` already make remote mode
 * discoverable, but neither requires acknowledgement. This banner mounts at
 * the top of any AI surface and stays until the user explicitly clicks
 * "I understand". Acknowledgement is keyed by the configured AI base URL —
 * pointing the workspace at a different remote service prompts the user
 * again so a silent endpoint swap can't bypass consent.
 *
 * Renders nothing in local mode (no third-party processing happens) and
 * nothing once the user has acknowledged.
 */
interface CopilotRemoteConsentNoticeProps {
    /**
     * Optional route hint passed through to the embedded privacy popover so
     * "What is shared?" reflects the surface the user is actually on
     * (chat shows chat scope, brief shows brief scope, etc.).
     */
    route?: React.ComponentProps<typeof CopilotPrivacyPopover>["route"];
}

const getRemoteOrigin = (baseUrl: string): string | null => {
    if (!baseUrl.trim()) return null;
    try {
        return new URL(baseUrl).origin;
    } catch {
        return null;
    }
};

const CopilotRemoteConsentNotice: React.FC<CopilotRemoteConsentNoticeProps> = ({
    route
}) => {
    const isLocal = environment.aiUseLocalEngine;
    const baseUrl = environment.aiBaseUrl;
    const acknowledged = useRemoteAiConsent(baseUrl);
    if (isLocal || acknowledged) return null;
    const origin = getRemoteOrigin(baseUrl);
    const body = origin
        ? microcopy.ai.remoteConsentBody.replace("{origin}", origin)
        : microcopy.ai.remoteConsentBodyGeneric;
    const onAccept = () => {
        acknowledgeRemoteAi(baseUrl);
    };
    const description = (
        <>
            <p style={{ margin: 0 }}>{body}</p>
            <Space size={themeSpace.xs} style={{ marginTop: themeSpace.xs }}>
                <CopilotPrivacyPopover
                    label={microcopy.ai.remoteConsentLearnMore}
                    placement="bottomRight"
                    route={route}
                />
                <Button onClick={onAccept} size="small" type="primary">
                    {microcopy.ai.remoteConsentAccept}
                </Button>
            </Space>
        </>
    );
    return (
        <Alert
            description={description}
            message={microcopy.ai.remoteConsentTitle}
            showIcon
            style={{ marginBottom: themeSpace.sm }}
            type="warning"
        />
    );
};

export default CopilotRemoteConsentNotice;
