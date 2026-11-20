import { CloseReasonNote } from "@/features/vacancy-lifecycle/ui/close-reason-note";
import { closeReasonLabel, type Lifecycle } from "@/features/vacancy-lifecycle/model";
import { MovementDate } from "./board-states";

/** The shell owns the state badge; the board adds closure details and the transition date. */
export function BoardLifecycle({ lifecycle, publishedAt }: { lifecycle: Lifecycle; publishedAt?: string | null }) {
  // A private replacement has a live process but no public listing yet (contract D4): its date is when the process started, and it says so.
  const unpublished = lifecycle.visibility === "private" && (lifecycle.publication === "published" || lifecycle.publication === "paused");
  const transition = lifecycle.process === "finished"
    ? { label: "Proceso finalizado", at: lifecycle.process_finished_at }
    : lifecycle.publication === "closed" ? { label: "Cerrada", at: lifecycle.closed_at }
      : lifecycle.publication === "paused" ? { label: "Pausada", at: lifecycle.paused_at }
        : { label: unpublished ? "Proceso iniciado" : "Publicada", at: lifecycle.published_at ?? publishedAt ?? null };
  const date = transition.at && Number.isFinite(Date.parse(transition.at))
    ? <p className="text-xs text-muted-foreground">{transition.label} el <MovementDate value={transition.at} /></p>
    : null;
  return <>{lifecycle.publication === "closed" && <>
    <p className="text-xs text-muted-foreground">Motivo de cierre: {closeReasonLabel(lifecycle.close_reason)}</p>
    {lifecycle.close_reason === "other" && <CloseReasonNote note={lifecycle.close_reason_note} />}
  </>}{date}{unpublished && <p className="text-xs text-muted-foreground">Privada · sin publicar</p>}</>;
}
