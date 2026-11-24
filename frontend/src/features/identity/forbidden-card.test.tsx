import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AuditRestricted } from "@/features/audit-log/audit-restricted";
import { MetricsRestricted } from "@/features/company-metrics/metrics-page";
import { StakeholderRouteBlocked } from "./identity-states";

vi.mock("@/features/company-metrics/actions", () => ({ loadMetricsAccessAction: vi.fn() }));
afterEach(cleanup);

// D18: Auditoría, Métricas and «Sección no disponible» are one forbidden layout, and none of them says «owner».
it.each([
  ["Auditoría restringida", <AuditRestricted key="audit" />],
  ["Métricas restringidas", <MetricsRestricted key="metrics" />],
  ["Esta sección no está disponible para tu rol", <StakeholderRouteBlocked key="section" />],
] as const)("renders «%s» with the shared forbidden card", (title, view) => {
  const { container } = render(view);
  const card = container.querySelector("[data-slot='card']")!;
  expect(card).toHaveClass("max-w-xl", "mx-auto", "w-full");
  expect(card.querySelector("[data-slot='empty'] svg")).toHaveClass("lucide-lock");
  expect(card.querySelector("[role='heading']")).toHaveTextContent(title);
  expect(container.textContent).not.toMatch(/\bowner\b/i);
});
