import { isMacLike } from "./platform";

describe("isMacLike", () => {
    const originalPlatformDesc = Object.getOwnPropertyDescriptor(
        navigator,
        "platform"
    );
    const originalUserAgentData = (
        navigator as Navigator & { userAgentData?: { platform?: string } }
    ).userAgentData;

    afterEach(() => {
        if (originalPlatformDesc) {
            Object.defineProperty(navigator, "platform", originalPlatformDesc);
        }
        (
            navigator as Navigator & { userAgentData?: { platform?: string } }
        ).userAgentData = originalUserAgentData;
    });

    const setPlatform = (value: string) => {
        Object.defineProperty(navigator, "platform", {
            configurable: true,
            get: () => value
        });
    };

    const setUserAgentData = (value: { platform?: string } | undefined) => {
        (
            navigator as Navigator & { userAgentData?: { platform?: string } }
        ).userAgentData = value;
    };

    it("returns true for Mac via legacy navigator.platform", () => {
        setUserAgentData(undefined);
        setPlatform("MacIntel");
        expect(isMacLike()).toBe(true);
    });

    it("returns true for iPhone / iPad / iPod", () => {
        setUserAgentData(undefined);
        for (const value of ["iPhone", "iPad", "iPod touch"]) {
            setPlatform(value);
            expect(isMacLike()).toBe(true);
        }
    });

    it("returns false for Windows / Linux / Android", () => {
        setUserAgentData(undefined);
        for (const value of ["Win32", "Linux x86_64", "Linux armv8l"]) {
            setPlatform(value);
            expect(isMacLike()).toBe(false);
        }
    });

    it("prefers userAgentData.platform when present", () => {
        setUserAgentData({ platform: "macOS" });
        setPlatform("Win32"); // legacy value should be ignored
        expect(isMacLike()).toBe(true);
    });

    it("falls back to navigator.platform when userAgentData has no platform", () => {
        setUserAgentData({});
        setPlatform("Win32");
        expect(isMacLike()).toBe(false);
    });
});
