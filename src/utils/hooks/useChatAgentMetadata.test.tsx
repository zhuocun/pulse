import { renderHook, waitFor } from "@testing-library/react";

import environment from "../../constants/env";
import type { AutonomyLevel } from "../../interfaces/agent";
import * as agentClient from "../ai/agentClient";
import useChatAgentMetadata from "./useChatAgentMetadata";

describe("useChatAgentMetadata", () => {
    const origLocal = environment.aiUseLocalEngine;
    const origBase = environment.aiBaseUrl;
    const origEnabled = environment.aiEnabled;

    afterEach(() => {
        agentClient.clearAgentMetadataSessionCache();
        jest.restoreAllMocks();
        Object.defineProperty(environment, "aiUseLocalEngine", {
            configurable: true,
            value: origLocal,
            writable: true
        });
        Object.defineProperty(environment, "aiBaseUrl", {
            configurable: true,
            value: origBase,
            writable: true
        });
        Object.defineProperty(environment, "aiEnabled", {
            configurable: true,
            value: origEnabled,
            writable: true
        });
    });

    it("stays idle when AI base URL is empty", () => {
        Object.defineProperty(environment, "aiUseLocalEngine", {
            configurable: true,
            value: true,
            writable: true
        });
        Object.defineProperty(environment, "aiBaseUrl", {
            configurable: true,
            value: "",
            writable: true
        });
        const { result } = renderHook(() => useChatAgentMetadata());
        expect(result.current).toEqual({ status: "idle" });
    });

    it("loads chat-agent metadata when remote AI is configured", async () => {
        const sample = {
            name: "chat-agent",
            version: "1.0.0",
            description: "d",
            status: "active" as const,
            allowed_autonomy: ["suggest", "plan"] as AutonomyLevel[],
            rate_limit: { per_minute: 10, per_hour: 100 }
        };
        jest.spyOn(
            agentClient,
            "getSessionCachedAgentMetadata"
        ).mockResolvedValue(sample);
        Object.defineProperty(environment, "aiUseLocalEngine", {
            configurable: true,
            value: false,
            writable: true
        });
        Object.defineProperty(environment, "aiBaseUrl", {
            configurable: true,
            value: "https://agents.example",
            writable: true
        });
        Object.defineProperty(environment, "aiEnabled", {
            configurable: true,
            value: true,
            writable: true
        });

        const { result } = renderHook(() => useChatAgentMetadata());

        await waitFor(() => {
            expect(result.current.status).toBe("ready");
        });
        const ready = result.current;
        expect(ready.status).toBe("ready");
        if (ready.status === "ready") {
            expect(ready.data.allowed_autonomy).toEqual(["suggest", "plan"]);
            expect(ready.data.rate_limit).toEqual({
                per_minute: 10,
                per_hour: 100
            });
        }
    });

    it("surfaces error state when metadata fetch fails", async () => {
        jest.spyOn(
            agentClient,
            "getSessionCachedAgentMetadata"
        ).mockRejectedValue(new Error("boom"));
        Object.defineProperty(environment, "aiUseLocalEngine", {
            configurable: true,
            value: false,
            writable: true
        });
        Object.defineProperty(environment, "aiBaseUrl", {
            configurable: true,
            value: "https://agents.example",
            writable: true
        });
        Object.defineProperty(environment, "aiEnabled", {
            configurable: true,
            value: true,
            writable: true
        });

        const { result } = renderHook(() => useChatAgentMetadata());
        await waitFor(() => {
            expect(result.current).toEqual({ status: "error" });
        });
    });
});
