import "./board-filter-popover-test-double";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MovementBoard } from "./board";
import { boardFixture } from "./board-fixture";
import { loadBoardAction } from "./actions";
import { matchesSearch } from "./board-search";

vi.mock("./actions", () => ({ loadBoardAction: vi.fn() }));
vi.mock("@/features/vacancy-checklist/actions", () => ({
  loadChecklistAction: vi.fn(async () => ({ ok: true, data: { version: "0", criteria: [], reminder_stage_ids: [] } })),
  loadChecklistMarksAction: vi.fn(async () => ({ ok: true, data: { items: [] } })),
}));
vi.mock("@/features/languages/use-language-catalog", () => ({ useLanguageCatalog: () => ({ status: "success", data: { items: [] } }) }));
vi.mock("./use-board-column-order", () => ({ useBoardColumnOrder: (_id: string, board: unknown) => ({ board, locked: true, structureLocked: true }) }));
vi.mock("@/features/jobs/drafts/pipeline/delivery-actions", () => ({ loadDeliveryStatusAction: vi.fn(async () => ({ ok: false })) }));
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("PointerEvent", MouseEvent); window.history.replaceState(null, "", "/empresa/vacantes/v/pipeline"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function people() {
  const board = boardFixture();
  const base = board.participations[0];
  board.participations = [
    { ...base, id: "ana", candidate: { ...base.candidate, id: "c-ana", full_name: "Ana Pérez" } },
    { ...base, id: "luis", candidate: { ...base.candidate, id: "c-luis", full_name: "Luis López" } },
    { ...base, id: "ana2", stage_id: "screen", candidate: { ...base.candidate, id: "c-ana2", full_name: "Anabel Ríos" } },
  ];
  return board;
}
async function open(url = "") {
  if (url) window.history.replaceState(null, "", url);
  vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: people() });
  render(<MovementBoard vacancyId="vacancy" />);
  await screen.findByRole("button", { name: "Filtros" });
  return screen.getByRole("region", { name: "Columnas del pipeline" });
}
const search = () => screen.getByRole("searchbox", { name: "Buscar candidato" });
it("matches every word of the query against the name, ignoring case and accents", () => {
  expect(matchesSearch("Ana Pérez", "perez")).toBe(true);
  expect(matchesSearch("Ana Pérez", "  ANA  pér ")).toBe(true);
  expect(matchesSearch("Ana Pérez", "ana lopez")).toBe(false);
  expect(matchesSearch("Ana Pérez", "")).toBe(true);
});
it("narrows the loaded board by name and keeps the query in the URL", async () => {
  const columns = await open();
  expect(screen.getByText("Luis López")).toBeVisible();
  fireEvent.change(search(), { target: { value: "ana" } });
  expect(screen.queryByText("Luis López")).not.toBeInTheDocument();
  expect(within(columns).getByText("Ana Pérez")).toBeVisible();
  expect(within(columns).getByText("Anabel Ríos")).toBeVisible();
  expect(new URL(window.location.href).searchParams.get("q")).toBe("ana");
  expect(screen.getByText(/Vista filtrada · Mostrando 2 de 3 candidatos/)).toBeVisible();
  fireEvent.change(search(), { target: { value: "" } });
  expect(new URL(window.location.href).searchParams.has("q")).toBe(false);
  expect(screen.getByText("Luis López")).toBeVisible();
});
it("starts from ?q= and keeps the other query parameters", async () => {
  await open("/empresa/vacantes/v/pipeline?tab=pipeline&q=luis");
  expect(search()).toHaveValue("luis");
  await waitFor(() => expect(screen.queryByText("Ana Pérez")).not.toBeInTheDocument());
  expect(screen.getByText("Luis López")).toBeVisible();
  fireEvent.change(search(), { target: { value: "luis l" } });
  expect(new URL(window.location.href).searchParams.get("tab")).toBe("pipeline");
});
it("combines the search with the column filter", async () => {
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
  const sheet = await screen.findByRole("dialog", { name: "Filtrar candidatos" });
  fireEvent.click(within(sheet).getByRole("button", { name: "Etapa del pipeline" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Revisión 1" }));
  fireEvent.click(within(sheet).getByRole("button", { name: "Cerrar filtros" }));
  fireEvent.change(search(), { target: { value: "ana" } });
  await waitFor(() => expect(screen.queryByText("Ana Pérez")).not.toBeInTheDocument());
  expect(screen.getByText("Anabel Ríos")).toBeVisible();
});
it("says «Sin coincidencias» and clears the search with one button", async () => {
  await open();
  fireEvent.change(search(), { target: { value: "zzz" } });
  const empty = screen.getByRole("status", { name: "Sin coincidencias" });
  expect(empty).toHaveTextContent("Ningún candidato coincide con «zzz»");
  fireEvent.click(within(empty).getByRole("button", { name: "Limpiar búsqueda" }));
  expect(search()).toHaveValue("");
  expect(screen.queryByRole("status", { name: "Sin coincidencias" })).not.toBeInTheDocument();
  expect(screen.getByText("Luis López")).toBeVisible();
  expect(new URL(window.location.href).searchParams.has("q")).toBe(false);
});
