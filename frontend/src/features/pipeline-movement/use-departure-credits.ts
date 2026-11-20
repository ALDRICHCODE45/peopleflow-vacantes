"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { isReplacementAware } from "@/features/vacancy-lifecycle/replacement-state";
import { loadParticipationAction } from "./actions";
import { leftPlacement } from "./departure";
import type { Board, Participation, PlacementCredit } from "./model";

/** The board names no credit status, so a card that left Placement resolves its credit (did_not_hold ⇒ «No se sostuvo») once. */
const MAX_LOOKUPS = 25;
const signature = (item: Pick<Participation, "id" | "version">) => `${item.id}:${item.version}`;
/**
 * Lazy, bounded and sequential: only for cards in Descartados whose previous stage was Placement, and only when the
 * backend sends the replacement keys (an old backend makes no extra request). A failed read leaves the card as it is today.
 */
export function useDepartureCredits(vacancyId: string, board: Board | null) {
  const [credits, setCredits] = useState<Record<string, { signature: string; credit: PlacementCredit | null }>>({});
  const settled = useRef(new Set<string>());
  const wanted = board && isReplacementAware(board.lifecycle)
    ? board.participations.filter(item => leftPlacement(board, item)).slice(0, MAX_LOOKUPS).map(signature).join("|") : "";
  useEffect(() => {
    let current = true;
    void (async () => {
      for (const wantedSignature of wanted.split("|").filter(Boolean)) {
        if (settled.current.has(wantedSignature)) continue;
        const id = wantedSignature.slice(0, wantedSignature.lastIndexOf(":"));
        let credit: PlacementCredit | null = null;
        try { const result = await loadParticipationAction(vacancyId, id); if (result.ok) credit = result.data.placement_credit; } catch { /* Unknown stays unknown. */ }
        if (!current) return;
        settled.current.add(wantedSignature);
        setCredits(previous => ({ ...previous, [id]: { signature: wantedSignature, credit } }));
      }
    })();
    return () => { current = false; };
  }, [vacancyId, wanted]);
  return useCallback((item: Participation) => {
    const found = credits[item.id];
    return found?.signature === signature(item) ? found.credit : undefined;
  }, [credits]);
}
