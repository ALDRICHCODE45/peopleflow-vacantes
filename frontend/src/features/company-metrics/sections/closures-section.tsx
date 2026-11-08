"use client";
import { Skeleton } from "@/components/ui/skeleton";
import type { ClosuresSection as ClosuresSectionData } from "../model";
import { MetricsSection } from "../section";
import type { SectionProps } from "./types";

/** «Cierres y entregas» (artboard 07). Placeholder until its unit lands (T10a-B). */
export function ClosuresSection({ state }: SectionProps<ClosuresSectionData>) {
  return <MetricsSection title="Cierres y entregas" state={state} help={{ title: "Cierres y entregas", body: <p>Las definiciones de esta sección.</p> }}
    skeleton={<Skeleton aria-hidden="true" className="h-64 w-full rounded-3xl" />}>
    {() => null}
  </MetricsSection>;
}
