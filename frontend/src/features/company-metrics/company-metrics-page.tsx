"use client";
import { MetricsAccessGate } from "./metrics-page";
import { MetricsWorkspace } from "./metrics-workspace";

/** «Métricas»: the role gate first, then the company view. */
export function CompanyMetricsPage() {
  return <MetricsAccessGate label="Cargando métricas"><MetricsWorkspace /></MetricsAccessGate>;
}
