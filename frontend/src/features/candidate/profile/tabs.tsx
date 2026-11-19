"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProfileCategory } from "../profile-form-fields";
import { PROFILE_TABS } from "./sections";
import styles from "./profile.module.css";

export const tabId = (key: ProfileCategory) => `pf-profile-tab-${key}`;
export const PANEL_ID = "pf-profile-panel";

/**
 * One tablist with a single tab stop: Left/Right move and wrap, Home/End jump, selection follows focus. Underline tabs
 * from `sm`; below it a horizontally scrollable segmented control with edge fades, keeping the active tab in view.
 * A dot marks a tab with unsaved changes (red while it holds a validation error); an all-private tab carries a lock.
 */
export function ProfileTabs({ active, onSelect, changed, flagged, privateTabs }: {
  active: ProfileCategory; onSelect: (key: ProfileCategory) => void;
  changed: readonly ProfileCategory[]; flagged: readonly ProfileCategory[]; privateTabs: readonly ProfileCategory[];
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const tabs = useRef<Partial<Record<ProfileCategory, HTMLButtonElement | null>>>({});
  const [edges, setEdges] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const node = scroller.current;
    if (!node) return;
    const start = node.scrollLeft > 2, end = node.scrollLeft + node.clientWidth < node.scrollWidth - 2;
    setEdges(current => current.start === start && current.end === end ? current : { start, end });
  }, []);
  useEffect(() => {
    const node = scroller.current, tab = tabs.current[active];
    if (node && tab) {
      const left = tab.offsetLeft, right = left + tab.offsetWidth;
      if (left < node.scrollLeft + 24) node.scrollLeft = Math.max(0, left - 24);
      else if (right > node.scrollLeft + node.clientWidth - 24) node.scrollLeft = right - node.clientWidth + 24;
    }
    measure();
  }, [active, measure]);
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = PROFILE_TABS.length - 1;
    const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
        : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    const key = PROFILE_TABS[next].key;
    onSelect(key);
    tabs.current[key]?.focus();
  }
  return <div data-start={edges.start || undefined} data-end={edges.end || undefined} className={cn("relative min-w-0", styles.fades)}>
    <div ref={scroller} onScroll={measure} className={cn("min-w-0 overflow-x-auto", styles.scroller)}>
      <div role="tablist" aria-label="Secciones del perfil" className={cn("flex w-max gap-0.5", styles.tablist)}>
        {PROFILE_TABS.map(({ key, title }, index) => {
          const selected = key === active, error = flagged.includes(key), dirty = changed.includes(key);
          return <button key={key} ref={node => { tabs.current[key] = node; }} type="button" role="tab" id={tabId(key)} aria-controls={PANEL_ID} aria-selected={selected} tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(key)} onKeyDown={event => onKeyDown(event, index)}
            className={cn("relative inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors duration-150 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-selected:text-foreground motion-reduce:transition-none", styles.tab)}>
            {title}
            {privateTabs.includes(key) && <span className="inline-flex text-muted-foreground"><Lock aria-hidden="true" className="size-3" strokeWidth={2.25} /><span className="sr-only"> (solo tú)</span></span>}
            {error ? <><span aria-hidden="true" data-pf-profile-tab-dot="error" className="size-1.5 shrink-0 rounded-full bg-destructive" /><span className="sr-only"> (revisa los datos)</span></>
              : dirty ? <><span aria-hidden="true" data-pf-profile-tab-dot="changed" className="size-1.5 shrink-0 rounded-full bg-status-review" /><span className="sr-only"> (cambios sin guardar)</span></> : null}
          </button>;
        })}
      </div>
    </div>
  </div>;
}
