"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadDocumentOverviewAction } from "../actions";
import { mapDocumentFailure, type DocumentFailure } from "../failure";
import type { DocumentOverview } from "../model";

export type OverviewState =
  | { status: "loading" }
  | { status: "error"; failure: DocumentFailure }
  | { status: "ready"; overview: DocumentOverview; refreshing: boolean };

/**
 * Reads `document-overview` for the vacancy (`participationId` null) or narrowed to one participation. The first read shows a skeleton;
 * a later one keeps the table and marks it `refreshing`. `apply` takes a local update from a write response; when that update cannot
 * be made (it returns `undefined`) the overview is read again.
 */
export function useDocumentOverview(draftId: string, participationId: string | null) {
  const [state, setState] = useState<OverviewState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef<DocumentOverview | null>(null);
  useEffect(() => {
    let current = true;
    setState(previous => previous.status === "ready" ? { ...previous, refreshing: true } : { status: "loading" });
    loadDocumentOverviewAction(draftId, participationId ?? undefined)
      .catch(() => mapDocumentFailure({ error: { kind: "network" } }))
      .then(result => {
        if (!current) return;
        latest.current = result.ok ? result.data : null;
        setState(result.ok ? { status: "ready", overview: result.data, refreshing: false } : { status: "error", failure: result });
      });
    return () => { current = false; };
  }, [draftId, participationId, attempt]);
  const reload = useCallback(() => setAttempt(value => value + 1), []);
  const apply = useCallback((update: (overview: DocumentOverview) => DocumentOverview | undefined) => {
    const base = latest.current;
    const next = base ? update(base) : undefined;
    if (!next) { setAttempt(value => value + 1); return; }
    latest.current = next;
    setState({ status: "ready", overview: next, refreshing: false });
  }, []);
  return { state, reload, apply };
}
