"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { StateCard } from "@/components/feedback/state-card";
import { Spinner } from "@/components/ui/spinner";
import type { AccountAssessments, Result } from "../model";
import { answerable, PendingAssessments } from "./assessments";
import { loadWorkspaceAssessmentsAction } from "./load";

export function useWorkspaceAssessments() {
  const [result, setResult] = useState<Result<AccountAssessments>>();
  const request = useRef<Promise<Result<AccountAssessments>> | null>(null);
  useEffect(() => {
    let active = true;
    request.current ??= loadWorkspaceAssessmentsAction().catch(() => ({ ok: false, reason: "no_response", reference: {} }) as const);
    void request.current.then(value => { if (active) setResult(value); });
    return () => { active = false; };
  }, []);
  return result;
}

export function AssessmentsLoading() {
  return <Spinner aria-label="Cargando evaluaciones" />;
}

export function PendingAssessmentsWorkspace() {
  const result = useWorkspaceAssessments();
  if (result?.ok && !result.data.items.some(answerable)) return null;
  return <DashboardPageContent width="screen-2xl">
    {!result ? <AssessmentsLoading /> : result.ok ? <PendingAssessments items={result.data.items} /> : <StateCard icon={CircleAlert} tone="error" title="No pudimos cargar las evaluaciones" description="Tus respuestas guardadas se conservan. Consulta de nuevo para revisar tus pendientes." primaryAction={{ label: "Consultar de nuevo", href: "/candidato/dashboard" }} />}
  </DashboardPageContent>;
}
