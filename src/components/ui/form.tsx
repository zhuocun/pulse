import * as React from "react";

import { cn } from "@/lib/utils";

import { Label } from "./label";

/**
 * Form — a small, antd-compatible form abstraction that replaces
 * `antd` `Form` / `Form.Item` with the *smallest* surface the current call
 * sites (`loginForm`, `registerForm`, `projectModal`, `taskCreator`) rely on:
 *
 *   const [form] = Form.useForm<Values>();
 *   <Form form={form} layout="vertical" onFinish={fn} onFinishFailed={fn}>
 *     <Form.Item name="email" label={…} rules={[{ required, message }]}>
 *       <Input />
 *     </Form.Item>
 *   </Form>
 *   Form.useWatch("email", form);
 *   form.submit() / resetFields() / setFieldsValue() / isFieldsTouched()
 *
 * Controls are wired antd-style: `Form.Item` clones its single child and
 * injects `valuePropName` (default `value`) + `trigger` (default `onChange`).
 * Native inputs work out of the box; value-emitting primitives pass
 * `valuePropName`/`trigger` (e.g. `<Form.Item valuePropName="checked"
 * trigger="onCheckedChange">` for `Checkbox`/`Switch`, or `trigger=
 * "onValueChange"` for `Select`) — see PRIMITIVE-MAP.
 */
export type FieldValue = unknown;
export type FormValues = Record<string, FieldValue>;

export interface Rule {
    required?: boolean;
    whitespace?: boolean;
    message?: string;
    type?: "email" | "string" | "number";
    min?: number;
    max?: number;
    len?: number;
    pattern?: RegExp;
    validator?: (value: FieldValue) => string | undefined;
}

interface FieldMeta {
    rules: Rule[];
    validateTrigger: string[];
}

interface FormState<Values extends FormValues> {
    values: Partial<Values>;
    errors: Record<string, string[]>;
    touched: Record<string, boolean>;
}

export interface ErrorField {
    name: string;
    errors: string[];
}

export interface FinishFailedInfo<Values extends FormValues> {
    values: Partial<Values>;
    errorFields: ErrorField[];
}

interface FormCallbacks<Values extends FormValues> {
    onFinish?: (values: Values) => void;
    onFinishFailed?: (info: FinishFailedInfo<Values>) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isEmpty = (value: FieldValue): boolean =>
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.length === 0);

const runRules = (value: FieldValue, rules: Rule[]): string[] => {
    const errors: string[] = [];
    const push = (rule: Rule, fallback: string) => {
        errors.push(rule.message ?? fallback);
    };
    for (const rule of rules) {
        if (rule.required && isEmpty(value)) {
            push(rule, "This field is required");
            continue;
        }
        if (
            rule.required &&
            rule.whitespace &&
            typeof value === "string" &&
            value.trim().length === 0
        ) {
            push(rule, "This field is required");
            continue;
        }
        if (isEmpty(value)) continue;
        if (rule.type === "email" && typeof value === "string") {
            if (!EMAIL_RE.test(value)) push(rule, "Enter a valid email");
        }
        if (typeof rule.min === "number") {
            const size =
                typeof value === "number" ? value : String(value).length;
            if (size < rule.min) push(rule, `Must be at least ${rule.min}`);
        }
        if (typeof rule.max === "number") {
            const size =
                typeof value === "number" ? value : String(value).length;
            if (size > rule.max) push(rule, `Must be at most ${rule.max}`);
        }
        if (typeof rule.len === "number" && String(value).length !== rule.len) {
            push(rule, `Must be exactly ${rule.len} characters`);
        }
        if (rule.pattern && !rule.pattern.test(String(value))) {
            push(rule, "Invalid format");
        }
        if (rule.validator) {
            const result = rule.validator(value);
            if (result) errors.push(result);
        }
    }
    return errors;
};

/** antd-parity field descriptor for `setFields`. */
export interface FieldData {
    name: string;
    value?: FieldValue;
    errors?: string[];
    touched?: boolean;
}

