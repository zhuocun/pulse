/**
 * Generate placeholder PWA icon SVGs from the brand mark.
 *
 * This writes SVGs for the standard icons (brand gradient mark on white) and
 * the maskable icons (white mark on orange, safe zone = inner 80%) at 192 and
 * 512 into public/icons/. These resolve the SVG-alternate entries in the
 * manifest and the `rel="icon"` reference in index.html.
 *
 * Run: node scripts/generate-icons.js
 *
 * The production PNG variants shipped in public/ (apple-touch-icon-*.png and
 * public/icons/*.png) are NOT produced here — generate those with
 * pwa-asset-generator or a design tool.
 */
const fs = require("fs");
const path = require("path");

const SIZES = [192, 512];
const OUTPUT_DIR = path.join(__dirname, "..", "public", "icons");

const makeSvgIcon = (size, maskable = false) => {
    const padding = maskable ? size * 0.1 : size * 0.15;
    const inner = size - padding * 2;
    const bg = maskable ? "#EA580C" : "#FFFFFF";
    const rx = maskable ? 0 : size * 0.2;
    const strokeColor = maskable ? "#FFFFFF" : "url(#g)";
    const strokeOpacity = maskable ? "" : "";
    const borderStroke = maskable
        ? ""
        : `<rect x="1" y="1" width="${size - 2}" height="${size - 2}" rx="${rx}" fill="none" stroke="#0F172A" stroke-opacity="0.08" stroke-width="1"/>`;

    const cx = size / 2;
    const cy = size / 2;
    const barSpacing = inner / 7;
    const barX1 = cx - barSpacing * 1.5;
    const barX2 = cx - barSpacing * 0.5;
    const barX3 = cx + barSpacing * 0.5;
    const barX4 = cx + barSpacing * 1.5;
    const shortTop = cy - inner * 0.12;
    const shortBot = cy + inner * 0.12;
    const tallTop = cy - inner * 0.28;
    const tallBot = cy + inner * 0.28;
    const sw = Math.max(2, size * 0.06);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#FB923C"/><stop offset="100%" stop-color="#EA580C"/></linearGradient></defs>
  <rect width="${size}" height="${size}" rx="${rx}" fill="${bg}"/>
  ${borderStroke}
  <path d="M${barX1} ${tallTop}L${barX1} ${tallBot} M${barX2} ${shortTop}L${barX2} ${shortBot} M${barX3} ${tallTop}L${barX3} ${tallBot} M${barX4} ${shortTop}L${barX4} ${shortBot}" stroke="${strokeColor}" stroke-width="${sw}" stroke-linecap="round"/>
</svg>`;
};

if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

for (const size of SIZES) {
    fs.writeFileSync(
        path.join(OUTPUT_DIR, `icon-${size}.svg`),
        makeSvgIcon(size, false)
    );
    fs.writeFileSync(
        path.join(OUTPUT_DIR, `icon-maskable-${size}.svg`),
        makeSvgIcon(size, true)
    );
}

console.log("Generated SVG icons in public/icons/");
console.log(
    "Note: For production, convert these to PNG using pwa-asset-generator"
);
