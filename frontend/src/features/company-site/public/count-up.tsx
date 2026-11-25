"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePrefersReducedMotion } from "./use-reduced-motion";

export type CountValue = { prefix: string; target: number; suffix: string; format: (value: number) => string };
const DURATION_MS = 1200;

/** A figure animates only when it holds exactly one whole number (optionally grouped
 * with commas) and no words before it: «+15», «300+», «98 %», «1,200». Places, ratios,
 * decimals and ranges («Monterrey», «24/7», «4.8», «1 de 3») stay static. */
export function parseCountValue(value: string): CountValue | null {
  const tokens = value.match(/\d+(?:[.,]\d+)*/g);
  if (tokens?.length !== 1) return null;
  const [token] = tokens;
  const grouped = token.includes(",");
  if (token.includes(".") || grouped && !/^\d{1,3}(?:,\d{3})+$/.test(token)) return null;
  const at = value.indexOf(token);
  const prefix = value.slice(0, at), suffix = value.slice(at + token.length);
  if (/\p{L}/u.test(prefix)) return null;
  const target = Number(token.replaceAll(",", ""));
  return { prefix, target, suffix, format: count => `${prefix}${grouped ? count.toLocaleString("en-US") : String(count)}${suffix}` };
}

/** Counts up once on screen. The server, reduced motion and browsers without
 * IntersectionObserver show the final value; assistive technology always reads it. */
export function CountUp({ value }: { value: string }) {
  const parsed = useMemo(() => parseCountValue(value), [value]);
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  // null = the final value.
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!parsed || reduced || !node || typeof IntersectionObserver === "undefined") return;
    let frame = 0;
    // Start from zero only once motion is known to be allowed (after hydration).
    setShown(0);
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      let start: number | null = null;
      const tick = (now: number) => {
        start ??= now;
        const progress = Math.min(1, (now - start) / DURATION_MS);
        setShown(progress >= 1 ? null : Math.round(parsed.target * (1 - (1 - progress) ** 3)));
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
    observer.observe(node);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); setShown(null); };
  }, [parsed, reduced]);
  return <>
    <span aria-hidden="true" data-count-display="" ref={ref}>{parsed && shown !== null ? parsed.format(shown) : value}</span>
    <span className="sr-only">{value}</span>
  </>;
}
