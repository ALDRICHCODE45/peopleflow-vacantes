export const FONT_PAIRS = {
  classic: { label: "Clásica", heading: "Inter", body: "Inter" },
  editorial: { label: "Editorial", heading: "Fraunces", body: "Inter" },
  modern: { label: "Moderna", heading: "Plus Jakarta Sans", body: "Plus Jakarta Sans" },
} as const;

type RGB = [number, number, number];
function rgb(hex: string): RGB {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new RangeError("Expected #RRGGBB");
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255) as RGB;
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(hexA: string, hexB: string): number {
  const a = luminance(hexA), b = luminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export function readableOn(hex: string): "#FFFFFF" | "#000000" {
  return contrastRatio(hex, "#FFFFFF") >= contrastRatio(hex, "#000000") ? "#FFFFFF" : "#000000";
}
function hsl(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const delta = max - min, lightness = (max + min) / 2;
  if (delta === 0) return [0, 0, lightness];
  const hue = max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [hue / 6, delta / (1 - Math.abs(2 * lightness - 1)), lightness];
}
function fromHsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`.toUpperCase();
}

/** Preserve hue/saturation and step HSL lightness by 1%; never mutate the saved brand. */
export function adjustedBrandColor(hex: string, background: string): { color: string; adjusted: boolean } {
  if (contrastRatio(hex, background) >= 4.5) return { color: hex, adjusted: false };
  const [h, s, initial] = hsl(hex);
  // The black/white crossover guarantees the chosen endpoint can reach 4.5.
  const direction = readableOn(background) === "#000000" ? -1 : 1;
  for (let step = 1; step <= 100; step += 1) {
    const lightness = Math.max(0, Math.min(1, initial + direction * step / 100));
    const color = fromHsl(h, s, lightness);
    if (contrastRatio(color, background) >= 4.5) return { color, adjusted: true };
  }
  return { color: readableOn(background), adjusted: true };
}
