"use client";
import { useCallback, useEffect, useState } from "react";
import { linkedProcesses, isReplacementAware } from "@/features/vacancy-lifecycle/replacement-state";
import { loadReplacementSummaryAction } from "@/features/vacancy-replacement/actions";
import type { ChainSummary } from "@/features/vacancy-replacement/model";
import { leftPlacement } from "./departure";
import type { Board, Participation } from "./model";

/** What the card needs of a «No se sostuvo»: the credit to start a replacement with, and when the hire left, if the backend says. */
export type DepartureCredit = ChainSummary["credits"][number];
/** A credit that fell, startable or not (R4b): what keeps the badge while a replacement is active. */
export type FallenDeparture = NonNullable<ChainSummary["fallen"]>[number];
const signature = (item: Pick<Participation, "id" | "version">) => `${item.id}:${item.version}`;

/**
 * ONE `GET V/replacements` per board load, shared by the departed cards (credits by `participation_id`) and the link bar (chain names).
 * Only a replacement-aware lifecycle reads (an old backend makes no request), and only when there is something to resolve: a linked
 * process or a card that left Placement. It reads again only when that changes (a departure, a lifecycle change), never per card.
 * A failed read is `null`: no badge and the unnamed link bar, exactly today's look.
 */
export function useReplacementSummary(vacancyId: string, board: Board | null) {
  const lifecycle = board?.lifecycle;
  const aware = !!board && !!lifecycle && isReplacementAware(lifecycle);
  const linked = aware && (!!linkedProcesses(lifecycle, vacancyId).replacementOf || !!linkedProcesses(lifecycle, vacancyId).activeReplacementId);
  const departed = aware ? board.participations.filter(item => leftPlacement(board, item)).map(signature).join("|") : "";
  // Derived lifecycle keys change without a new version, so they are part of «a board load» for this read.
  const wanted = aware && (linked || departed)
    ? JSON.stringify([vacancyId, lifecycle.version, lifecycle.can_start_replacement, lifecycle.start_replacement_blocker, lifecycle.startable_credits_count, lifecycle.active_replacement_id, departed])
    : "";
  const [read, setRead] = useState<{ vacancyId: string; summary: ChainSummary | null } | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let current = true;
    void (async () => {
      let summary: ChainSummary | null = null;
      try { const result = await loadReplacementSummaryAction(vacancyId); if (result?.ok) summary = result.data; } catch { /* Unknown stays unknown. */ }
      if (current) setRead({ vacancyId, summary });
    })();
    return () => { current = false; };
  }, [vacancyId, wanted]);
  // The last answer of THIS vacancy stays while a newer read is in flight, so the link bar does not flicker.
  const summary = wanted && read?.vacancyId === vacancyId ? read.summary : null;
  const creditOf = useCallback((item: Participation): DepartureCredit | undefined => summary?.credits.find(credit => credit.participationId === item.id), [summary]);
  // `undefined` = the backend does not say (older, or the read failed); a function whose answer is `undefined` = it says, and this card is not one.
  const fallen = summary?.fallen;
  const fallenOf = useCallback((item: Participation): FallenDeparture | undefined => fallen?.find(credit => credit.participationId === item.id), [fallen]);
  return { chain: summary?.items, creditOf, fallenOf, fallenKnown: fallen !== undefined };
}
