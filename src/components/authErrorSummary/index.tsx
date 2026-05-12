import styled from "@emotion/styled";
import { Form } from "antd";
import { useEffect, useRef } from "react";

import { microcopy } from "../../constants/microcopy";
import { fontSize, fontWeight, space } from "../../theme/tokens";
import { resolveAuthPageErrorMessage } from "../errorBox";

export type AuthErrorFieldMeta = {
    name: string;
    id: string;
    label: string;
};

const SummaryRoot = styled.div`
    border: 1px solid var(--ant-color-error-border, #ffccc7);
    border-radius: var(--ant-border-radius, 6px);
    color: var(--ant-color-text, rgba(15, 23, 42, 0.92));
    margin-bottom: ${space.lg}px;
    outline: none;
    padding: ${space.md}px ${space.lg}px;
`;

const SummaryTitle = styled.h2`
    color: var(--ant-color-error, #ff4d4f);
    font-size: ${fontSize.md}px;
    font-weight: ${fontWeight.semibold};
    margin: 0 0 ${space.xs}px;
`;

const SummaryIntro = styled.p`
    margin: 0 0 ${space.sm}px;
`;

const ErrorList = styled.ul`
    margin: 0;
    padding-inline-start: ${space.lg}px;
`;

const ListItem = styled.li`
    margin: ${space.xxs}px 0;
`;

const FieldAnchor = styled.a`
    color: var(--ant-color-link);
`;

const SrOnly = styled.span`
    border: 0;
    clip: rect(0, 0, 0, 0);
    height: 1px;
    margin: -1px;
    overflow: hidden;
    padding: 0;
    /*
     * The 1×1 clip keeps the box visually invisible, but the element
     * still occupies a hit-test target above whatever it is positioned
     * over. Drop pointer-events so the visible button beneath always
     * receives the click — matches the SR-only pattern used in
     * commandPalette and the board filter announcer.
     */
    pointer-events: none;
    position: absolute;
    white-space: nowrap;
    width: 1px;
`;

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

    useEffect(() => {
        if (visible) {
            ref.current?.focus();
        }
    }, [visible, apiMessage, fieldErrors.length]);

    if (!visible) {
        return null;
    }

    return (
        <SummaryRoot
            ref={ref}
            aria-describedby="auth-error-summary-intro auth-error-summary-sr-only"
            aria-labelledby="auth-error-summary-title"
            id="auth-error-summary"
            role="alert"
            tabIndex={-1}
        >
            <SummaryTitle id="auth-error-summary-title">
                {microcopy.auth.errorSummaryTitle}
            </SummaryTitle>
            <SummaryIntro id="auth-error-summary-intro">
                {microcopy.auth.errorSummaryIntro}
            </SummaryIntro>
            <SrOnly id="auth-error-summary-sr-only">
                {microcopy.auth.errorSummaryRegionAriaLabel}
            </SrOnly>
            <ErrorList>
                {apiMessage ? (
                    <ListItem key="_api">{apiMessage}</ListItem>
                ) : null}
                {fieldErrors.map(({ meta, message }) => (
                    <ListItem key={meta.name}>
                        <FieldAnchor
                            href={`#${meta.id}`}
                            onClick={(event) => {
                                event.preventDefault();
                                document
                                    .getElementById(meta.id)
                                    ?.focus({ preventScroll: true });
                            }}
                        >
                            {`${meta.label}: ${message}`}
                        </FieldAnchor>
                    </ListItem>
                ))}
            </ErrorList>
        </SummaryRoot>
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
    const form = Form.useFormInstance();
    return (
        <Form.Item shouldUpdate noStyle>
            {() => {
                const apiMessage = resolveAuthPageErrorMessage(serverError);
                const fieldErrors = includeFieldErrors
                    ? fields
                          .map((meta) => {
                              const errs = form.getFieldError(meta.name);
                              return errs.length
                                  ? { meta, message: errs[0] ?? "" }
                                  : null;
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
            }}
        </Form.Item>
    );
};

export default AuthErrorSummary;
