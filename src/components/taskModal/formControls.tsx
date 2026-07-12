import { Check, ChevronDown, X } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { microcopy } from "../../constants/microcopy";
import { labelTagProps } from "../../utils/labelTagColor";

/**
 * Shared form controls for the task-edit surfaces (`TaskModal` +
 * `TaskDetailPanel`). These compose the shadcn primitives into the
 * antd-`Select`/`DatePicker` variants the task form relies on but which the
 * S2 primitive set intentionally does not ship: a searchable + clearable
 * single-select, a searchable + clearable multi-select with color tags, and
 * a native date field. See the missing-primitive report in the batch summary.
 *
 * Every control accepts the `value` / `onChange` pair that `ui/form`'s
 * `Form.Item` injects, so they drop into `<Form.Item>` the same way a bare
 * `<Input>` does.
 */

export const formatTemplate = (
    template: string,
    values: Record<string, string | number>
): string =>
    Object.entries(values).reduce(
        (acc, [key, value]) => acc.replace(`{${key}}`, String(value)),
        template
    );

/* -- Responsive breakpoints (replaces antd `Grid.useBreakpoint`) -------- */

const BREAKPOINT_QUERIES = {
    sm: "(min-width: 576px)",
    md: "(min-width: 768px)",
    lg: "(min-width: 992px)"
} as const;

export interface ResponsiveScreens {
    sm: boolean;
    md: boolean;
    lg: boolean;
}

const readScreens = (): ResponsiveScreens => {
    if (
        typeof window === "undefined" ||
        typeof window.matchMedia !== "function"
    ) {
        return { sm: false, md: false, lg: false };
    }
    return {
        sm: window.matchMedia(BREAKPOINT_QUERIES.sm).matches,
        md: window.matchMedia(BREAKPOINT_QUERIES.md).matches,
        lg: window.matchMedia(BREAKPOINT_QUERIES.lg).matches
    };
};

/**
 * `screens.sm` / `screens.md` / `screens.lg` booleans, matching the subset
 * of antd's `Grid.useBreakpoint()` the task surfaces read. jsdom / SSR paths
 * resolve to `false` (the phone-stacked footer), matching antd's behavior
 * under the suite's `matchMedia` mock.
 */
export const useResponsiveScreens = (): ResponsiveScreens => {
    const [screens, setScreens] =
        React.useState<ResponsiveScreens>(readScreens);
    React.useEffect(() => {
        if (
            typeof window === "undefined" ||
            typeof window.matchMedia !== "function"
        ) {
            return;
        }
        const lists = Object.values(BREAKPOINT_QUERIES).map((query) =>
            window.matchMedia(query)
        );
        const handler = () => setScreens(readScreens());
        lists.forEach((list) => {
            if (typeof list.addEventListener === "function") {
                list.addEventListener("change", handler);
            } else if (typeof list.addListener === "function") {
                list.addListener(handler);
            }
        });
        return () => {
            lists.forEach((list) => {
                if (typeof list.removeEventListener === "function") {
                    list.removeEventListener("change", handler);
                } else if (typeof list.removeListener === "function") {
                    list.removeListener(handler);
                }
            });
        };
    }, []);
    return screens;
};

/* -- Native date field (replaces antd `DatePicker`) --------------------- */

export interface DateFieldProps {
    value?: string;
    onChange?: (value: string | undefined) => void;
    placeholder?: string;
    id?: string;
    disabled?: boolean;
    "aria-label"?: string;
    "aria-labelledby"?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
    "aria-required"?: boolean;
    onBlur?: React.FocusEventHandler<HTMLInputElement>;
}

/**
 * Date field backed by a native `<input type="date">`. Persists / emits the
 * date-only ISO string (`YYYY-MM-DD`) the task payload stores, and emits
 * `undefined` when cleared so the caller's `?? null` coercion clears the
 * field on the wire.
 */
export const DateField = React.forwardRef<HTMLInputElement, DateFieldProps>(
    ({ value, onChange, placeholder, disabled, onBlur, ...aria }, ref) => {
        const current = typeof value === "string" ? value : "";
        return (
            <div className="relative">
                <Input
                    ref={ref}
                    disabled={disabled}
                    onBlur={onBlur}
                    onChange={(event) =>
                        onChange?.(event.target.value || undefined)
                    }
                    placeholder={placeholder}
                    type="date"
                    value={current}
                    {...aria}
                />
            </div>
        );
    }
);
DateField.displayName = "DateField";

/* -- Shared listbox option shape ---------------------------------------- */

export interface SelectFieldOption {
    value: string;
    label: string;
    color?: string;
}

const triggerClass = cn(
    "flex h-10 w-full items-center justify-between gap-xs rounded-md border border-input bg-background px-sm py-xs text-sm text-foreground",
    "ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
    "disabled:cursor-not-allowed disabled:opacity-50 coarse:min-h-[44px]"
);

const optionClass = cn(
    "flex w-full cursor-pointer select-none items-center gap-xs rounded-sm px-xs py-xs text-sm outline-none",
    "hover:bg-muted focus:bg-muted coarse:min-h-[44px]"
);

