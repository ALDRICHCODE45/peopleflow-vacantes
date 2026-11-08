"use client";
import { useCallback, useMemo, type ReactNode } from "react";
import { ChevronRight, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { SectionEmpty } from "@/components/feedback/state-card";
import { failureMessage } from "@/features/company-metrics/failure";
import { MetricsSection } from "@/features/company-metrics/section";
import { CARD } from "@/features/company-metrics/sections/summary-strip";
import type { SectionState } from "@/features/company-metrics/use-section";
import { cn } from "@/lib/utils";

/** The definitions of a section, shown only in its «Cómo se calcula» popover (rule 7). */
export function HelpList({ items }: { items: [string, string][] }) {
  return <dl className="flex flex-col gap-3">
    {items.map(([term, text]) => <div key={term}><dt className="font-medium text-foreground">{term}</dt><dd className="mt-1">{text}</dd></div>)}
  </dl>;
}

type Loadable = Pick<SectionState<unknown>, "ref">;
/**
 * A section made of cards that load on their own (Seguimiento, Vacantes y candidatos): the metrics section heading and
 * «Cómo se calcula» trigger, while every card keeps its own skeleton, failure and stale state (`CardSlot`).
 */
export function DashboardSection({ title, help, loads, children }: { title: string; help: { title: string; body: ReactNode }; loads: [Loadable, Loadable]; children: ReactNode }) {
  const [first, second] = loads;
  const ref = useCallback((node: Element | null) => { first.ref(node); second.ref(node); }, [first.ref, second.ref]); // eslint-disable-line react-hooks/exhaustive-deps
  const shell = useMemo(() => ({ status: "ready" as const, data: true, stale: false, failure: null, ref, retry: () => {} }), [ref]);
  return <MetricsSection title={title} help={help} state={shell} skeleton={null}>{() => children}</MetricsSection>;
}

/** One card's state (rules 15, 17): its skeleton, its failure with retry, or its data, dimmed while stale. */
export function CardSlot<T>({ state, subject, className, skeleton, children }: {
  state: Pick<SectionState<T>, "status" | "data" | "stale" | "failure" | "retry">; subject: string; className?: string; skeleton: ReactNode; children: (data: T) => ReactNode;
}) {
  if (state.data !== null && state.status !== "failed") {
    return <div data-stale={state.stale} aria-busy={state.stale || undefined}
      className={cn("flex min-w-0 flex-col transition-opacity motion-reduce:transition-none", state.stale && "opacity-60", className)}>{children(state.data)}</div>;
  }
  if (state.status === "failed" && state.failure) {
    return <article className={cn(CARD, className)}>
      <SectionEmpty icon={TriangleAlert} tone="empty" role="alert" title={`No pudimos cargar ${subject}`} description={failureMessage(state.failure, subject)}
        primaryAction={{ label: "Reintentar", onClick: state.retry }} />
    </article>;
  }
  return <div role="status" aria-label={`Cargando ${subject}`} className={cn("flex min-w-0 flex-col", className)}>{skeleton}</div>;
}

/** Card title 15/600 with at most one muted scope line (rules 7, 10). */
export function CardHead({ id, title, caption, action }: { id: string; title: string; caption?: ReactNode; action?: ReactNode }) {
  return <div className="flex items-start justify-between gap-4">
    <div className="min-w-0">
      <h3 id={id} className="text-[15px] leading-[22px] font-semibold">{title}</h3>
      {caption && <p className="mt-1 text-xs text-muted-foreground">{caption}</p>}
    </div>
    {action}
  </div>;
}

/** «Ver …» at the foot of a card; nothing while its destination does not exist yet. */
export function FootLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return null;
  return <Link href={href} className="-ml-2 mt-auto inline-flex min-h-10 items-center gap-1 self-start rounded-lg px-2 font-medium text-brand-decorative-strong outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
    {children}<ChevronRight aria-hidden="true" className="size-4" />
  </Link>;
}
