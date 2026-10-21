import { type Lifecycle } from "@/features/vacancy-lifecycle/model";
import { MovementDate } from "./board-states";

/** The shell owns the state badge; the board shows only the transition date. */
export function BoardLifecycle({ lifecycle, publishedAt }: { lifecycle: Lifecycle; publishedAt?: string | null }) {
  const transition = lifecycle.process === "finished"
    ? { label: "Proceso finalizado", at: lifecycle.process_finished_at }
    : lifecycle.publication === "closed" ? { label: "Cerrada", at: lifecycle.closed_at }
      : lifecycle.publication === "paused" ? { label: "Pausada", at: lifecycle.paused_at }
        : { label: "Publicada", at: lifecycle.published_at ?? publishedAt ?? null };
  const date = transition.at && Number.isFinite(Date.parse(transition.at))
    ? <p className="text-xs text-muted-foreground">{transition.label} el <MovementDate value={transition.at} /></p>
    : null;
  return date;
}
