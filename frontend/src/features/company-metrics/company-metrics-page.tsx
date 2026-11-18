"use client";
import { MetricsAccessGate } from "./metrics-page";
import { MetricsWorkspace } from "./metrics-workspace";

/** «Métricas»: the role gate first, then the company view; every figure opens its own detail page. */
export function CompanyMetricsPage() {
  return <MetricsAccessGate label="Cargando métricas"><MetricsWorkspace /></MetricsAccessGate>;
}
