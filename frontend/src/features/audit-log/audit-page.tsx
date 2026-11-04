"use client";
import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { StateCard } from "@/components/feedback/state-card";
import { Skeleton } from "@/components/ui/skeleton";
import { loadCompanyStateAction, type CompanyState } from "@/features/employer-company/actions";
import { AuditRestricted } from "./audit-restricted";
import { AuditWorkspace } from "./audit-workspace";

/**
 * «Auditoría»: the owner reads the company's audit log. The membership is resolved before anything else, so a
 * recruiter opening the URL gets the restricted card and no audit request is ever made; the API still answers 403.
 */
export function AuditPage() {
  const [state, setState] = useState<CompanyState | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setState(null);
    void loadCompanyStateAction().catch((): CompanyState => ({ kind: "no_response", reference: {} })).then(next => { if (active) setState(next); });
    return () => { active = false; };
  }, [attempt]);

  if (state?.kind === "exists" && state.role === "owner") return <AuditWorkspace />;
  return <DashboardPageContent width="screen-2xl" className="min-w-0 gap-5 md:gap-6">
    {!state && <div role="status" aria-label="Cargando auditoría" aria-busy="true" className="flex flex-col gap-2"><Skeleton aria-hidden="true" className="h-24 w-full" /><Skeleton aria-hidden="true" className="h-48 w-full" /></div>}
    {(state?.kind === "exists" || state?.kind === "none") && <AuditRestricted />}
    {state?.kind === "unauthenticated" && <StateCard icon={TriangleAlert} tone="error" title="Tu sesión terminó" description="Tu sesión expiró. Inicia sesión de nuevo para consultar la auditoría." primaryAction={{ label: "Iniciar sesión", href: "/empresa/login" }} />}
    {(state?.kind === "server_error" || state?.kind === "no_response" || state?.kind === "unrecognized_response") && <StateCard icon={TriangleAlert} tone="error" title="No pudimos verificar tu rol" description="Necesitamos confirmar que eres el owner antes de mostrar la auditoría. Puedes volver a intentarlo." primaryAction={{ label: "Reintentar", onClick: () => setAttempt(value => value + 1) }} />}
  </DashboardPageContent>;
}
