import { Lock } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";

/** The audit is owner only (D5): explained once, never retried. Same forbidden pattern as the restricted talent base. */
export function AuditRestricted() {
  return <StateCard icon={Lock} tone="forbidden" title="Auditoría restringida" description="Solo el owner de la empresa puede consultar la auditoría." primaryAction={{ label: "Ir al dashboard", href: "/empresa/dashboard" }} />;
}
