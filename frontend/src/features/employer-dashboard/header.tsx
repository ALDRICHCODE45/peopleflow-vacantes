"use client";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { firstName, freshness, scopeLabel } from "./format";
import { WINDOWS, type DashboardHeader as Header, type DashboardWindow } from "./model";

/** The sidebar's «Crear vacante» entry point. */
export const CREATE_VACANCY_HREF = "/empresa/vacantes/borradores/nuevo";

/**
 * Board header (rules 2 and 11, artboard 09): greeting, scope, freshness once, the period control and one primary
 * action. It renders before any section answers; scope and freshness come from the summary header.
 */
export function DashboardHeader({ greeting, name, header, window, now, onWindow }: {
  greeting: string; name: string | null | undefined; header: Header | null; window: DashboardWindow; now: Date; onWindow: (next: DashboardWindow) => void;
}) {
  const first = firstName(name);
  return <header className="flex flex-wrap items-end justify-between gap-6">
    <div className="flex min-w-0 flex-col gap-2">
      <h2 className="font-heading text-2xl font-semibold tracking-tight">{first ? `${greeting}, ${first}` : greeting}</h2>
      {header ? <>
        <p className="text-sm text-muted-foreground">{scopeLabel(header.scope)}</p>
        <p className="text-xs text-muted-foreground">{freshness(header, now)}</p>
      </> : <div aria-hidden="true" className="flex flex-col gap-2"><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-64" /></div>}
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <div role="group" aria-label="Periodo" className="flex rounded-xl border bg-card p-0.5">
        {WINDOWS.map(days => <Button key={days} type="button" variant="ghost" aria-pressed={window === days}
          className={cn("min-h-10 rounded-lg px-3.5 text-muted-foreground", window === days && "bg-primary/10 font-semibold text-brand-decorative-strong hover:bg-primary/15 hover:text-brand-decorative-strong")}
          onClick={() => onWindow(days)}>{days} días</Button>)}
      </div>
      <Link href={CREATE_VACANCY_HREF} className={cn(buttonVariants(), "min-h-10")}><Plus aria-hidden="true" data-icon="inline-start" />Crear vacante</Link>
    </div>
  </header>;
}
