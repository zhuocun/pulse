import { UserOutlined } from "@ant-design/icons";
import { Avatar } from "antd";
import type { AvatarProps } from "antd";

import { avatarGradients, fontSize, fontWeight } from "../../theme/tokens";

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

interface UserAvatarProps extends Omit<AvatarProps, "children"> {
    /** Stable id (member, project, manager) used to pick a brand gradient. */
    id: string;
    /** Display name; first / last initials are derived from it. */
    name?: string | null;
    /** Override the surface (rare — opt in via `gradientFor(id)` if needed). */
    background?: string;
}

/**
 * Single-source-of-truth avatar.
 *
 * Renders as a white tile with a 1 px hairline border and the
 * brand-orange foreground — the same visual language as the inverted
 * brand mark. The foreground is either the per-entity initials (when a
 * name is provided) or the AntD `UserOutlined` icon (the "no name /
 * unknown user" default). Callers who want the legacy per-id gradient
 * surface (e.g. dense list views where colour-coding helps) can opt in
 * by passing `background={gradientFor(id)}`.
 */
const UserAvatar: React.FC<UserAvatarProps> = ({
    id: _id,
    name,
    background,
    size = "small",
    style,
    ...rest
}) => {
    const compact = size === "small" || size === "default";
    const isDefault = !name || !name.trim();
    const surface = background ?? "var(--ant-color-bg-elevated, #ffffff)";
    const onSurfaceColor = background
        ? "#ffffff"
        : "var(--ant-color-primary, #ea580c)";
    return (
        <Avatar
            icon={isDefault ? <UserOutlined /> : undefined}
            size={size}
            style={{
                background: surface,
                border: background
                    ? "none"
                    : "1px solid var(--ant-color-border-secondary, rgba(15, 23, 42, 0.08))",
                color: onSurfaceColor,
                fontSize: compact ? fontSize.xs : fontSize.sm,
                fontWeight: fontWeight.semibold,
                ...style
            }}
            {...rest}
        >
            {isDefault ? null : initialsOf(name)}
        </Avatar>
    );
};

export default UserAvatar;
