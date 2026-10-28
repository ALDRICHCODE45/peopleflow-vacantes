"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CircleAlert, Users } from "lucide-react";
import { SiteHeader } from "@/components/company-dashboard/site-header";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { StateCard } from "@/components/feedback/state-card";
import { buttonVariants } from "@/components/ui/button";
import { loadBoardAction } from "@/features/pipeline-movement/actions";
import { loadDraftForEditAction } from "@/features/jobs/drafts/reopen/load";
import { loadCompanyStateAction } from "@/features/employer-company/actions";
import { loadChecklistAction, loadChecklistMarksAction } from "../actions";
import { buildComparison, type Comparison, type StageNames } from "./model";
import { ComparisonReport, ComparisonSkeleton } from "./report";

type Loaded = { model: Comparison; stages: StageNames; title: string; company: string; date: string };
type State = { kind: "loading" } | { kind: "failed"; reason: string } | { kind: "ready"; data: Loaded };
export function ComparisonPage({ jobId, ids }: { jobId: string; ids: string }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ kind: "loading" });
  useEffect(() => {
    let current = true;
    setState({ kind: "loading" });
    async function load() {
      try {
        const [board, checklist, marks, draft, company] = await Promise.all([
          loadBoardAction(jobId), loadChecklistAction(jobId), loadChecklistMarksAction(jobId), loadDraftForEditAction(jobId),
          // Company branding is optional; never block the comparison if unavailable.
          loadCompanyStateAction().catch(() => null),
        ]);
        if (!current) return;
        if (!board.ok || !checklist.ok || !marks.ok || !draft.ok) {
          const failures = [board, checklist, marks, draft].filter(result => !result.ok);
          const reason = failures.some(result => !result.ok && result.reason === "unauthenticated") ? "unauthenticated"
            : failures.some(result => !result.ok && result.reason === "forbidden") ? "forbidden" : "failed";
          setState({ kind: "failed", reason }); return;
        }
        setState({ kind: "ready", data: {
          model: buildComparison(checklist.data, marks.data.items, board.data.participations, ids ? ids.split(",") : []),
          stages: Object.fromEntries([...board.data.retired_stages, ...board.data.stages, board.data.exit].map(stage => [stage.id, stage.name])),
          title: draft.seed.model.fields.title || "Sin título", company: company?.kind === "exists" ? company.company.name : "",
          date: new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "America/Mexico_City" }).format(new Date()),
        } });
      } catch { if (current) setState({ kind: "failed", reason: "failed" }); }
    }
    void load();
    return () => { current = false; };
  }, [jobId, ids, attempt]);
  const back = `/empresa/vacantes/${jobId}/pipeline`;
  const data = state.kind === "ready" ? state.data : null;
  return <div className="flex min-w-0 flex-col gap-4">
    <SiteHeader title="Comparar" parent={{ label: "Pipeline", href: back }} />
    <DashboardPageContent width="screen-2xl" className="min-w-0 gap-5">
      <nav aria-label="Vacante y proceso" className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground" data-comparison-controls>
        <Link href="/empresa/vacantes">Vacantes</Link><span aria-hidden="true">›</span>
        <Link href={back} className="truncate">{data?.title ?? "Vacante"}</Link><span aria-hidden="true">›</span>
        <Link href={back}>Pipeline</Link><span aria-hidden="true">›</span><span aria-current="page">Comparar</span>
      </nav>
      {state.kind === "loading" ? <ComparisonSkeleton count={new Set(ids.split(",")).size} />
        : state.kind === "failed" ? <StateCard icon={CircleAlert} tone="error" title={state.reason === "unauthenticated" ? "Tu sesión expiró" : state.reason === "forbidden" ? "No tienes permiso para comparar" : "No pudimos cargar la comparación"} description="Tus datos no cambiaron. Vuelve a intentar o regresa al pipeline."
          primaryAction={state.reason === "unauthenticated" ? { label: "Iniciar sesión", href: `/empresa/login?next=${encodeURIComponent(`${back}/comparar?ids=${ids}`)}` } : state.reason === "forbidden" ? { label: "Volver al pipeline", href: back } : { label: "Reintentar", onClick: () => setAttempt(n => n + 1) }} />
        : data && !data.model.groups.length ? <StateCard icon={Users} tone="empty" title="Todavía no hay criterios" description="Configura el checklist de esta vacante para comparar a tus candidatos." primaryAction={{ label: "Configurar checklist", href: `/empresa/vacantes/${jobId}/configuracion/checklist` }} />
        : data && data.model.invalidIds.length > 0 ? <StateCard icon={Users} tone="empty" title="No encontramos todos los candidatos" description="Uno o más candidatos no están en el pipeline de esta vacante. Vuelve al tablero y selecciona de nuevo." primaryAction={{ label: "Volver al pipeline", href: back }} />
        : data && (data.model.candidates.length < 2 || data.model.candidates.length > 5) ? <StateCard icon={Users} tone="empty" title="Elige entre 2 y 5 candidatos" description="Selecciona al menos dos candidatos distintos en el pipeline para compararlos lado a lado." primaryAction={{ label: "Volver al pipeline", href: back }} />
        : data && <ComparisonReport {...data} />}
      {data && data.model.groups.length > 0 && data.model.invalidIds.length === 0 && data.model.candidates.length >= 2 && data.model.candidates.length <= 5 && <Link href={back} data-comparison-controls className={buttonVariants({ variant: "ghost", className: "min-h-10 self-start" })}><ArrowLeft aria-hidden="true" data-icon="inline-start" />Volver al pipeline</Link>}
    </DashboardPageContent>
  </div>;
}
