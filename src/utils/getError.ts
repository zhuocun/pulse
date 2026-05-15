import extractErrorMessage from "./extractErrorMessage";

const getError = (error: unknown): Error => {
    if (error instanceof Error) return error;
    return new Error(extractErrorMessage(error) ?? "Operation failed");
};

export default getError;
