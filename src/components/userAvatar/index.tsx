import { User } from "lucide-react";
import * as React from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

import { avatarGradients, fontWeight } from "../../theme/tokens";

/**
 * Pulls one of the brand-aligned gradients deterministically from a stable
 * id (project id, member id, etc.) so callers that want a per-entity colour
 * cue can opt in via the `background` prop. The default avatar surface no
 * longer uses these gradients — every avatar in the app renders as a
 * white tile with brand-orange foreground (matching the brand mark).
 */
export const gradientFor = (id: string): string => {
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) {
        hash = (hash * 31 + id.charCodeAt(i)) | 0;
    }
    return avatarGradients[Math.abs(hash) % avatarGradients.length];
};

/**
 * Initials from a username. Picks the first letter of the first and last
 * whitespace-separated parts (e.g. "Alice Smith" → "AS"). Falls back to
 * the first character of the input or a literal `?` for empty strings.
 */
export const initialsOf = (name: string | undefined | null): string => {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    const head = parts[0]?.[0] ?? "";
    const tail = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (head + tail).toUpperCase() || name[0].toUpperCase();
};

/** antd Avatar size keyword → pixel diameter, matching antd's own scale. */
const SIZE_PX: Record<string, number> = {
    small: 24,
    default: 32,
    middle: 32,
    large: 40
};

const sizeToPx = (size: UserAvatarProps["size"]): number =>
    typeof size === "number" ? size : (SIZE_PX[size ?? "default"] ?? 32);

interface UserAvatarProps extends Omit<
    React.HTMLAttributes<HTMLSpanElement>,
    "children"
> {
    /** Stable id (member, project, manager) used to pick a brand gradient. */
    id: string;
    /** Display name; first / last initials are derived from it. */
    name?: string | null;
    /** Override the surface (rare — opt in via `gradientFor(id)` if needed). */
    background?: string;
    /** antd-compatible size keyword or an explicit pixel diameter. */
    size?: "small" | "default" | "middle" | "large" | number;
}

/**
 * Single-source-of-truth avatar.
 *
 * Renders as a white tile with a 1 px hairline border and the
 * brand-orange foreground — the same visual language as the inverted
 * brand mark. The foreground is either the per-entity initials (when a
 * name is provided) or a neutral user glyph (the "no name / unknown
 * user" default). Callers who want the legacy per-id gradient surface
 * (e.g. dense list views where colour-coding helps) can opt in by
 * passing `background={gradientFor(id)}`.
 */
const UserAvatar: React.FC<UserAvatarProps> = ({
    id: _id,
    name,
    background,
    size = "small",
    style,
    className,
    ...rest
}) => {
    const px = sizeToPx(size);
    const compact = px <= 32;
    const isDefault = !name || !name.trim();
    return (
        <Avatar
            className={cn(
                "rounded-md font-semibold",
                background
                    ? "border-0 text-white"
                    : "border border-border bg-background text-primary",
                compact ? "text-xs" : "text-sm",
                className
            )}
            style={{
                width: px,
                height: px,
                fontWeight: fontWeight.semibold,
                ...(background ? { background } : {}),
                ...style
            }}
            {...rest}
        >
            <AvatarFallback
                className={cn(
                    "rounded-md bg-transparent font-semibold text-current",
                    compact ? "text-xs" : "text-sm"
                )}
            >
                {isDefault ? (
                    <User aria-hidden className="size-[60%]" />
                ) : (
                    initialsOf(name)
                )}
            </AvatarFallback>
        </Avatar>
    );
};

export default UserAvatar;
