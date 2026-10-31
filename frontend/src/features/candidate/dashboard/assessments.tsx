"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, ClipboardList } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkspaceAssessments } from "@/features/psychometrics/workspace/mounted";
import { actionableAssessment, AssessmentBlock } from "@/features/psychometrics/workspace/assessments";
import type { AccountAssessments } from "@/features/psychometrics/model";
import { SourceErrorCard, SourceLoading, type ReadResult } from "./source";

export type AssessmentResult = ReadResult<AccountAssessments> | undefined;
export function DashboardAssessments({ firstVisit, onResult }: { firstVisit: boolean; onResult: (result: AssessmentResult) => void }) {
  const [attempt, setAttempt] = useState(0);
  return <AssessmentRead key={attempt} firstVisit={firstVisit} onResult={onResult} retry={() => { onResult(undefined); setAttempt(value => value + 1); }} />;
}
function AssessmentRead({ firstVisit, onResult, retry }: { firstVisit: boolean; onResult: (result: AssessmentResult) => void; retry: () => void }) {
  const result = useWorkspaceAssessments();
  // Expiry can pass while this dashboard stays open, just as in the applications inbox.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const pending = result?.ok ? result.data.items.filter(item => actionableAssessment(item, now)) : [];
  // Forward the same eligible set used by the rail, never message/unread guesses.
  useEffect(() => {
    onResult(result?.ok ? { ok: true, data: { items: result.data.items.filter(item => actionableAssessment(item, now)) } } : result);
  }, [result, now, onResult]);
  return <section aria-labelledby="dashboard-attention" className="order-3 min-w-0 lg:order-none lg:col-start-2 lg:row-start-3">
    <header className="mb-3 flex min-h-10 items-center justify-between gap-3"><h2 id="dashboard-attention" className="text-base font-semibold">Por atender</h2>{result?.ok && <span className="text-xs text-muted-foreground">{pending.length ? `${pending.length} ${pending.length === 1 ? "pendiente" : "pendientes"}` : firstVisit ? "" : "Al día"}</span>}</header>
    {!result ? <Card size="sm"><CardHeader><CardTitle className="sr-only">Evaluaciones</CardTitle></CardHeader><CardContent><SourceLoading label="Cargando evaluaciones" /></CardContent></Card> : !result.ok ? <SourceErrorCard label="las evaluaciones" failure={result} retry={retry} /> : pending.length === 0 ? <StateCard icon={firstVisit ? ClipboardList : CheckCircle2} tone="empty" title={firstVisit ? "Aquí aparecerán tus pendientes" : "Todo al día"}
      description={firstVisit ? "Cuando una empresa te envíe una evaluación, podrás atenderla aquí. Empieza por encontrar una vacante." : "No tienes evaluaciones pendientes. Puedes seguir buscando a tu ritmo."}
      primaryAction={{ label: "Explorar vacantes", href: "/vacantes" }} /> : <ul className="grid gap-3">{pending.map(item => <li key={item.id}><Card size="sm">
        <CardHeader><CardTitle><h3 className="flex items-center gap-2 text-sm"><ClipboardList aria-hidden="true" className="size-5 text-status-review" />Evaluación pendiente</h3></CardTitle><CardDescription className="break-words">{item.vacancy.title} · {item.company.name}</CardDescription></CardHeader>
        <CardContent><AssessmentBlock item={item} /></CardContent>
      </Card></li>)}</ul>}
  </section>;
}
