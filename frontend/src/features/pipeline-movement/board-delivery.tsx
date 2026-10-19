import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { fulfillmentCopy, remainingCopy, type DeliveryStatus, type DeliverySummary } from "@/features/jobs/drafts/pipeline/fulfillment-model";
import { Hint } from "./pipeline-presentation";
import { formatMovementDate } from "./board-states";
export function BoardDelivery({ delivery, status }: { delivery: DeliverySummary; status: DeliveryStatus | null }) {
  const details = status?.state === delivery.state ? status : null;
  const frozen = details?.fulfillment;
  return <div aria-label="Entrega" className="pf-board-coverage flex min-w-40 flex-col gap-2 text-xs">
    {delivery.state === "pending" ? <>
      <p className="flex items-center gap-2"><Flag aria-hidden="true" className="size-4 shrink-0" /><strong className="font-semibold tabular-nums">Entrega: {delivery.delivered} de {delivery.target}</strong></p>
      <Progress aria-label="Progreso de entrega" value={Math.min(100, delivery.delivered / delivery.target * 100)} />
      <p className="text-[11px] text-muted-foreground">{details?.business_days_remaining !== null && details?.business_days_remaining !== undefined ? remainingCopy(details.business_days_remaining) : "Plazo de entrega no disponible"}</p>
    </> : frozen ? <Hint text={`Cumplida el ${formatMovementDate(frozen.fulfilled_at, false, true)}`}>
      <p tabIndex={0} className={cn("font-medium", frozen.result === "late" ? "text-status-danger" : "text-status-success")}>{fulfillmentCopy(frozen)}</p>
    </Hint> : <p className="font-medium">Entrega cumplida · detalle no disponible</p>}
  </div>;
}
