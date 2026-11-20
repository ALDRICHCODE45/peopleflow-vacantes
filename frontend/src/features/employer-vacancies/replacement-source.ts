import { isActiveHire } from "@/features/pipeline-movement/departure";
import type { Board } from "@/features/pipeline-movement/model";
import type { SourceStage, UnavailableHire } from "@/features/vacancy-replacement/model";

/** What the start-replacement dialog needs from the SOURCE board: its stages and the hires that cannot be replaced yet. */
export type ReplacementSource = { stages: SourceStage[]; unavailableHires: UnavailableHire[] };

/** Stages as the board shows them; hires still in Placement are listed disabled with «todavía en Contratación». */
export function replacementSource(board: Board): ReplacementSource {
  return {
    stages: board.stages.map(({ id, kind, name }) => ({ id, kind, name })),
    unavailableHires: board.participations.filter(item => isActiveHire(board, item)).map(item => ({ id: item.id, name: item.candidate.full_name, reason: "still_placed" as const })),
  };
}
