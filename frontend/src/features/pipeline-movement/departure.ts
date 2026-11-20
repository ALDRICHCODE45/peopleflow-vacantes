import type { Board, DiscardBody, Participation, PlacementCredit } from "./model";

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
  /** `undefined` while unknown, `null` when the participation has no credit. */
  creditOf: (item: Participation) => PlacementCredit | null | undefined;
  /** Stricter than the finished-board lock: a late action only waits for other pending work. */
  lateLocked: boolean;
  onLeave: (id: string) => void;
  onStartReplacement?: (creditId?: string) => void;
  confirming: { id: string; pending: boolean; confirm: () => void; cancel: () => void } | null;
};
