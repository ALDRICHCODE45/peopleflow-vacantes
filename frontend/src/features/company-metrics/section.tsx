"use client";
import { useId, useState, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { failureMessage } from "./failure";
import type { SectionState } from "./use-section";

/**
 * One board section (`design/system.md` rules 1, 7, 15, 17): a short professional title, one «Cómo se calcula» trigger
 * with the definitions (never shown by default), its own skeleton, failure and retry; while new filters load, the last
 * numbers stay visible and dimmed so nothing jumps. `helpFirst` puts «Cómo se calcula» before the actions, as the
 * recruiter page's artboard 10 does and every section with actions now follows.
 */
export function MetricsSection<T>({ title, help, state, skeleton, actions, helpFirst = false, children }: {
  title: string;
  help: { title: string; body: ReactNode };
  state: Pick<SectionState<T>, "status" | "data" | "stale" | "failure" | "ref" | "retry">;
  skeleton: ReactNode;
  actions?: ReactNode;
  helpFirst?: boolean;
  children: (data: T) => ReactNode;
}) {
  const headingId = useId();
  const helpTrigger = <SectionHelp title={help.title} body={help.body} section={title} />;
  const busy = state.status === "loading" || state.status === "idle";
  return <section ref={state.ref} aria-labelledby={headingId} aria-busy={busy || undefined} className="flex min-w-0 flex-col gap-6">
    {/* Rule 14: when the title and its actions do not fit on one line, the actions wrap below instead of squeezing it. */}
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <h2 id={headingId} className="min-w-0 text-lg font-semibold tracking-tight">{title}</h2>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {helpFirst && helpTrigger}
        {actions}
        {!helpFirst && helpTrigger}
      </div>
    </div>
    {state.data !== null && state.status !== "failed"
      ? <div className={cn("min-w-0 transition-opacity motion-reduce:transition-none", state.stale && "opacity-60")}>{children(state.data)}</div>
      : state.status === "failed" && state.failure
        ? <Card><CardContent><SectionEmpty icon={TriangleAlert} tone="empty" role="alert" title={`No pudimos cargar ${title.toLowerCase()}`}
          description={failureMessage(state.failure, title.toLowerCase())} primaryAction={{ label: "Reintentar", onClick: state.retry }} /></CardContent></Card>
        : <div role="status" aria-label={`Cargando ${title.toLowerCase()}`}>{skeleton}</div>}
  </section>;
}

/** Rule 7: the explanation lives behind one ghost trigger per section heading. */
function SectionHelp({ title, body, section }: { title: string; body: ReactNode; section: string }) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button type="button" variant="ghost" className="min-h-10 text-muted-foreground" aria-label={`Cómo se calcula: ${section}`} />}>
      Cómo se calcula
    </PopoverTrigger>
    <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)]">
      <PopoverTitle className="font-semibold">{title}</PopoverTitle>
      <PopoverDescription render={<div />} className="flex flex-col gap-2 text-muted-foreground">{body}</PopoverDescription>
    </PopoverContent>
  </Popover>;
}
