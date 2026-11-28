"use client";

import * as React from "react";

/** A whole-second countdown from the clock (not tick counting), so a throttled background tab stays right. */
export function useCooldown(): { remaining: number; start(seconds: number): void } {
  const [endsAt, setEndsAt] = React.useState<number | null>(null);
  const [now, setNow] = React.useState(0);

  React.useEffect(() => {
    if (endsAt === null) return;
    const timer = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at >= endsAt) setEndsAt(null);
    }, 1000);
    return () => clearInterval(timer);
  }, [endsAt]);

  const start = React.useCallback((seconds: number) => {
    const at = Date.now();
    setNow(at);
    setEndsAt(at + seconds * 1000);
  }, []);

  return { remaining: endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - now) / 1000)), start };
}
