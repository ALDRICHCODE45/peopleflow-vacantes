"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Tailwind classes that fade the edge(s) of a horizontally scrolling rail that still has content past them (pair with `useScrollHint`'s `hint`). */
export const scrollFade = "data-[fade=end]:[mask-image:linear-gradient(to_right,#000_calc(100%-2.5rem),transparent)] data-[fade=start]:[mask-image:linear-gradient(to_right,transparent,#000_2.5rem)] data-[fade=both]:[mask-image:linear-gradient(to_right,transparent,#000_2.5rem,#000_calc(100%-2.5rem),transparent)]";

/** Tells which side of an `overflow-x-auto` rail is cut off, so it can fade there. Nothing is set while everything fits. */
export function useScrollHint<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [fade, setFade] = useState<"start" | "end" | "both" | undefined>();
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const start = max > 1 && el.scrollLeft > 1;
    const end = max > 1 && el.scrollLeft < max - 1;
    setFade(start && end ? "both" : start ? "start" : end ? "end" : undefined);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => { el.removeEventListener("scroll", measure); observer?.disconnect(); };
  }, [measure]);
  return { ref, hint: { "data-fade": fade } as const };
}
