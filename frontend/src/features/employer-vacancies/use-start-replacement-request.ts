"use client";

import { useCallback, useState } from "react";

export type StartReplacementRequest = { draftId: string; creditId?: string };

/**
 * Remembers which draft (and, from a card, which unsustained hire) asked to start a replacement.
 * It only holds the request: each screen that uses this hook mounts the start-replacement dialog
 * (features/vacancy-replacement, through `StartReplacementHost`) while `request` exists, and calls `close` when it closes.
 */
export function useStartReplacementRequest() {
  const [request, setRequest] = useState<StartReplacementRequest | null>(null);
  const open = useCallback((draftId: string, creditId?: string) => setRequest(creditId ? { draftId, creditId } : { draftId }), []);
  const close = useCallback(() => setRequest(null), []);
  return { request, open, close };
}
