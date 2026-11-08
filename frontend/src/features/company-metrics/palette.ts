/**
 * Delivery and deadline palette of `design/system.md` rule 9: one hue family plus one alarm, no brown, no green. Every
 * segment always carries its word and count; colour never stands alone.
 */
export const DELIVERY_TONE = {
  on_time: "var(--primary)",
  late: "color-mix(in oklab, var(--primary) 45%, var(--card))",
  pending: "color-mix(in oklab, var(--muted-foreground) 35%, var(--card))",
  overdue: "var(--destructive)",
  not_configured: "var(--border)",
} as const;
export type DeliveryTone = keyof typeof DELIVERY_TONE;

/** Rule 8: one accent series in `--primary`; the others in muted tints. */
export const CHART_ACCENT = "var(--primary)";
export const CHART_MUTED = "color-mix(in oklab, var(--muted-foreground) 45%, var(--card))";
export const CHART_GRID = "var(--border)";
