import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DataTable, formatReceivedDate } from "./data-table";
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(cleanup);
it("shows the shared empty state and no prototype tabs or drawer", () => { render(<DataTable data={[]} />); expect(screen.getByText("Aún no hay candidatos en tus vacantes")).toBeInTheDocument(); expect(screen.queryByRole("tab")).toBeNull(); });
it("renders participation source independently from candidate kind and opens the vacancy", () => {
  render(<DataTable data={[{ participation_id: "p", candidate: { id: "c", kind: "organic", name: "Ana" }, vacancy: { id: "v", title: "Go" }, stage: { id: "s", name: "Entrevista" }, source: "manual", added_by: { id: "a", name: "María" }, applied_at: "2026-10-24T01:00:00Z" }]} />);
  for (const column of ["Candidato", "Vacante", "Etapa", "Origen", "Fecha", "Agregado por"]) expect(screen.getByRole("columnheader", { name: column })).toBeInTheDocument();
  expect(screen.getByText("Manual")).toBeInTheDocument(); expect(screen.getByText("María")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ana" })).toHaveAttribute("href", "/empresa/vacantes/v/pipeline");
  fireEvent.click(screen.getByText("Entrevista")); expect(push).toHaveBeenCalledWith("/empresa/vacantes/v/pipeline");
});
it("uses the Mexico City day, not the UTC day", () => { expect(formatReceivedDate("2026-10-24T01:00:00Z")).toBe("23 oct 2026"); });
