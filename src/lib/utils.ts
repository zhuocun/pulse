import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge conditional class names (clsx) and de-dupe conflicting Tailwind
 * utilities (tailwind-merge). The canonical shadcn/ui helper — every
 * generated `ui/*` component threads its `className` through this.
 */
export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}
