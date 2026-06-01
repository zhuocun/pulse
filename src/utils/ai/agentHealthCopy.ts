import { microcopy, microcopyString } from "../../constants/microcopy";
import type { UseAgentHealthState } from "../hooks/useAgentHealth";

const fill = (
    template: unknown,
    replacements: Readonly<Record<string, string>>
): string =>
    Object.entries(replacements).reduce(
        (text, [key, value]) => text.replace(`{${key}}`, value),
        microcopyString(template)
    );

export const formatAgentHealthMessage = (
    health: Pick<
        UseAgentHealthState,
        | "status"
        | "provider"
        | "stubMode"
        | "issues"
        | "warnings"
        | "providerConnectivity"
        | "realProviderReady"
    >
): string => {
    if (health.providerConnectivity?.reachable === false) {
        return fill(microcopy.ai.healthProviderUnreachableTemplate, {
            provider:
                health.provider ??
                microcopyString(microcopy.ai.healthProviderGeneric),
            detail: health.providerConnectivity.detail
        });
    }

    const issue = health.issues[0];
    if (issue) {
        return fill(microcopy.ai.healthIssueTemplate, {
            detail: issue
        });
    }

    if (health.stubMode) return microcopyString(microcopy.ai.healthStubMode);

    if (health.status === "degraded" && !health.realProviderReady) {
        return microcopyString(microcopy.ai.healthRealProviderNotReady);
    }

    const warning = health.warnings[0];
    if (health.status === "degraded" && warning) {
        return fill(microcopy.ai.healthWarningTemplate, {
            detail: warning
        });
    }

    if (health.status === "offline") {
        return microcopyString(microcopy.ai.healthOffline);
    }
    return microcopyString(microcopy.ai.healthDegraded);
};
