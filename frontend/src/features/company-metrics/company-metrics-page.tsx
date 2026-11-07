"use client";
import { DetailLists } from "./detail-lists";
import { MetricsAccessGate } from "./metrics-page";
import { MetricsWorkspace } from "./metrics-workspace";

/** «Métricas»: the role gate first, then the company view with its detail lists. */
export function CompanyMetricsPage() {
  return <MetricsAccessGate label="Cargando métricas"><MetricsWorkspace details={filters => <DetailLists filters={filters} />} /></MetricsAccessGate>;
}
