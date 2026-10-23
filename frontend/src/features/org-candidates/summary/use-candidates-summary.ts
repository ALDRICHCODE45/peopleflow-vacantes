"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getCandidatesSummaryAction } from "./summary-actions";
import type { CandidatesSummary, CandidatesSummaryFailure, CandidatesSummaryResult } from "./summary-model";

export function useCandidatesSummary() {
  const [data, setData] = useState<CandidatesSummary | null>(null);
  const [pending, setPending] = useState(true);
  const [failure, setFailure] = useState<CandidatesSummaryFailure | null>(null);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const inFlight = useRef<Promise<CandidatesSummaryResult> | null>(null);

  const load = useCallback(async (reuseInFlight = false) => {
    if (!mounted.current) return;
    const version = ++sequence.current;
    setPending(true);
    setFailure(null);
    // Share the initial read across StrictMode effect replay, not across explicit refreshes.
    const request = reuseInFlight && inFlight.current ? inFlight.current : (async (): Promise<CandidatesSummaryResult> => {
      try { return await getCandidatesSummaryAction(); }
      catch { return { ok: false, reason: "no_response", reference: {} }; }
    })();
    inFlight.current = request;
    const result = await request;
    if (inFlight.current === request) inFlight.current = null;
    // A save-triggered refresh is authoritative even if an older read finishes later.
    if (!mounted.current || version !== sequence.current) return;
    setPending(false);
    if (result.ok) setData(result.data);
    else setFailure(result);
  }, []);
  const refresh = useCallback(() => load(), [load]);

  useEffect(() => {
    mounted.current = true;
    void load(true);
    return () => { mounted.current = false; sequence.current += 1; };
  }, [load]);

  return { data, pending, failure, refresh };
}
