"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Lock, TriangleAlert } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { StateCard } from "@/components/feedback/state-card";
import { Skeleton } from "@/components/ui/skeleton";
import { loadMetricsAccessAction } from "./actions";
import type { MetricsAccess } from "./model";

/** Metrics are for the owner and stakeholders (D2): explained once, never retried. Same pattern as the restricted audit. */
export function MetricsRestricted() {
  return <StateCard icon={Lock} tone="forbidden" title="Métricas restringidas" description="Solo el owner y los stakeholders de la empresa pueden consultar las métricas. Tus propios números están en «Mi historial de vacantes»." primaryAction={{ label: "Ir al dashboard", href: "/empresa/dashboard" }} />;
}

/**
 * Resolves the membership role before any metric is read, so a recruiter gets the restricted card and no metrics
 * request is ever made; the API still answers 403 (§1.2).
 */
export function MetricsAccessGate({ label, children }: { label: string; children: ReactNode }) {
  const [access, setAccess] = useState<MetricsAccess | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setAccess(null);
    void loadMetricsAccessAction().catch((): MetricsAccess => ({ ok: false, reason: "no_response", reference: {} })).then(next => { if (active) setAccess(next); });
    return () => { active = false; };
  }, [attempt]);

  if (access && "kind" in access && access.kind === "allowed") return <>{children}</>;
  return <DashboardPageContent width="screen-2xl" className="min-w-0 gap-5 md:gap-6">
    {!access && <div role="status" aria-label={label} aria-busy="true" className="flex flex-col gap-2"><Skeleton aria-hidden="true" className="h-24 w-full" /><Skeleton aria-hidden="true" className="h-48 w-full" /></div>}
    {access && "kind" in access && access.kind === "restricted" && <MetricsRestricted />}
    {access && "reason" in access && (access.reason === "unauthenticated"
      ? <StateCard icon={TriangleAlert} tone="error" title="Tu sesión terminó" description="Tu sesión expiró. Inicia sesión de nuevo para consultar las métricas." primaryAction={{ label: "Iniciar sesión", href: "/empresa/login" }} />
      : <StateCard icon={TriangleAlert} tone="error" title="No pudimos verificar tu rol" description="Necesitamos confirmar tu rol en la empresa antes de mostrar las métricas. Puedes volver a intentarlo." primaryAction={{ label: "Reintentar", onClick: () => setAttempt(value => value + 1) }} />)}
  </DashboardPageContent>;
}
