"use client";
import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ActiveVacancies } from "@/components/company-dashboard/active-vacancies";
import { ChartAreaInteractive } from "@/components/company-dashboard/chart-area-interactive";
import { DataTable } from "@/components/company-dashboard/data-table";
import { SectionCards } from "@/components/company-dashboard/section-cards";
import { usePortfolioDrafts } from "@/features/employer-vacancies/use-portfolio-drafts";
import { getDashboardAction } from "./actions";
import type { DashboardResult } from "./model";

export function DashboardSkeleton() {
  return <div role="status" aria-label="Cargando dashboard" className="flex flex-col gap-6">
    <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Card key={i}><CardHeader><Skeleton className="h-5 w-36" /><Skeleton className="h-8 w-full" /></CardHeader><CardContent><Skeleton className="h-9 w-20" /></CardContent></Card>)}</div>
    {[250, 180, 280].map(height => <Card key={height}><CardHeader><Skeleton className="h-6 w-52" /></CardHeader><CardContent><Skeleton style={{ height }} className="w-full" /></CardContent></Card>)}
  </div>;
}
export function DashboardWorkspace() {
  const drafts = usePortfolioDrafts();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<DashboardResult | null>(null);
  useEffect(() => {
    let current = true;
    void getDashboardAction().then(value => { if (current) setResult(value); }).catch(() => { if (current) setResult({ ok: false, reason: "no_response", reference: {} }); });
    return () => { current = false; };
  }, [attempt]);
  const retry = () => { setResult(null); drafts.retry(); setAttempt(value => value + 1); };
  // Access failures take precedence over loading another block.
  const failure = (result && !result.ok ? result : null) ?? drafts.failure;
  if (failure) {
    const unauthenticated = failure.reason === "unauthenticated";
    const forbidden = ["forbidden", "not_found", "company_inactive", "company_not_active"].includes(failure.reason);
    return <StateCard icon={AlertCircle} tone={unauthenticated || forbidden ? "forbidden" : "error"} role="alert"
      title={unauthenticated ? "Tu sesión expiró" : forbidden ? "No tienes acceso al dashboard" : "No se pudo cargar el dashboard"}
      description={unauthenticated ? "Inicia sesión para ver los datos de tu empresa." : forbidden ? "Usa una cuenta con membresía activa en tu empresa." : "Revisa tu conexión y vuelve a intentarlo. No se modificó ningún dato."}
      primaryAction={unauthenticated ? { label: "Iniciar sesión", href: "/empresa/login" } : { label: "Reintentar", onClick: retry }} />;
  }
  if (!result || !result.ok || drafts.pending) return <DashboardSkeleton />;
  return <><SectionCards data={result.data} /><ChartAreaInteractive data={result.data.origin_by_day} />
    <ActiveVacancies vacancies={drafts.items} />
    {drafts.capped && <p role="status" className="text-sm text-muted-foreground">Se muestran las primeras 500 vacantes. Consulta todas tus vacantes en la lista.</p>}
    <DataTable data={result.data.recent} /></>;
}
