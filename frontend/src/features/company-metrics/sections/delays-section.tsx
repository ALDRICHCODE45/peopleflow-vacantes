"use client";
import { Skeleton } from "@/components/ui/skeleton";
import type { DelaysSection as DelaysSectionData } from "../model";
import { MetricsSection } from "../section";
import type { SectionProps } from "./types";

/** «Retrasos y reasignaciones» (artboard 07). Placeholder until its unit lands (T10a-B). */
export function DelaysSection({ state }: SectionProps<DelaysSectionData>) {
  return <MetricsSection title="Retrasos y reasignaciones" state={state} help={{ title: "Retrasos y reasignaciones", body: <p>Las definiciones de esta sección.</p> }}
    skeleton={<Skeleton aria-hidden="true" className="h-64 w-full rounded-3xl" />}>
    {() => null}
  </MetricsSection>;
}
