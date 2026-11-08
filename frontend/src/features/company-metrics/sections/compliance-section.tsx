"use client";
import { Skeleton } from "@/components/ui/skeleton";
import type { ComplianceSection as ComplianceSectionData } from "../model";
import { MetricsSection } from "../section";
import type { SectionProps } from "./types";

/** «Cumplimiento de entregas» (artboard 07). Placeholder until its unit lands (T10a-B). */
export function ComplianceSection({ state }: SectionProps<ComplianceSectionData>) {
  return <MetricsSection title="Cumplimiento de entregas" state={state} help={{ title: "Cumplimiento de entregas", body: <p>Las definiciones de esta sección.</p> }}
    skeleton={<Skeleton aria-hidden="true" className="h-64 w-full rounded-3xl" />}>
    {() => null}
  </MetricsSection>;
}
