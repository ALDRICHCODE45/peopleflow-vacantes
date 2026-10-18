import { discardReasonLabel } from "./discard-text";
import type { Board, DiscardBody, Move, Participation } from "./model";

export type BoardWrite = { kind: "move"; target: string; confirmed: boolean } | { kind: "discard"; body: DiscardBody } | { kind: "recover"; confirmed: boolean };

function coveredCopy({ covered, required }: Move["coverage"]) {
  return `${covered}${required === null ? "" : ` de ${required}`} cubiertas`;
}

/** Names come from the board; coverage comes only from the confirmed write. */
export function boardSuccessCopy(board: Board, item: Participation, write: BoardWrite, result: Move) {
  const name = item.candidate.full_name;
  const from = board.stages.find(stage => stage.id === item.stage_id);
  const to = board.stages.find(stage => stage.id === result.stage_id);
  const coverage = coveredCopy(result.coverage);
  if (write.kind === "discard") {
    const freed = `se liberó una plaza: ${coverage}.`;
    const consequence = write.body.candidate_message
      ? `Verá el estado Finalizada con tu mensaje${from?.kind === "placement" ? `; ${freed}` : "."}`
      : from?.kind === "placement" ? `Se liberó una plaza: ${coverage}.` : "Puedes recuperar su postulación desde Descartados.";
    return { title: `Descartaste a ${name}`, description: `Motivo: ${discardReasonLabel(write.body.reason)}. ${consequence}` };
  }
  if (write.kind === "recover") {
    const previous = board.stages.find(stage => stage.id === item.discard?.previous_stage_id);
    return { title: `Recuperaste a ${name}`, description: previous?.kind === "placement"
      ? `Volvió a ${previous.name} y ocupa una plaza: ${coverage}.`
      : `Volvió a ${previous?.name ?? "su etapa anterior"}. El descarte queda en su historial.` };
  }
  if (from?.kind === "placement") return {
    title: `${name} salió de ${from.name}`,
    description: `Se liberó una plaza: ${coverage}. Su contratación queda en el historial.`,
  };
  if (to?.kind === "placement") {
    const { covered, required } = result.coverage;
    return { title: `${name} llegó a ${to.name}`, description: required !== null && covered >= required
      ? `Cobertura completa: ${covered} de ${required} plazas.`
      : `Se cubrió una plaza: ${required === null ? "" : "ahora "}${coverage}.` };
  }
  return { title: `${name} pasó a ${to?.name ?? "la etapa actual"}`, description: `Antes estaba en ${from?.name ?? "su etapa anterior"}. El cambio queda en su historial.` };
}
