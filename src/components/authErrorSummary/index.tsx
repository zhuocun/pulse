import { useEffect, useRef } from "react";

import { useFormInstance, useFormState } from "@/components/ui/form";

import { microcopy } from "../../constants/microcopy";
import { resolveAuthPageErrorMessage } from "../errorBox";

export type AuthErrorFieldMeta = {
    name: string;
    id: string;
    label: string;
};

type SummaryBodyProps = {
    apiMessage: string | null;
    fieldErrors: Array<{ meta: AuthErrorFieldMeta; message: string }>;
};

const AuthErrorSummaryBody = ({
    apiMessage,
    fieldErrors
}: SummaryBodyProps) => {
    const ref = useRef<HTMLDivElement>(null);
    const visible = Boolean(apiMessage || fieldErrors.length);
    // Focus must move to the summary exactly once per appearance — when
    // visibility transitions from hidden to visible. Depending on
    // ``apiMessage`` or ``fieldErrors.length`` here yanked focus on every
    // validation update, dismissing the iOS keyboard mid-type. Track the
    // previous visibility in a ref so additional rerenders while visible
    // do not steal focus.
    const wasVisibleRef = useRef(false);

    useEffect(() => {
        if (visible && !wasVisibleRef.current) {
            ref.current?.focus();
        }
        wasVisibleRef.current = visible;
    }, [visible]);

    if (!visible) {
        return null;
    }

    return (
        <div
            ref={ref}
            aria-describedby="auth-error-summary-intro auth-error-summary-sr-only"
            aria-labelledby="auth-error-summary-title"
            className="mb-lg rounded-md border border-destructive/50 px-lg py-md text-foreground outline-none"
            id="auth-error-summary"
            role="group"
            tabIndex={-1}
        >
            <h2
                className="mb-xxs text-md font-semibold text-destructive"
                id="auth-error-summary-title"
            >
                {microcopy.auth.errorSummaryTitle}
            </h2>
            <p className="mb-sm" id="auth-error-summary-intro">
                {microcopy.auth.errorSummaryIntro}
            </p>
            {/*
             * The 1×1 clipped announcer sits absolute over the visible
             * submit button on auth pages. `pointer-events-none` keeps the
             * invisible box from intercepting clicks meant for the button
             * beneath it (mirrors the commandPalette / board announcer
             * pattern).
             */}
            <span
                className="sr-only pointer-events-none"
                id="auth-error-summary-sr-only"
            >
                {microcopy.auth.errorSummaryRegionAriaLabel}
            </span>
            <ul className="m-0 ps-lg">
                {apiMessage ? (
                    <li className="my-xxs" key="_api">
                        {apiMessage}
                    </li>
                ) : null}
                {fieldErrors.map(({ meta, message }) => (
                    <li className="my-xxs" key={meta.name}>
                        <a
                            className="[color:var(--pulse-link)] underline-offset-4 hover:underline"
                            href={`#${meta.id}`}
                            onClick={(event) => {
                                event.preventDefault();
                                document
                                    .getElementById(meta.id)
                                    ?.focus({ preventScroll: true });
                            }}
                        >
                            {`${meta.label}: ${message}`}
                        </a>
                    </li>
                ))}
            </ul>
        </div>
    );
};

const AuthErrorSummary = ({
    fields,
    includeFieldErrors,
    serverError
}: {
    fields: readonly AuthErrorFieldMeta[];
    includeFieldErrors: boolean;
    serverError: Error | IError | null | undefined;
}) => {
    const form = useFormInstance();
    const state = useFormState(form);
    const apiMessage = resolveAuthPageErrorMessage(serverError);
    const fieldErrors = includeFieldErrors
        ? fields
              .map((meta) => {
                  const errs = state.errors[meta.name] ?? [];
                  return errs.length ? { meta, message: errs[0] ?? "" } : null;
              })
              .filter(
                  (
                      x
                  ): x is {
                      meta: AuthErrorFieldMeta;
                      message: string;
                  } => x != null
              )
        : [];
    return (
        <AuthErrorSummaryBody
            apiMessage={apiMessage}
            fieldErrors={fieldErrors}
        />
    );
};

export default AuthErrorSummary;
