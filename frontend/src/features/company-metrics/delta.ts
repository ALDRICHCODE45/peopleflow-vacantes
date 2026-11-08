import type { Rate } from "./model";
import { number } from "./model";

/** A headline change (N1) ready to render: the pill text, its direction and whether that direction is good. */
export type Delta = { label: string; direction: "up" | "down" | "flat"; tone: "positive" | "negative" | "neutral"; accessible: string };
/** Which way is better: more on-time deliveries is good, more days to close or more reassignments is not. */
export type Better = "up" | "down";

const MINUS = "\u2212";
function build(difference: number, better: Better, unit: { short: string; singular: string; plural: string }): Delta {
  if (difference === 0) return { label: "Sin cambio", direction: "flat", tone: "neutral", accessible: "Igual que el periodo anterior" };
  const direction = difference > 0 ? "up" : "down";
  const size = Math.abs(difference);
  const noun = size === 1 ? unit.singular : unit.plural;
  return {
    label: `${difference > 0 ? "+" : MINUS}${number.format(size)}${unit.short}`,
    direction, tone: direction === better ? "positive" : "negative",
    accessible: `${number.format(size)}${noun ? ` ${noun}` : ""} ${difference > 0 ? "más" : "menos"} que el periodo anterior`,
  };
}

/** Change of a count or a median; null when either side has no sample (a missing value is never 0). */
export function countDelta({ current, previous }: { current: number | null; previous: number | null }, better: Better = "up"): Delta | null {
  if (current === null || previous === null) return null;
  return build(current - previous, better, { short: "", singular: "", plural: "" });
}

/** Change of a rate in percentage points between the rounded values the cards show («78%» vs «70%» is +8 pts). */
export function rateDelta({ current, previous }: { current: Rate; previous: Rate }, better: Better = "up"): Delta | null {
  if (current.value === null || previous.value === null) return null;
  return build(Math.round(current.value * 100) - Math.round(previous.value * 100), better, { short: " pts", singular: "punto", plural: "puntos" });
}
