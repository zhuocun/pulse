import {
    PasswordStrengthLevel,
    assessPasswordStrength,
    passwordStrengthMeterValue
} from "../../constants/passwordStrength";
import { microcopy } from "../../constants/microcopy";
import { cn } from "@/lib/utils";

type FilledLevel = Exclude<PasswordStrengthLevel, "empty">;

const strengthCaption = (level: FilledLevel) => {
    switch (level) {
        case "tooShort":
            return microcopy.auth.passwordStrength.tooShort;
        case "weak":
            return microcopy.auth.passwordStrength.weak;
        case "fair":
            return microcopy.auth.passwordStrength.fair;
        case "strong":
            return microcopy.auth.passwordStrength.strong;
        default: {
            const exhaustive: never = level;
            return exhaustive;
        }
    }
};

const strengthColorClass = (level: FilledLevel): string => {
    switch (level) {
        case "tooShort":
            return "bg-destructive";
        case "weak":
            return "bg-warning";
        case "fair":
            return "bg-info";
        case "strong":
            return "bg-success";
        default: {
            const exhaustive: never = level;
            return exhaustive;
        }
    }
};

const meterWidthClass = (value: number): string => {
    switch (value) {
        case 1:
            return "w-1/4";
        case 2:
            return "w-2/4";
        case 3:
            return "w-3/4";
        default:
            return "w-full";
    }
};

export const PasswordStrengthHint = ({ password }: { password: string }) => {
    const level = assessPasswordStrength(password);

    if (level === "empty") {
        return null;
    }

    const caption = strengthCaption(level);
    const value = passwordStrengthMeterValue(level);
    const fullLabel = `${microcopy.auth.passwordStrength.meterAriaLabel}: ${caption}`;

    return (
        <div className="mb-xxs">
            <div
                aria-hidden
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            >
                <div
                    className={cn(
                        "h-full rounded-[inherit] transition-[width,background-color] duration-medium ease-out motion-reduce:transition-none",
                        strengthColorClass(level),
                        meterWidthClass(value)
                    )}
                />
            </div>
            <span
                aria-atomic="true"
                aria-label={fullLabel}
                aria-live="polite"
                className="mt-1.5 block text-sm leading-snug text-muted-foreground coarse:text-base"
                role="status"
            >
                {caption}
            </span>
        </div>
    );
};
