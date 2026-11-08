"use client";
import { Skeleton } from "@/components/ui/skeleton";
import type { RecruiterCard } from "../model";
import { MetricsSection } from "../section";
import type { SectionProps } from "./types";

/** «Desempeño por reclutador» (artboard 07). Placeholder until its unit lands (T10a-B). */
export function RecruitersSection({ state }: SectionProps<RecruiterCard[]>) {
  return <MetricsSection title="Desempeño por reclutador" state={state} help={{ title: "Desempeño por reclutador", body: <p>Las definiciones de esta sección.</p> }}
    skeleton={<Skeleton aria-hidden="true" className="h-64 w-full rounded-3xl" />}>
    {() => null}
  </MetricsSection>;
}
