import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { id, item, board } from "@/features/pipeline-movement/test-fixtures";
import { ComparisonPage } from "./ui";
import * as csv from "./csv";
const mocks = vi.hoisted(() => ({ board: vi.fn(), checklist: vi.fn(), marks: vi.fn(), draft: vi.fn(), company: vi.fn() }));
vi.mock("@/features/employer-company/actions", () => ({ loadCompanyStateAction: mocks.company }));
vi.mock("@/features/pipeline-movement/actions", () => ({ loadBoardAction: mocks.board }));
vi.mock("../actions", () => ({ loadChecklistAction: mocks.checklist, loadChecklistMarksAction: mocks.marks }));
vi.mock("@/features/jobs/drafts/reopen/load", () => ({ loadDraftForEditAction: mocks.draft }));
vi.mock("@/components/company-dashboard/site-header", () => ({ SiteHeader: () => <header>Comparar</header> }));
const ids = `${item.id},${id(15)}`;
const criteria = [{ id: id(30), label: "SQL", importance: "required", kind: "skill", params: { name: "SQL" } }];
beforeEach(() => {
 mocks.company.mockResolvedValue({ kind: "exists", company: { name: "Empresa Ejemplo" } });
 mocks.board.mockResolvedValue({ ok: true, data: { ...board, participations: [item, { ...item, id: id(15), candidate: { ...item.candidate, full_name: "Bea" } }] } });
 mocks.checklist.mockResolvedValue({ ok: true, data: { version: "1", criteria, reminder_stage_ids: [] } });
 mocks.marks.mockResolvedValue({ ok: true, data: { items: [] } });
 mocks.draft.mockResolvedValue({ ok: true, seed: { model: { fields: { title: "Desarrollador" } } } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });
describe("comparison page", () => {
 it("renders the named criteria matrix, stage, fit and print action", async () => {
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  const { container } = render(<ComparisonPage jobId={id(90)} ids={ids} />);
  await screen.findByRole("table", { name: /Comparación/ });
  expect(screen.getByText("Bea")).toBeTruthy();
  expect(screen.getByText("Obligatorios")).toBeTruthy();
  expect(screen.getAllByText(/Obligatorios 0\/1/).length).toBeGreaterThan(0);
  expect(container.querySelector('[data-slot="scroll-area"]')).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Imprimir / Guardar PDF" }));
  expect(print).toHaveBeenCalledOnce();
  print.mockRestore();
 });
 it("exports the same comparison and renders recruiter notes without contact fields", async () => {
  const download = vi.spyOn(csv, "downloadComparisonCsv").mockImplementation(() => {});
  mocks.marks.mockResolvedValue({ ok: true, data: { items: [{ participation_id: item.id, criterion_id: id(30), verdict: "met", note: "Validado en entrevista", marked_by: { id: id(99), full_name: "Reclutador" }, marked_at: "2026-10-28T12:00:00Z" }] } });
  render(<ComparisonPage jobId={id(90)} ids={ids} />);
  expect(await screen.findByText("Validado en entrevista")).toBeTruthy();
  expect(screen.getByText(/Empresa Ejemplo/)).toBeTruthy();
  expect(screen.getByText("Generado con PeopleFlow")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Descargar CSV" }));
  expect(download).toHaveBeenCalledOnce();
  expect(download.mock.calls[0][0].candidates[0].name).toBe("Ana Pérez");
  expect(document.body.textContent).not.toMatch(/email|Teléfono/);
 });
 it("rejects more than five candidates", async () => {
  const participations = Array.from({ length: 6 }, (_, n) => ({ ...item, id: id(100 + n) }));
  mocks.board.mockResolvedValue({ ok: true, data: { ...board, participations } });
  render(<ComparisonPage jobId={id(90)} ids={participations.map(p => p.id).join(",")} />);
  expect(await screen.findByText("Elige entre 2 y 5 candidatos")).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
 });
 it("explains fewer than two valid selections", async () => {
  render(<ComparisonPage jobId={id(90)} ids={item.id} />);
  expect(await screen.findByText("Elige entre 2 y 5 candidatos")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Volver al pipeline" }).getAttribute("href")).toContain("/pipeline");
 });
 it("does not silently omit an unknown or foreign selection", async () => {
  render(<ComparisonPage jobId={id(90)} ids={`${ids},${id(99)}`} />);
  expect(await screen.findByText("No encontramos todos los candidatos")).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
 });
 it("links an empty checklist to configuration", async () => {
  mocks.checklist.mockResolvedValue({ ok: true, data: { version: "0", criteria: [], reminder_stage_ids: [] } });
  render(<ComparisonPage jobId={id(90)} ids={ids} />);
  expect(await screen.findByRole("link", { name: "Configurar checklist" })).toBeTruthy();
 });
 it("retains a retry after a backend failure", async () => {
  mocks.marks.mockResolvedValue({ ok: false, reason: "server_error" });
  render(<ComparisonPage jobId={id(90)} ids={ids} />);
  expect(await screen.findByText("No pudimos cargar la comparación")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  await screen.findByText("No pudimos cargar la comparación");
  expect(mocks.marks).toHaveBeenCalledTimes(2);
 });
 it("offers sign-in for an expired session", async () => {
  mocks.board.mockResolvedValue({ ok: false, reason: "unauthenticated" });
  render(<ComparisonPage jobId={id(90)} ids={ids} />);
  expect(await screen.findByRole("link", { name: "Iniciar sesión" })).toBeTruthy();
 });
});
