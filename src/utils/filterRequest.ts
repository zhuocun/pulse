const isVoid = (value: unknown) => {
    return (
        value === undefined ||
        value === null ||
        value === "" ||
        (typeof value === "number" ? Number.isNaN(value) : false)
    );
};

const filterRequest = (
    object: { [key: string]: unknown },
    preserveNullKeys?: readonly string[]
) => {
    const preserve = preserveNullKeys ? new Set(preserveNullKeys) : undefined;
    const next: { [key: string]: unknown } = {};
    Object.keys(object).forEach((key) => {
        const value = object[key];
        // Opt-in: for a preserved key, keep anything that isn't `undefined`
        // (so an explicit `null`/`""` reaches the wire to CLEAR the field).
        // All other keys keep the default void-stripping, so callers that
        // pass no `preserveNullKeys` get byte-identical behavior.
        if (preserve?.has(key)) {
            if (value !== undefined) {
                next[key] = value;
            }
        } else if (!isVoid(value)) {
            next[key] = value;
        }
    });
    return next;
};

export default filterRequest;
