import { readAuthToken } from "./tokenStorage";

/** Bearer header for optional AI proxy auth (same token as REST API). */
export const getStoredBearerAuthHeader = (): string => {
    const token = readAuthToken();
    return token ? `Bearer ${token}` : "";
};
