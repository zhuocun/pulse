import { isMacLike } from "./platform";

describe("isMacLike", () => {
    const originalPlatformDesc = Object.getOwnPropertyDescriptor(
        navigator,
        "platform"
    );
    const originalUserAgentDesc = Object.getOwnPropertyDescriptor(
        navigator,
        "userAgent"
    );
    const originalUserAgentData = (
        navigator as Navigator & { userAgentData?: { platform?: string } }
    ).userAgentData;

    afterEach(() => {
        if (originalPlatformDesc) {
            Object.defineProperty(navigator, "platform", originalPlatformDesc);
        }
        if (originalUserAgentDesc) {
            Object.defineProperty(
                navigator,
                "userAgent",
                originalUserAgentDesc
            );
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

    const setUserAgent = (value: string) => {
        Object.defineProperty(navigator, "userAgent", {
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

    it("falls back to navigator.userAgent when platform is empty (iOS 17+ quirk)", () => {
        // Post-iOS-17 iPhone Safari has been observed to report an
        // empty `navigator.platform`. Without the UA fallback the
        // post-login flow would skip the iOS-specific `nativeNavigate`
        // and stay on the still-mounted login form.
        setUserAgentData(undefined);
        setPlatform("");
        setUserAgent(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) " +
                "AppleWebKit/605.1.15 (KHTML, like Gecko) " +
                "Version/26.0 Mobile/15E148 Safari/604.1"
        );
        expect(isMacLike()).toBe(true);
    });

    it("does not match Android or Windows phones via the userAgent fallback", () => {
        setUserAgentData(undefined);
        setPlatform("");
        setUserAgent(
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) " +
                "AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/126.0.0.0 Mobile Safari/537.36"
        );
        expect(isMacLike()).toBe(false);
    });
});
