import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ChangeHistory } from "./change-history";
import { loadOrgCandidateHistoryAction } from "./history-actions";
import type { HistoryResult } from "./history-model";
import { cv, edit, id, identity, location, page, study } from "./test-fixtures";
vi.mock("./history-actions", () => ({ loadOrgCandidateHistoryAction: vi.fn() }));
vi.mock("@/features/languages/use-language-catalog", () => ({ useLanguageCatalog: () => ({ data: { items: [{ code: "eng", name: "Inglés" }, { code: "fra", name: "Francés" }] } }) }));
beforeEach(() => { vi.resetAllMocks(); vi.mocked(loadOrgCandidateHistoryAction).mockResolvedValue({ ok: true, data: page }); });
afterEach(cleanup);
const open = () => render(<ChangeHistory candidate={identity} refreshKey={0} />);
it("uses the sheet's section and Item composition, actor attribution, short and relative dates, reset and corrected CV lines", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-24T18:00:00Z"));
  open();
  const actor = await screen.findByText("Tomás Ríos");
  expect(screen.getByRole("region", { name: "Historial de cambios" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Historial de cambios" })).toHaveClass("uppercase", "text-muted-foreground");
  expect(actor.closest('[data-slot="item-title"]')?.closest('[data-slot="item-content"]')?.closest('[data-slot="item"]')?.closest('[data-slot="item-group"]')).not.toBeNull();
  expect(screen.getByText("Usuario dado de baja")).toBeVisible();
  expect(screen.getByText(/22 oct 2026/)).toBeVisible(); expect(screen.getByText(/hace 2 días/)).toBeVisible();
  expect(document.querySelector(`time[datetime="${edit.at}"]`)).not.toBeNull();
  expect(screen.getByText("Años de experiencia: 2 años → 4 años")).toBeVisible();
  expect(screen.getByText("Seniority: se restauró el original (Junior)")).toBeVisible();
  expect(screen.getByText("CV corregido: cv-corregido.pdf")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Ver más" })).not.toBeInTheDocument();
  now.mockRestore();
});
it("never renders contact values, even if a caller violates the action's type contract", async () => {
  const changes = ["full_name", "email", "phone"].map(field => ({ field, contact: true, from: "SECRETO_ANTES", to: "SECRETO_DESPUES" }));
  vi.mocked(loadOrgCandidateHistoryAction).mockResolvedValue({ ok: true, data: { ...page, items: [{ ...edit, changes }] } } as HistoryResult);
  const { container } = open();
  for (const label of ["Nombre modificado", "Correo modificado", "Teléfono modificado"]) expect(await screen.findByText(label)).toBeVisible();
  expect(container.innerHTML).not.toMatch(/SECRETO/);
});
it.each([
  [{ field: "professional_title", from: null, to: "Desarrolladora" }, "Título profesional: Sin dato → Desarrolladora"],
  [{ field: "current_company", from: "Empresa A", to: "Empresa B" }, "Empresa actual: Empresa A → Empresa B"],
  [{ field: "years_of_experience", from: "1", to: "4.5" }, "Años de experiencia: 1 año → 4.5 años"],
  [{ field: "seniority", from: "intern", to: "semi_senior" }, "Seniority: Practicante → Semi-senior"],
  [{ field: "education", from: [], to: [study, { ...study, level: "master", status: "in_progress" }] }, "Estudios: Sin dato → Licenciatura o Ingeniería (concluido), Maestría (en curso)"],
  [{ field: "education", from: null, to: [{ ...study, level: "technical", status: "paused" }, { ...study, level: "high_school", status: "incomplete" }] }, "Estudios: Sin dato → Carrera técnica (en pausa), Bachillerato o Preparatoria (trunco)"],
  [{ field: "languages", from: [], to: [{ code: "eng", level: "C1" }, { code: "fra", level: "B1" }] }, "Idiomas: Sin dato → Inglés C1, Francés B1"],
  [{ field: "languages", from: null, to: [{ code: "unknown", level: "native" }] }, "Idiomas: Sin dato → Idioma no disponible Nativo"],
  [{ field: "location", from: null, to: location }, "Ubicación: Sin dato → Zapopan, Jalisco, México"],
  [{ field: "skills", from: [], to: ["React", "TypeScript"] }, "Habilidades: Sin dato → React, TypeScript"],
  [{ field: "linkedin_url", from: null, to: "https://linkedin.com/in/example" }, "LinkedIn: Sin dato → https://linkedin.com/in/example"],
  [{ field: "portfolio_url", from: "https://example.com", to: null }, "Portafolio: https://example.com → Sin dato"],
  [{ field: "skills", reset: true, from: ["React"], to: null }, "Habilidades: se restauró el original (Sin dato)"],
])("formats field-aware values: %j", async (change, expected) => {
  vi.mocked(loadOrgCandidateHistoryAction).mockResolvedValue({ ok: true, data: { items: [{ ...edit, changes: [change] }], next_cursor: null } } as HistoryResult);
  open(); expect(await screen.findByText(expected)).toBeVisible();
});
it("wraps long change lines as full text, not HTML or links", async () => {
  const long = "<script>texto</script>".repeat(5);
  vi.mocked(loadOrgCandidateHistoryAction).mockResolvedValue({ ok: true, data: { items: [{ ...edit, changes: [{ field: "current_company", from: null, to: long }] }], next_cursor: null } });
  const { container } = open();
  expect(await screen.findByText(`Empresa actual: Sin dato → ${long}`)).toHaveClass("break-words");
  expect(container.querySelector("script")).toBeNull(); expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
it("uses matching Item slots for the loading skeleton and the loaded entry", async () => {
  let resolve!: (result: HistoryResult) => void;
  vi.mocked(loadOrgCandidateHistoryAction).mockReturnValue(new Promise(yes => { resolve = yes; }));
  const { container } = open();
  expect(screen.getByRole("status")).toHaveTextContent("Cargando historial");
  expect(screen.getByRole("region")).toHaveAttribute("aria-busy", "true");
  const slots = (element: Element) => Array.from(element.querySelectorAll("[data-slot]")).map(item => item.getAttribute("data-slot")).filter(slot => slot !== "skeleton");
  const skeletonSlots = slots(container.querySelector('[data-slot="item"]')!);
  await act(async () => resolve({ ok: true, data: { items: [cv], next_cursor: null } }));
  expect(slots(container.querySelector('[data-slot="item"]')!)).toEqual(skeletonSlots);
  expect(screen.getByRole("region")).toHaveAttribute("aria-busy", "false");
});
it("appends pages and keeps entries while Ver más shows the Spinner", async () => {
  let resolve!: (result: HistoryResult) => void;
  vi.mocked(loadOrgCandidateHistoryAction).mockResolvedValueOnce({ ok: true, data: { items: [edit], next_cursor: "next" } }).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  open(); fireEvent.click(await screen.findByRole("button", { name: "Ver más" }));
  const more = screen.getByRole("button", { name: /Ver más/ }); expect(more).toBeDisabled(); expect(more).toHaveAttribute("aria-busy", "true");
  expect(more.querySelector("svg")).toHaveAttribute("data-slot", "spinner"); expect(screen.getByText("Tomás Ríos")).toBeVisible();
  expect(loadOrgCandidateHistoryAction).toHaveBeenLastCalledWith(identity, "next");
  await act(async () => resolve({ ok: true, data: { items: [cv], next_cursor: null } }));
  expect(screen.getByText("Tomás Ríos")).toBeVisible(); expect(screen.getByText("CV corregido: cv-corregido.pdf")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Ver más" })).not.toBeInTheDocument();
});
it("retries the failed cursor without discarding the first page", async () => {
  vi.mocked(loadOrgCandidateHistoryAction).mockResolvedValueOnce({ ok: true, data: { items: [edit], next_cursor: "next" } })
    .mockResolvedValueOnce({ ok: false, reason: "server_error", reference: {} }).mockResolvedValueOnce({ ok: true, data: { items: [cv], next_cursor: null } });
  open(); fireEvent.click(await screen.findByRole("button", { name: "Ver más" }));
  fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
  expect(await screen.findByText("CV corregido: cv-corregido.pdf")).toBeVisible(); expect(screen.getByText("Tomás Ríos")).toBeVisible();
  expect(loadOrgCandidateHistoryAction).toHaveBeenLastCalledWith(identity, "next");
});
it("refreshKey replaces all pages from the first cursor and ignores an older pending append", async () => {
  let resolve!: (result: HistoryResult) => void;
  vi.mocked(loadOrgCandidateHistoryAction).mockResolvedValueOnce({ ok: true, data: { items: [edit], next_cursor: "next" } })
    .mockReturnValueOnce(new Promise(yes => { resolve = yes; })).mockResolvedValueOnce({ ok: true, data: { items: [{ ...cv, file_name: "nuevo.pdf" }], next_cursor: null } });
  const view = open(); fireEvent.click(await screen.findByRole("button", { name: "Ver más" }));
  view.rerender(<ChangeHistory candidate={{ ...identity }} refreshKey={1} />);
  expect(await screen.findByText("CV corregido: nuevo.pdf")).toBeVisible();
  expect(loadOrgCandidateHistoryAction).toHaveBeenLastCalledWith(identity, undefined);
  await act(async () => resolve({ ok: true, data: { items: [cv], next_cursor: null } }));
  expect(screen.queryByText("CV corregido: cv-corregido.pdf")).not.toBeInTheDocument(); expect(screen.queryByText("Tomás Ríos")).not.toBeInTheDocument();
  view.rerender(<ChangeHistory candidate={{ ...identity }} refreshKey={1} />);
  await waitFor(() => expect(loadOrgCandidateHistoryAction).toHaveBeenCalledTimes(3));
});
it("does not leak entries or late responses across candidate changes", async () => {
  let resolve!: (result: HistoryResult) => void;
  vi.mocked(loadOrgCandidateHistoryAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; })).mockResolvedValueOnce({ ok: true, data: { items: [], next_cursor: null } });
  const view = open(); view.rerender(<ChangeHistory candidate={{ kind: "organic", id: id(10) }} refreshKey={0} />);
  expect(await screen.findByText("Sin cambios todavía")).toBeVisible();
  await act(async () => resolve({ ok: true, data: page }));
  expect(screen.queryByText("Tomás Ríos")).not.toBeInTheDocument();
});
it("shows the empty state", async () => {
  vi.mocked(loadOrgCandidateHistoryAction).mockResolvedValue({ ok: true, data: { items: [], next_cursor: null } }); open();
  expect(await screen.findByText("Sin cambios todavía")).toBeVisible(); expect(screen.queryByRole("button", { name: "Ver más" })).not.toBeInTheDocument();
});
it.each(["not_found", "unauthenticated", "forbidden", "server_error", "no_response", "unrecognized_response"] as const)("shows a safe %s error and retries the first page", async reason => {
  vi.mocked(loadOrgCandidateHistoryAction).mockResolvedValueOnce({ ok: false, reason, reference: {} }); open();
  expect(await screen.findByText("No pudimos cargar el historial")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  expect(await screen.findByText("Tomás Ríos")).toBeVisible(); expect(loadOrgCandidateHistoryAction).toHaveBeenLastCalledWith(identity, undefined);
});
it("handles an action rejection as a safe read failure", async () => {
  vi.mocked(loadOrgCandidateHistoryAction).mockRejectedValueOnce(new Error("private")); open();
  expect(await screen.findByText("No pudimos cargar el historial")).toBeVisible(); expect(document.body.innerHTML).not.toContain("private");
});