export interface FormInstance<Values extends FormValues = FormValues> {
    submit(): void;
    resetFields(names?: string[]): void;
    setFieldsValue(values: Partial<Values>): void;
    setFieldValue(name: keyof Values & string, value: FieldValue): void;
    /** antd parity: imperatively set value/errors/touched on named fields. */
    setFields(fields: FieldData[]): void;
    getFieldsValue(): Partial<Values>;
    getFieldValue(name: keyof Values & string): FieldValue;
    getFieldError(name: string): string[];
    isFieldsTouched(): boolean;
    validateFields(): Promise<Values>;
    /** Internal wiring used by `<Form>` and `<Form.Item>`; not a public API. */
    internals: {
        subscribe(listener: () => void): () => void;
        getState(): FormState<Values>;
        registerField(name: string, meta: FieldMeta): () => void;
        setCallbacks(cb: FormCallbacks<Values>): void;
        setInitialValues(values: Partial<Values>): void;
        validateField(name: string): string[];
        markTouched(name: string): void;
    };
}

export const createForm = <
    Values extends FormValues = FormValues
>(): FormInstance<Values> => {
    let state: FormState<Values> = { values: {}, errors: {}, touched: {} };
    let initialValues: Partial<Values> = {};
    const fields = new Map<string, FieldMeta>();
    const callbacks: FormCallbacks<Values> = {};
    const listeners = new Set<() => void>();

    const emit = () => listeners.forEach((l) => l());
    const setState = (next: FormState<Values>) => {
        state = next;
        emit();
    };

    const setValues = (partial: Partial<Values>, touch: boolean) => {
        const values = { ...state.values, ...partial };
        const touched = touch
            ? {
                  ...state.touched,
                  ...Object.fromEntries(
                      Object.keys(partial).map((k) => [k, true])
                  )
              }
            : state.touched;
        setState({ ...state, values, touched });
    };

    const validateField = (name: string): string[] => {
        const meta = fields.get(name);
        if (!meta) return [];
        const errs = runRules(state.values[name], meta.rules);
        setState({ ...state, errors: { ...state.errors, [name]: errs } });
        return errs;
    };

    const validateAll = (): ErrorField[] => {
        const nextErrors: Record<string, string[]> = {};
        const errorFields: ErrorField[] = [];
        for (const [name, meta] of fields) {
            const errs = runRules(state.values[name], meta.rules);
            nextErrors[name] = errs;
            if (errs.length > 0) errorFields.push({ name, errors: errs });
        }
        setState({ ...state, errors: nextErrors });
        return errorFields;
    };

    return {
        submit() {
            const errorFields = validateAll();
            if (errorFields.length === 0) {
                callbacks.onFinish?.(state.values as Values);
            } else {
                callbacks.onFinishFailed?.({
                    values: state.values,
                    errorFields
                });
            }
        },
        resetFields(names) {
            if (names && names.length > 0) {
                const values = { ...state.values };
                const errors = { ...state.errors };
                const touched = { ...state.touched };
                for (const name of names) {
                    values[name as keyof Values] =
                        initialValues[name as keyof Values];
                    delete errors[name];
                    delete touched[name];
                }
                setState({ values, errors, touched });
                return;
            }
            setState({ values: { ...initialValues }, errors: {}, touched: {} });
        },
        setFieldsValue(values) {
            setValues(values, false);
        },
        setFieldValue(name, value) {
            setValues({ [name]: value } as Partial<Values>, true);
        },
        setFields(fieldsToSet) {
            const values = { ...state.values };
            const errors = { ...state.errors };
            const touched = { ...state.touched };
            for (const field of fieldsToSet) {
                if ("value" in field) {
                    values[field.name as keyof Values] =
                        field.value as Values[keyof Values];
                }
                if (field.errors) errors[field.name] = field.errors;
                if (field.touched !== undefined) {
                    touched[field.name] = field.touched;
                }
            }
            setState({ values, errors, touched });
        },
        getFieldsValue() {
            return state.values;
        },
        getFieldValue(name) {
            return state.values[name];
        },
        getFieldError(name) {
            return state.errors[name] ?? [];
        },
        isFieldsTouched() {
            return Object.values(state.touched).some(Boolean);
        },
        validateFields() {
            const errorFields = validateAll();
            if (errorFields.length === 0) {
                return Promise.resolve(state.values as Values);
            }
            return Promise.reject<Values>({
                values: state.values,
                errorFields
            });
        },
        internals: {
            subscribe(listener) {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
            getState() {
                return state;
            },
            registerField(name, meta) {
                fields.set(name, meta);
                if (
                    initialValues[name as keyof Values] !== undefined &&
                    state.values[name as keyof Values] === undefined
                ) {
                    setValues(
                        {
                            [name]: initialValues[name as keyof Values]
                        } as Partial<Values>,
                        false
                    );
                }
                return () => {
                    fields.delete(name);
                };
            },
            setCallbacks(cb) {
                callbacks.onFinish = cb.onFinish;
                callbacks.onFinishFailed = cb.onFinishFailed;
            },
            setInitialValues(values) {
                initialValues = values;
                if (Object.keys(state.values).length === 0) {
                    setState({ ...state, values: { ...values } });
                }
            },
            validateField,
            markTouched(name) {
                if (state.touched[name]) return;
                setState({
                    ...state,
                    touched: { ...state.touched, [name]: true }
                });
            }
        }
    };
};

interface FormContextValue {
    form: FormInstance;
    layout: "vertical" | "horizontal" | "inline";
}

const FormContext = React.createContext<FormContextValue | null>(null);

const useFormContext = (): FormContextValue => {
    const ctx = React.useContext(FormContext);
    if (!ctx) {
        throw new Error("Form.Item must be rendered inside a <Form>");
    }
    return ctx;
};

/** antd parity: `const [form] = Form.useForm<Values>();` */
export function useForm<Values extends FormValues = FormValues>(): [
    FormInstance<Values>
] {
    const ref = React.useRef<FormInstance<Values> | null>(null);
    if (ref.current === null) {
        ref.current = createForm<Values>();
    }
    return [ref.current];
}

export const useFormState = <Values extends FormValues>(
    form: FormInstance<Values>
): FormState<Values> =>
    React.useSyncExternalStore(
        form.internals.subscribe,
        form.internals.getState,
        form.internals.getState
    );

/**
 * antd parity: `Form.useFormInstance()` — read the ambient form instance
 * from the nearest `<Form>` ancestor. Lets a descendant (e.g. an error
 * summary) subscribe to field errors without prop-drilling the instance.
 */
export function useFormInstance<
    Values extends FormValues = FormValues
>(): FormInstance<Values> {
    const ctx = React.useContext(FormContext);
    if (!ctx) {
        throw new Error("useFormInstance must be used inside a <Form>");
    }
    return ctx.form as FormInstance<Values>;
}

/** antd parity: `Form.useWatch(name, form)`. */
export function useWatch<Values extends FormValues = FormValues>(
    name: keyof Values & string,
    form: FormInstance<Values>
): FieldValue {
    const state = useFormState(form);
    return state.values[name];
}

export interface FormProps<Values extends FormValues = FormValues> extends Omit<
    React.FormHTMLAttributes<HTMLFormElement>,
    "onSubmit"
> {
    form: FormInstance<Values>;
    layout?: "vertical" | "horizontal" | "inline";
    initialValues?: Partial<Values>;
    onFinish?: (values: Values) => void;
    onFinishFailed?: (info: FinishFailedInfo<Values>) => void;
}

function FormComponent<Values extends FormValues = FormValues>({
    form,
    layout = "vertical",
    initialValues,
    onFinish,
    onFinishFailed,
    className,
    children,
    ...props
}: FormProps<Values>) {
    form.internals.setCallbacks({ onFinish, onFinishFailed });
    const initialRef = React.useRef(false);
    if (!initialRef.current) {
        // Seed initial values before the first paint so controlled inputs
        // mount with the right value; guarded so it runs exactly once.
        if (initialValues) form.internals.setInitialValues(initialValues);
        initialRef.current = true;
    }
    const ctx = React.useMemo<FormContextValue>(
        () => ({ form: form as FormInstance, layout }),
        [form, layout]
    );
    return (
        <FormContext.Provider value={ctx}>
            <form
                noValidate
                className={cn(
                    layout === "inline"
                        ? "flex flex-wrap items-end gap-md"
                        : "flex flex-col gap-md",
                    className
                )}
                onSubmit={(event) => {
                    event.preventDefault();
                    form.submit();
                }}
                {...props}
            >
                {children}
            </form>
        </FormContext.Provider>
    );
}

type InjectableProps = Record<string, unknown>;

export interface FormItemProps {
    name?: string;
    label?: React.ReactNode;
    rules?: Rule[];
    validateTrigger?: string | string[];
    extra?: React.ReactNode;
    help?: React.ReactNode;
    required?: boolean;
    valuePropName?: string;
    trigger?: string;
    getValueFromEvent?: (arg: unknown) => FieldValue;
    className?: string;
    children?: React.ReactNode;
}

const defaultGetValue = (arg: unknown): FieldValue => {
    if (
        arg &&
        typeof arg === "object" &&
        "target" in arg &&
        (arg as { target?: unknown }).target &&
        typeof (arg as { target: unknown }).target === "object"
    ) {
        const target = (arg as { target: HTMLInputElement }).target;
        return target.type === "checkbox" ? target.checked : target.value;
    }
    return arg as FieldValue;
};

function FormItem({
    name,
    label,
    rules = [],
    validateTrigger = "onChange",
    extra,
    help,
    required,
    valuePropName = "value",
    trigger = "onChange",
    getValueFromEvent,
    className,
    children
}: FormItemProps) {
    const { form, layout } = useFormContext();
    const state = useFormState(form);
    const triggers = React.useMemo(
        () =>
            Array.isArray(validateTrigger)
                ? validateTrigger
                : [validateTrigger],
        [validateTrigger]
    );

    React.useEffect(() => {
        if (!name) return;
        return form.internals.registerField(name, {
            rules,
            validateTrigger: triggers
        });
    }, [name, form, rules, triggers]);

    const reactId = React.useId();
    const errors = name ? (state.errors[name] ?? []) : [];
    const hasError = errors.length > 0;
    const isRequired = required ?? rules.some((rule) => rule.required === true);

    // Honor an explicit `id` the caller set on the control so the label,
    // the control, and any external anchor (e.g. an error-summary link
    // that focuses `#email`) all agree on one id.
    const childId =
        React.isValidElement(children) &&
        typeof (children.props as InjectableProps).id === "string"
            ? ((children.props as InjectableProps).id as string)
            : undefined;
    const controlId = childId ?? `${reactId}-control`;

    const labelNode = label ? (
        <Label
            htmlFor={name || childId ? controlId : undefined}
            className={cn(
                hasError && "text-destructive",
                // Render the required marker as a CSS pseudo-element so it
                // stays out of the label's textContent — otherwise a
                // baked-in "*" pollutes `getByLabelText`/accessible-name
                // lookups and reads to screen readers.
                isRequired &&
                    "after:ml-xxs after:text-destructive after:content-['*']"
            )}
        >
            {label}
        </Label>
    ) : null;

    const describedByIds = [
        hasError ? `${reactId}-error` : null,
        (extra || help) && !hasError ? `${reactId}-extra` : null
    ]
        .filter(Boolean)
        .join(" ");

    let control = children;
    if (name && React.isValidElement(children)) {
        const child = children as React.ReactElement<InjectableProps>;
        const childProps = child.props;
        const originalTrigger = childProps[trigger] as
            | ((...args: unknown[]) => void)
            | undefined;
        const originalBlur = childProps.onBlur as
            | ((event: React.FocusEvent) => void)
            | undefined;
        const injected: InjectableProps = {
            id: controlId,
            [valuePropName]: state.values[name] ?? "",
            [trigger]: (...args: unknown[]) => {
                const value = getValueFromEvent
                    ? getValueFromEvent(args[0])
                    : defaultGetValue(args[0]);
                form.setFieldValue(name, value);
                if (triggers.includes("onChange")) {
                    form.internals.validateField(name);
                }
                originalTrigger?.(...args);
            },
            onBlur: (event: React.FocusEvent) => {
                form.internals.markTouched(name);
                if (triggers.includes("onBlur")) {
                    form.internals.validateField(name);
                }
                originalBlur?.(event);
            },
            "aria-invalid": hasError || undefined,
            "aria-required": isRequired || undefined,
            "aria-describedby": describedByIds || undefined
        };
        control = React.cloneElement(child, injected);
    }

    return (
        <div
            className={cn(
                layout === "inline"
                    ? "flex flex-col gap-xxs"
                    : "flex flex-col gap-xxs",
                className
            )}
        >
            {labelNode}
            {control}
            {hasError ? (
                <p
                    id={`${reactId}-error`}
                    role="alert"
                    className="text-sm text-destructive"
                >
                    {errors[0]}
                </p>
            ) : null}
            {(extra || help) && !hasError ? (
                <div
                    id={`${reactId}-extra`}
                    className="text-sm text-muted-foreground"
                >
                    {help ?? extra}
                </div>
            ) : null}
        </div>
    );
}
FormItem.displayName = "Form.Item";

type FormType = typeof FormComponent & {
    Item: typeof FormItem;
    useForm: typeof useForm;
    useWatch: typeof useWatch;
    useFormInstance: typeof useFormInstance;
};

const Form = FormComponent as FormType;
Form.Item = FormItem;
Form.useForm = useForm;
Form.useWatch = useWatch;
Form.useFormInstance = useFormInstance;

export { Form, FormItem };
