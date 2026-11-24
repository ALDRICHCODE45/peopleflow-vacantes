import { Lock } from "lucide-react";
import { StateCard, type StateCardAction } from "@/components/feedback/state-card";

/**
 * The one «no access» card for the company area (Auditoría restringida, Métricas restringidas, «Sección no disponible» of a
 * stakeholder): the shared `StateCard` in its forbidden tone with a lock, capped at `max-w-xl`. Pages centre it the same way
 * (`DashboardPageContent className="flex-1 items-center justify-center"`, or the identity frame).
 */
export function ForbiddenCard({ title, description, primaryAction }: { title: string; description: string; primaryAction: StateCardAction }) {
  return <StateCard icon={Lock} tone="forbidden" title={title} description={description} primaryAction={primaryAction} className="max-w-xl" />;
}
