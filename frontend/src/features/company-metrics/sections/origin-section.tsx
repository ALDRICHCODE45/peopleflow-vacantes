"use client";
import { Skeleton } from "@/components/ui/skeleton";
import type { OriginSection as OriginSectionData } from "../model";
import { MetricsSection } from "../section";
import type { SectionProps } from "./types";

/** «Origen de las postulaciones» (artboard 07). Placeholder until its unit lands (T10a-B). */
export function OriginSection({ state }: SectionProps<OriginSectionData>) {
  return <MetricsSection title="Origen de las postulaciones" state={state} help={{ title: "Origen de las postulaciones", body: <p>Las definiciones de esta sección.</p> }}
    skeleton={<Skeleton aria-hidden="true" className="h-64 w-full rounded-3xl" />}>
    {() => null}
  </MetricsSection>;
}
