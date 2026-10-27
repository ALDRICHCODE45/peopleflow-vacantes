"use client";

import { useEffect, useRef, useState } from "react";

/** Fits below the existing app header without taking ownership of the route's
 * padding or scroll. A short viewport shrinks the columns, never the document. */
export function useWorkspaceHeight(desktop: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  useEffect(() => {
    if (!desktop || !ref.current) { setHeight(undefined); return; }
    const root = ref.current;
    const ancestors: HTMLElement[] = [];
    for (let element = root.parentElement; element && element !== root.ownerDocument.body; element = element.parentElement) ancestors.push(element);
    const measure = () => {
      // The page inset is not the last gutter: the dashboard provider adds its
      // own bottom padding. Reserve every enclosing box's remaining bottom edge.
      const bottomInset = ancestors.reduce((total, element) => {
        const style = getComputedStyle(element);
        return total + (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.borderBottomWidth) || 0) + (parseFloat(style.marginBottom) || 0);
      }, 0);
      const top = root.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(0, Math.floor(window.innerHeight - top - bottomInset)));
    };
    const observer = new ResizeObserver(measure);
    ancestors.forEach(element => observer.observe(element));
    measure(); window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [desktop]);
  return { ref, height: desktop ? height : undefined };
}
