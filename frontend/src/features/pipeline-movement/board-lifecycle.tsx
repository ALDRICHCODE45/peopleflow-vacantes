import { Badge } from "@/components/ui/badge";
import { lifecycleLabel, type Lifecycle } from "@/features/vacancy-lifecycle/model";
import { MovementDate } from "./board-states";

/**
 * A published vacancy keeps the validated header line («Publicada el …»); only
 * paused and closed vacancies add a state badge and their latest transition date.
 */
export function BoardLifecycle({ lifecycle, publishedAt }: { lifecycle: Lifecycle; publishedAt?: string | null }) {
  const transition = lifecycle.process === "finished"
    ? { label: "Proceso finalizado", at: lifecycle.process_finished_at }
    : lifecycle.publication === "closed" ? { label: "Cerrada", at: lifecycle.closed_at }
      : lifecycle.publication === "paused" ? { label: "Pausada", at: lifecycle.paused_at }
        : { label: "Publicada", at: lifecycle.published_at ?? publishedAt ?? null };
  const date = transition.at && Number.isFinite(Date.parse(transition.at))
    ? <p className="text-xs text-muted-foreground">{transition.label} el <MovementDate value={transition.at} /></p>
    : null;
  if (lifecycle.publication === "published") return date;
  return <>
    <div><Badge variant="secondary">{lifecycleLabel(lifecycle)}</Badge></div>
    {date}
  </>;
}
