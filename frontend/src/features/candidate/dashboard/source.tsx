"use client";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { RoleBlocked } from "@/features/identity/identity-states";
import Link from "next/link";

export type ReadResult<T> = { ok: true; data: T } | { ok: false; reason: string; reference: { code?: string } };
export type Source<T> = { result?: ReadResult<T>; retry: () => void };
/** Independent read lifetimes: one source's failure/retry never reloads another. */
export function useSource<T>(load: () => Promise<ReadResult<T>>): Source<T> {
  const [result, setResult] = useState<ReadResult<T>>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void load().catch(() => ({ ok: false, reason: "no_response", reference: {} }) as const).then(value => { if (active) setResult(value); });
    return () => { active = false; };
  }, [load, attempt]);
  return { result, retry: () => { setResult(undefined); setAttempt(value => value + 1); } };
}
export function SourceLoading({ label, compact = false }: { label: string; compact?: boolean }) {
  return <div aria-busy="true" aria-label={label} className="grid gap-3">
    <span role="status" className="sr-only">{label}</span>
    {!compact && <Skeleton aria-hidden="true" className="h-8 w-24" />}<Skeleton aria-hidden="true" className="h-4 w-full" />{!compact && <Skeleton aria-hidden="true" className="h-10 w-36" />}
  </div>;
}
type Failure = Extract<ReadResult<never>, { ok: false }>;
export const isWrongRole = (failure: Failure) => failure.reason === "wrong_role" || failure.reference.code === "wrong_role";
export function SourceErrorCard(props: { failure: Failure; retry: () => void; label: string }) {
  // RoleBlocked already owns a StateCard. Do not nest a Card inside another Card.
  return isWrongRole(props.failure) ? <SourceError {...props} /> : <Card size="sm"><CardContent><SourceError {...props} /></CardContent></Card>;
}
export function SourceError({ failure, retry, label }: { failure: Failure; retry: () => void; label: string }) {
  if (isWrongRole(failure)) return <RoleBlocked kind="recruiter" />;
  return <div role="alert" className="flex flex-col items-start gap-2">
    <p className="flex items-center gap-2 text-sm"><CircleAlert aria-hidden="true" className="size-4 shrink-0 text-destructive" />No pudimos cargar {label}</p>
    <p className="text-xs text-muted-foreground">Tus datos no cambiaron.</p>
    {failure.reason === "unauthenticated" ? <Link className={cn(buttonVariants({ variant: "outline" }), "min-h-10")} href="/candidato/login?next=%2Fcandidato%2Fdashboard">Iniciar sesión</Link> : <Button variant="outline" className="min-h-10" onClick={retry}>Reintentar</Button>}
  </div>;
}
