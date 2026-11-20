import type { Lifecycle } from "@/features/vacancy-lifecycle/model";
import { startOffer, type StartOffer } from "@/features/vacancy-lifecycle/replacement-state";
import type { Board, DiscardBody, Participation } from "./model";
import type { DepartureCredit, FallenDeparture } from "./use-departure-credits";

/**
 * replacement-processes S1/S3. «No se sostuvo» from a card rides the existing discard route with
 * `placement_exit_reason=candidate_left`; the discard reason is the candidate's own «Ya no le interesa»
 * (the contract's example body). Everything here is gated by the replacement lifecycle keys: an old backend has none.
 */
export const departureBody = (): DiscardBody => ({ reason: { group: "candidate", key: "no_longer_interested" }, placement_exit_reason: "candidate_left" });

const stageKind = (board: Board, id: string) => [...board.stages, ...board.retired_stages].find(stage => stage.id === id)?.kind;
/** A hire that is still in Placement: the only card that can be marked «No se sostuvo». */
export const isActiveHire = (board: Board, item: Participation) => !item.discard && stageKind(board, item.stage_id) === "placement";
/** A card in Descartados whose previous stage was Placement: where a departure ends up. */
export const leftPlacement = (board: Board, item: Participation) => !!item.discard && stageKind(board, item.discard.previous_stage_id) === "placement";

/** Everything the board hands to its cards for the replacement entry points (S1/S3/S6). */
export type LateActions = {
  /** The startable «No se sostuvo» credit of a card that left Placement; `undefined` while unknown, unlisted or when the single replacement read failed. */
  creditOf: (item: Participation) => DepartureCredit | undefined;
  /** The fallen credit of a card (startable or not) once the backend lists them (R4b); `fallenKnown` tells «not listed» from «not told». */
  fallenOf?: (item: Participation) => FallenDeparture | undefined;
  fallenKnown?: boolean;
  /** Stricter than the finished-board lock: a late action only waits for other pending work. */
  lateLocked: boolean;
  onLeave: (id: string) => void;
  onStartReplacement?: (creditId?: string) => void;
  confirming: { id: string; pending: boolean; confirm: () => void; cancel: () => void } | null;
};

/**
 * What the «Iniciar reemplazo» item of a card that left Placement shows (artboard states 3 and 11). A startable credit: the lifecycle's own offer.
 * A fallen credit the backend lists (R4b) that is not startable: the item stays, disabled, with the reason (a replacement already took it, or the
 * lifecycle blocker). Credits not listed at all: only the lifecycle's «replacement_active» still explains itself; anything else offers nothing.
 */
export function departureOffer(lifecycle: Lifecycle, known: { credit?: DepartureCredit; fallen?: FallenDeparture; fallenKnown?: boolean }): StartOffer {
  const base = startOffer(lifecycle);
  if (base.kind === "none") return base;
  if (known.credit) return base;
  const blocked = base.kind === "blocked";
  if (known.fallen) {
    if (known.fallen.status === "replaced") return { kind: "blocked", reason: "Esta baja ya tiene un reemplazo.", activeReplacementId: known.fallen.replacedBy ?? (blocked ? base.activeReplacementId : null) };
    return blocked ? base : { kind: "none" };
  }
  return !known.fallenKnown && blocked && lifecycle.start_replacement_blocker === "replacement_active" ? base : { kind: "none" };
}
