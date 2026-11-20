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
  const valid = (value: string | null | undefined): value is string => !!value && Number.isFinite(Date.parse(value));
  // A live replacement's clock counts from its start (`published_at` of the process), whether or not it has a public listing, so that date stays;
  // once public, the listing's own date (`GET V/publication`, a later moment) goes beside it. Originals have one date: their publication.
  const replacementLive = lifecycle.kind === "replacement" && lifecycle.publication === "published";
  const date = replacementLive
    ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {valid(lifecycle.published_at) && <p className="text-xs text-muted-foreground">Proceso iniciado el <MovementDate value={lifecycle.published_at} /></p>}
      {lifecycle.visibility === "public" && valid(publishedAt) && <p className="text-xs text-muted-foreground">Publicada el <MovementDate value={publishedAt} /></p>}
    </div>
    : valid(transition.at) ? <p className="text-xs text-muted-foreground">{transition.label} el <MovementDate value={transition.at} /></p> : null;
  return <>{lifecycle.publication === "closed" && <>
    <p className="text-xs text-muted-foreground">Motivo de cierre: {closeReasonLabel(lifecycle.close_reason)}</p>
    {lifecycle.close_reason === "other" && <CloseReasonNote note={lifecycle.close_reason_note} />}
  </>}{date}{unpublished && <p className="text-xs text-muted-foreground">Privada · sin publicar</p>}</>;
}