const ColorDot: React.FC<{ color?: string }> = ({ color }) =>
    color ? (
        <span
            aria-hidden
            className="inline-block size-[10px] flex-none rounded-full"
            style={{ background: color }}
        />
    ) : null;

const useOptionFilter = (options: SelectFieldOption[], query: string) =>
    React.useMemo(() => {
        const trimmed = query.trim().toLowerCase();
        if (!trimmed) return options;
        return options.filter((option) =>
            option.label.toLowerCase().includes(trimmed)
        );
    }, [options, query]);

/* -- Single select (searchable + clearable) ----------------------------- */

export interface SelectFieldProps {
    value?: string | number;
    onChange?: (value: string | undefined) => void;
    options: SelectFieldOption[];
    placeholder?: string;
    showSearch?: boolean;
    allowClear?: boolean;
    disabled?: boolean;
    id?: string;
    "aria-label"?: string;
    "aria-labelledby"?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
    "aria-required"?: boolean;
    onBlur?: React.FocusEventHandler<HTMLButtonElement>;
}

/**
 * Single-select replacement for antd `Select`: composes `Popover` + a
 * `role="listbox"` of `role="option"` rows. Supports optional client-side
 * search (`showSearch`) and a clear affordance (`allowClear`). Accepts a
 * number `value` (e.g. story points) — matching is stringified internally so
 * the caller keeps its native value type through `Form.Item`.
 */
export const SelectField: React.FC<SelectFieldProps> = ({
    value,
    onChange,
    options,
    placeholder,
    showSearch = false,
    allowClear = false,
    disabled,
    id,
    onBlur,
    ...aria
}) => {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState("");
    const listboxId = React.useId();
    const selectedValue =
        value === undefined || value === null || value === ""
            ? undefined
            : String(value);
    const selected = options.find((option) => option.value === selectedValue);
    const filtered = useOptionFilter(options, showSearch ? query : "");

    React.useEffect(() => {
        if (!open) setQuery("");
    }, [open]);

    return (
        <Popover onOpenChange={setOpen} open={open}>
            <div className="relative">
                <PopoverTrigger asChild>
                    <button
                        aria-controls={listboxId}
                        aria-expanded={open}
                        aria-haspopup="listbox"
                        className={cn(
                            triggerClass,
                            allowClear && selected ? "pr-xl" : undefined
                        )}
                        disabled={disabled}
                        id={id}
                        onBlur={onBlur}
                        role="combobox"
                        type="button"
                        {...aria}
                    >
                        <span
                            className={cn(
                                "flex items-center gap-xs truncate",
                                selected ? undefined : "text-muted-foreground"
                            )}
                        >
                            {selected ? (
                                <>
                                    <ColorDot color={selected.color} />
                                    {selected.label}
                                </>
                            ) : (
                                placeholder
                            )}
                        </span>
                        <ChevronDown
                            aria-hidden
                            className="size-4 opacity-50"
                        />
                    </button>
                </PopoverTrigger>
                {allowClear && selected ? (
                    <button
                        aria-label={microcopy.actions.clear}
                        className="absolute right-lg top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                        onClick={() => onChange?.(undefined)}
                        type="button"
                    >
                        <X aria-hidden className="size-3.5" />
                    </button>
                ) : null}
            </div>
            <PopoverContent
                align="start"
                className="w-[var(--radix-popover-trigger-width)] p-xxs"
                onOpenAutoFocus={(event) => {
                    if (!showSearch) event.preventDefault();
                }}
            >
                {showSearch ? (
                    <Input
                        aria-label={microcopy.actions.search}
                        className="mb-xxs h-9"
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={microcopy.actions.search}
                        value={query}
                    />
                ) : null}
                <ul
                    className="max-h-60 overflow-y-auto"
                    id={listboxId}
                    role="listbox"
                >
                    {filtered.map((option) => {
                        const isSelected = option.value === selectedValue;
                        return (
                            <li
                                aria-selected={isSelected}
                                className={optionClass}
                                key={option.value}
                                onClick={() => {
                                    onChange?.(option.value);
                                    setOpen(false);
                                }}
                                onKeyDown={(event) => {
                                    if (
                                        event.key === "Enter" ||
                                        event.key === " "
                                    ) {
                                        event.preventDefault();
                                        onChange?.(option.value);
                                        setOpen(false);
                                    }
                                }}
                                role="option"
                                tabIndex={0}
                            >
                                <ColorDot color={option.color} />
                                <span className="flex-1 truncate">
                                    {option.label}
                                </span>
                                {isSelected ? (
                                    <Check aria-hidden className="size-4" />
                                ) : null}
                            </li>
                        );
                    })}
                </ul>
            </PopoverContent>
        </Popover>
    );
};

/* -- Multi select (searchable + clearable, color tags) ------------------ */

export interface MultiSelectFieldProps {
    value?: string[];
    onChange?: (value: string[]) => void;
    options: SelectFieldOption[];
    placeholder?: string;
    disabled?: boolean;
    id?: string;
    "aria-label"?: string;
    "aria-labelledby"?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
    "aria-required"?: boolean;
    onBlur?: React.FocusEventHandler<HTMLButtonElement>;
}

