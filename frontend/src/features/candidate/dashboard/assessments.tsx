"use client";
import { useEffect, useMemo, useState } from "react";
import { useWorkspaceAssessments } from "@/features/psychometrics/workspace/mounted";
import { actionableAssessment } from "@/features/psychometrics/workspace/assessments";
import type { AccountAssessments } from "@/features/psychometrics/model";
import { SourceErrorCard, type ReadResult } from "./source";
import { NextStepSkeleton } from "./next-step";

export type AssessmentResult = ReadResult<AccountAssessments> | undefined;
// setTimeout stores its delay in a signed 32-bit integer; a longer wait fires at once.
const MAX_DELAY = 2 ** 31 - 1;

export function DashboardAssessments({ onResult }: { onResult: (result: AssessmentResult) => void }) {
  const [attempt, setAttempt] = useState(0);
  return <AssessmentRead key={attempt} onResult={onResult} retry={() => { onResult(undefined); setAttempt(value => value + 1); }} />;
}

/**
 * The read island owns loading/error feedback; on success the overview composes «Siguiente paso» from the forwarded
 * eligible set. Expiry can pass while the dashboard stays open, so one timeout wakes the reader at the next
 * `expires_at`. The result is forwarded only when the eligible ids change: a per-second ticker re-rendered the whole
 * workspace and restarted every chart animation (L4).
 */
function AssessmentRead({ onResult, retry }: { onResult: (result: AssessmentResult) => void; retry: () => void }) {
  const result = useWorkspaceAssessments();
  const [now, setNow] = useState(() => Date.now());
  const items = result?.ok ? result.data.items : undefined;
  const eligibleIds = items?.filter(item => actionableAssessment(item, now)).map(item => item.id).join("\n") ?? "";
  const forwarded = useMemo<AssessmentResult>(() => {
    if (!result?.ok) return result;
    const keep = new Set(eligibleIds.split("\n"));
    return { ok: true, data: { items: result.data.items.filter(item => keep.has(item.id)) } };
  }, [result, eligibleIds]);
  useEffect(() => { onResult(forwarded); }, [forwarded, onResult]);
  useEffect(() => {
    const expiries = items?.filter(item => actionableAssessment(item, now)).map(item => Date.parse(item.expires_at)) ?? [];
    if (!expiries.length) return;
    // +1 ms: actionableAssessment keeps an invitation open while expires_at > now.
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(Math.max(0, Math.min(...expiries) - Date.now()) + 1, MAX_DELAY));
    return () => window.clearTimeout(timer);
  }, [items, now]);
  return !result ? <NextStepSkeleton label="Cargando evaluaciones" /> : !result.ok ? <SourceErrorCard label="las evaluaciones" failure={result} retry={retry} /> : null;
}
