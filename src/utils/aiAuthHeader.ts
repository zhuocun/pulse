import { readAiProxyToken, readAuthToken } from "./tokenStorage";

/** Bearer for AI/agent routes: narrow proxy token when present, else REST JWT. */
export const getStoredBearerAuthHeader = (): string => {
    const narrow = readAiProxyToken();
    if (narrow) {
        return `Bearer ${narrow}`;
    }
    const token = readAuthToken();
    return token ? `Bearer ${token}` : "";
};