/**
 * Multi-select replacement for antd `Select mode="multiple"`: `Popover` +
 * checkable `role="option"` rows, with selected values surfaced as color
 * `Badge` tags and a clear-all affordance. Selection toggles from the
 * dropdown (the antd tag-close affordance maps to unchecking the row);
 * clear-all empties the value.
 */
export const MultiSelectField: React.FC<MultiSelectFieldProps> = ({
    value,
    onChange,
    options,
    placeholder,
    disabled,
    id,
    onBlur,
    ...aria
}) => {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState("");
    const listboxId = React.useId();
    const selected = React.useMemo(
        () => (Array.isArray(value) ? value : []),
        [value]
    );
    const filtered = useOptionFilter(options, query);

    React.useEffect(() => {
        if (!open) setQuery("");
    }, [open]);

    const toggle = (optionValue: string) => {
        if (selected.includes(optionValue)) {
            onChange?.(selected.filter((item) => item !== optionValue));
        } else {
            onChange?.([...selected, optionValue]);
        }
    };

    const selectedOptions = selected
        .map((selectedValue) =>
            options.find((option) => option.value === selectedValue)
        )
        .filter((option): option is SelectFieldOption => Boolean(option));

    return (
        <Popover onOpenChange={setOpen} open={open}>
            <div
                className={cn(
                    "flex min-h-10 w-full flex-wrap items-center gap-xxs rounded-md border border-input bg-background px-xs py-xxs coarse:min-h-[44px]"
                )}
            >
                {selectedOptions.map((option) => {
                    const tagStyle = option.color
                        ? labelTagProps(option.color).style
                        : undefined;
                    return (
                        <Badge
                            className="border-transparent bg-secondary text-secondary-foreground"
                            key={option.value}
                            style={tagStyle}
                        >
                            {option.label}
                        </Badge>
                    );
                })}
                <PopoverTrigger asChild>
                    <button
                        aria-controls={listboxId}
                        aria-expanded={open}
                        aria-haspopup="listbox"
                        className="flex flex-1 items-center justify-between gap-xs bg-transparent text-left text-sm text-muted-foreground outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:min-h-[44px] coarse:min-w-[44px]"
                        disabled={disabled}
                        id={id}
                        onBlur={onBlur}
                        role="combobox"
                        type="button"
                        {...aria}
                    >
                        <span className="truncate">
                            {selectedOptions.length === 0 ? placeholder : null}
                        </span>
                        <ChevronDown
                            aria-hidden
                            className="size-4 opacity-50"
                        />
                    </button>
                </PopoverTrigger>
                {selected.length > 0 ? (
                    <button
                        aria-label={microcopy.actions.clear}
                        className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground coarse:size-11"
                        onClick={() => onChange?.([])}
                        type="button"
                    >
                        <X aria-hidden className="size-3.5" />
                    </button>
                ) : null}
            </div>
            <PopoverContent
                align="start"
                className="w-[var(--radix-popover-trigger-width)] p-xxs"
            >
                <Input
                    aria-label={microcopy.actions.search}
                    className="mb-xxs h-9"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={microcopy.actions.search}
                    value={query}
                />
                <ul
                    className="max-h-60 overflow-y-auto"
                    id={listboxId}
                    role="listbox"
                >
                    {filtered.map((option) => {
                        const isSelected = selected.includes(option.value);
                        return (
                            <li
                                aria-selected={isSelected}
                                className={optionClass}
                                key={option.value}
                                onClick={() => toggle(option.value)}
                                onKeyDown={(event) => {
                                    if (
                                        event.key === "Enter" ||
                                        event.key === " "
                                    ) {
                                        event.preventDefault();
                                        toggle(option.value);
                                    }
                                }}
                                role="option"
                                tabIndex={0}
                            >
                                <span className="flex size-4 items-center justify-center">
                                    {isSelected ? (
                                        <Check aria-hidden className="size-4" />
                                    ) : null}
                                </span>
                                <ColorDot color={option.color} />
                                <span className="flex-1 truncate">
                                    {option.label}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            </PopoverContent>
        </Popover>
    );
};

/* -- Disclosure (replaces antd `Collapse` ghost panel) ------------------ */

export interface DisclosureProps {
    label: React.ReactNode;
    defaultOpen?: boolean;
    children: React.ReactNode;
    className?: string;
}

/**
 * Lightweight disclosure backed by native `<details>` / `<summary>` — the
 * ghost-`Collapse` panels the task form uses (More details, AI assist) don't
 * need Radix's roving-tabindex accordion semantics.
 */
export const Disclosure: React.FC<DisclosureProps> = ({
    label,
    defaultOpen = false,
    children,
    className
}) => (
    <details className={cn("group", className)} open={defaultOpen}>
        <summary className="flex cursor-pointer list-none items-center gap-xs py-xs text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden coarse:min-h-[44px]">
            <ChevronDown
                aria-hidden
                className="size-4 transition-transform group-open:rotate-180"
            />
            {label}
        </summary>
        <div className="pt-xs">{children}</div>
    </details>
);
