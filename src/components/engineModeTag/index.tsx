import React from "react";

import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@/components/ui/tooltip";

import environment from "../../constants/env";
import { microcopy } from "../../constants/microcopy";
import CopilotChip from "../copilotChip";

/**
 * Shows whether the current AI surface is running through the local
 * deterministic engine or a configured remote AI service (Optimization
 * Plan §3 P2-6). Pairs with `CopilotPrivacyPopover` so the user sees both
 * "what is sent" and "where it runs" before sending a message.
 *
 * The tooltip explains the capability difference plainly — local mode
 * users should not blame "AI" for rule-based mistakes, and remote mode
 * users should know they're getting language-model output (review first).
 *
 * Pill geometry flows through the shared `<CopilotChip variant="engine">`
 * (Ambition 6 / 2026-05 review §6). The local engine renders in the
 * neutral tone; the remote engine renders in the brand `purple` tone so
 * users get a stronger visual cue that data leaves the device.
 */
const EngineModeTag: React.FC = () => {
    const isLocal = environment.aiUseLocalEngine;
    const label = isLocal
        ? microcopy.ai.processingModeLocalLabel
        : microcopy.ai.processingModeRemoteLabel;
    const tooltip = isLocal
        ? microcopy.ai.engineCapabilityLocal
        : microcopy.ai.engineCapabilityRemote;
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <CopilotChip
                        tone={isLocal ? "default" : "purple"}
                        variant="engine"
                    >
                        {label}
                    </CopilotChip>
                </TooltipTrigger>
                <TooltipContent>{tooltip}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
};

export default EngineModeTag;
