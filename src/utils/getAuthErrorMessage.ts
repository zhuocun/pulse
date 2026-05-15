import extractErrorMessage from "./extractErrorMessage";

/** Normalize login/register error payloads from varied backend shapes. */
const getAuthErrorMessage = (body: unknown): string => {
    if (body === null || body === undefined) return "Request failed";
    return extractErrorMessage(body) ?? "Operation failed";
};

export default getAuthErrorMessage;
