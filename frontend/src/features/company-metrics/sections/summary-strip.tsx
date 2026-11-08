"use client";
import { Skeleton } from "@/components/ui/skeleton";
import type { MetricsSummary } from "../model";
import { MetricsSection } from "../section";
import type { SectionProps } from "./types";

/** «Resumen» (artboard 07). Placeholder until its unit lands (T10a-B). */
export function SummaryStrip({ state }: SectionProps<MetricsSummary>) {
  return <MetricsSection title="Resumen" state={state} help={{ title: "Resumen", body: <p>Las definiciones de esta sección.</p> }}
    skeleton={<Skeleton aria-hidden="true" className="h-64 w-full rounded-3xl" />}>
    {() => null}
  </MetricsSection>;
}
