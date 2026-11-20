"use client";

import { useCallback, useState } from "react";

export type StartReplacementRequest = { draftId: string; creditId?: string };

/**
 * Remembers which draft (and, from a card, which unsustained hire) asked to start a replacement.
 * It only holds the request: the start-replacement dialog (features/vacancy-replacement) consumes `request`
 * at the WIRING POINT of each screen that uses this hook, and calls `close` when it closes.
 */
export function useStartReplacementRequest() {
  const [request, setRequest] = useState<StartReplacementRequest | null>(null);
  const open = useCallback((draftId: string, creditId?: string) => setRequest(creditId ? { draftId, creditId } : { draftId }), []);
  const close = useCallback(() => setRequest(null), []);
  return { request, open, close };
}
