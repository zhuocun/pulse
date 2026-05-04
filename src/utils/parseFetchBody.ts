/** Parse JSON bodies safely; non-JSON text returns as a string for error messaging. */
export const parseFetchBody = async (res: Response): Promise<unknown> => {
    if (typeof res.text === "function") {
        const text = await res.text();
        if (!text.trim()) {
            return undefined;
        }
        try {
            return JSON.parse(text) as unknown;
        } catch {
            return text;
        }
    }
    if (typeof res.json === "function") {
        try {
            return await res.json();
        } catch {
            return undefined;
        }
    }
    return undefined;
};
