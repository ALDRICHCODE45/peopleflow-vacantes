import { plural } from "@/features/employer-vacancies/pipeline-board";
import { cn } from "@/lib/utils";
import { fulfillmentCopy, remainingCopy, type DeliveryStatus, type DeliverySummary } from "@/features/jobs/drafts/pipeline/fulfillment-model";
import { Hint } from "./pipeline-presentation";
import { formatMovementDate } from "./board-states";
import { BoardProgress } from "./board-progress";
export function BoardDelivery({ delivery, status, finished = false }: { delivery: DeliverySummary; status: DeliveryStatus | null; finished?: boolean }) {
  const details = status?.state === delivery.state ? status : null;
  const frozen = details?.fulfillment;
  return <BoardProgress label="Entrega" value={<>{delivery.delivered} de {plural(delivery.target, "candidato", "candidatos")}</>} progressLabel="Progreso de entrega" progress={Math.min(100, delivery.delivered / delivery.target * 100)}>
    {delivery.state === "pending" ? !finished && <p>{details?.business_days_remaining !== null && details?.business_days_remaining !== undefined ? remainingCopy(details.business_days_remaining) : "Plazo de entrega no disponible"}</p> : frozen ? <Hint text={`Cumplida el ${formatMovementDate(frozen.fulfilled_at, false, true)}`}>
      <p tabIndex={0} className={cn("font-medium", frozen.result === "late" ? "text-status-danger" : "text-status-success")}>{fulfillmentCopy(frozen)}</p>
    </Hint> : <p className="font-medium">Entrega cumplida · detalle no disponible</p>}
  </BoardProgress>;
}
