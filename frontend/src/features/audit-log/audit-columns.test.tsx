import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { auditColumns } from "./audit-columns";
import { auditEvent, vacancyId } from "./test-fixtures";
import type { AuditEvent } from "./model";

afterEach(cleanup);
function entityCell(event: AuditEvent) {
  const column = auditColumns.find(item => item.id === "entity")!;
  const Cell = column.cell as (context: { row: { original: AuditEvent } }) => React.ReactNode;
  return render(<>{Cell({ row: { original: event } })}</>);
}
it("«Sobre» shows the person or record the event is about", () => {
  entityCell(auditEvent());
  expect(screen.getByText("María Pérez")).toBeVisible();
});
it("«Sobre» is empty when the entity is the vacancy already shown in «Vacante» (by id or by title)", () => {
  const byId = entityCell(auditEvent({ entity: { type: "job_draft", id: vacancyId, label: "Ejecutivo de ventas" } }));
  expect(screen.queryByText("Ejecutivo de ventas")).not.toBeInTheDocument();
  expect(byId.container).toHaveTextContent("—");
  cleanup();
  entityCell(auditEvent({ entity: { type: "vacancy", id: "otro", label: "Ejecutivo de ventas" } }));
  expect(screen.queryByText("Ejecutivo de ventas")).not.toBeInTheDocument();
});
it("a person who shares the vacancy's title is still shown, and an event without vacancy keeps its label", () => {
  entityCell(auditEvent({ entity: { type: "company_candidate", id: "x", label: "Ejecutivo de ventas" } }));
  expect(screen.getByText("Ejecutivo de ventas")).toBeVisible();
  cleanup();
  entityCell(auditEvent({ vacancy: null, entity: { type: "vacancy", id: vacancyId, label: "Ejecutivo de ventas" } }));
  expect(screen.getByText("Ejecutivo de ventas")).toBeVisible();
});

it("fits a 1440 px page without sideways scrolling: the fixed column widths add up to less than the card's content width", () => {
  // 1440 − 288 sidebar − 2 × 24 page padding − 2 × 24 card padding ≈ 1056; the table lives edge to edge in the card, so 1092 is the ceiling.
  const total = auditColumns.reduce((sum, column) => sum + column.size, 0);
  expect(total).toBeLessThanOrEqual(1092);
});
it("orders the columns as the artboard: Cuándo, Quién, Acción, Sobre, Vacante, IP y navegador", () => {
  expect(auditColumns.map(column => column.meta.label)).toEqual(["Cuándo", "Quién", "Acción", "Sobre", "Vacante", "IP y navegador"]);
});
it("«Sobre» is a dash when the entity has no label (not «Sin etiqueta»)", () => {
  const view = entityCell(auditEvent({ entity: { type: "company_candidate", id: "x", label: null } }));
  expect(view.container).toHaveTextContent("—");
  expect(screen.queryByText("Sin etiqueta")).toBeNull();
});
