import { ForbiddenCard } from "@/features/identity/forbidden-card";

/** The audit is owner only (D5): explained once, never retried. Same card as «Métricas restringidas» and the stakeholder's «Sección no disponible». */
export function AuditRestricted() {
  return <ForbiddenCard title="Auditoría restringida" description="Solo el dueño de la empresa puede consultar la auditoría." primaryAction={{ label: "Ir al dashboard", href: "/empresa/dashboard" }} />;
}
