"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MetricsFailure, MetricsResult } from "./model";
import type { MetricsFilters } from "./url-state";

/** How far below the viewport a lazy section starts loading, so it is usually ready when it scrolls in. */
const NEAR_VIEWPORT = "600px 0px";
const noResponse: MetricsFailure = { ok: false, reason: "no_response", reference: {} };

export type SectionState<T> = {
  status: "idle" | "loading" | "ready" | "failed";
  data: T | null;
  /** The shown data belongs to the previous filters while the new answer is on its way (rule 17: dim, never jump). */
  stale: boolean;
  failure: MetricsFailure | null;
  /** Attach to the section root; a lazy section loads once it approaches the viewport. */
  ref: (node: Element | null) => void;
  retry: () => void;
};

/**
 * One board section (`design/system.md` rule 17): loads on its own (eager, or lazy near the viewport), keeps the last
 * answer visible and marked stale while the filters change, and drops any answer that is no longer the latest.
 */
export function useSection<T>(load: (filters: MetricsFilters) => Promise<MetricsResult<T>>, filters: MetricsFilters, key: string, options: { lazy?: boolean } = {}): SectionState<T> {
  const [visible, setVisible] = useState(!options.lazy);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string | null; data: T | null; failure: MetricsFailure | null; loading: boolean }>({ key: null, data: null, failure: null, loading: false });
  const latest = useRef(0);
  const inputs = useRef({ load, filters });
  inputs.current = { load, filters };
  const observer = useRef<IntersectionObserver | null>(null);

  const ref = useCallback((node: Element | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node || !options.lazy) return;
    const watcher = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      watcher.disconnect();
      setVisible(true);
    }, { rootMargin: NEAR_VIEWPORT });
    watcher.observe(node);
    observer.current = watcher;
  }, [options.lazy]);
  useEffect(() => () => observer.current?.disconnect(), []);

  useEffect(() => {
    if (!visible) return;
    const request = ++latest.current;
    setState(previous => ({ ...previous, failure: null, loading: true }));
    void inputs.current.load(inputs.current.filters).catch(() => noResponse).then(result => {
      if (request !== latest.current) return;
      setState(previous => result.ok
        ? { key, data: result.data, failure: null, loading: false }
        : { ...previous, failure: result, loading: false });
    });
  }, [visible, key, attempt]);

  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const status = !visible ? "idle" : state.loading ? "loading" : state.failure ? "failed" : state.key === null ? "loading" : "ready";
  return { status, data: state.data, stale: state.data !== null && state.key !== key, failure: state.failure, ref, retry };
}
