"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import motion from "./dashboard.module.css";

/** Content that arrives later than this after the dashboard mounted just appears (150 ms fade), never rises. */
const LATE_MS = 600;
const Start = createContext<number | null>(null);

export function EntranceClock({ children }: { children: ReactNode }) {
  const [start] = useState(() => performance.now());
  return <Start value={start}>{children}</Start>;
}

const pick = (start: number | null) => start !== null && performance.now() - start > LATE_MS ? motion.quiet : motion.rise;

/**
 * One entrance per part, played on its loaded content and never on its skeleton: the class is chosen once, the first
 * render the content is ready, and kept for the life of the element, so a loading → loaded swap never rises twice.
 */
export function useEntrance(ready = true): string | undefined {
  const start = useContext(Start);
  const [entrance, setEntrance] = useState(() => ready ? pick(start) : undefined);
  if (ready && entrance === undefined) setEntrance(pick(start));
  return ready ? entrance : undefined;
}
