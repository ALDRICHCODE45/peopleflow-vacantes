import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OrgCandidateDetailSheet } from "./detail-sheet";
import { loadOrgCandidateDetailAction } from "./detail-actions";
import { loadOrgCandidateHistoryAction } from "../history/history-actions";
import { detailFixture, id } from "./test-fixtures";
vi.mock("./detail-actions", () => ({ loadOrgCandidateDetailAction: vi.fn() }));
vi.mock("../history/history-actions", () => ({ loadOrgCandidateHistoryAction: vi.fn() }));
vi.mock("../edit/edit-actions", () => ({ saveOrgCandidateEditAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
vi.mock("@/features/languages/use-language-catalog", () => ({ useLanguageCatalog: () => ({ data: { items: [{ code: "es", name: "Español" }] } }) }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadOrgCandidateDetailAction).mockResolvedValue({ ok: true, data: detailFixture() });
  vi.mocked(loadOrgCandidateHistoryAction).mockResolvedValue({ ok: true, data: { items: [], next_cursor: null } });
});
afterEach(cleanup);
function open() { return render(<OrgCandidateDetailSheet candidate={{ kind: "manual", id: id(1) }} onOpenChange={vi.fn()} />); }
async function processes() { fireEvent.click(await screen.findByRole("tab", { name: "Procesos 1" })); return screen.getByRole("region", { name: "Procesos" }); }
it("places identity, global correction, clock metadata and full-width edit action above underline tabs and a shield footer", async () => {
  vi.mocked(loadOrgCandidateDetailAction).mockResolvedValue({ ok: true, data: detailFixture("organic") });
  open();
  const name = await screen.findByRole("heading", { level: 2, name: "Lucía Ramírez Torres" });
  const header = name.closest('[data-slot="sheet-header"]')!;
  expect(within(header as HTMLElement).getByText("Corregido").querySelector("svg.lucide-check")).not.toBeNull();
  expect(within(header as HTMLElement).getByText(/Primera postulación ·/)).toBeVisible();
  expect(header.querySelector("svg.lucide-clock-3")).not.toBeNull();
  expect(within(header as HTMLElement).getByRole("button", { name: "Editar datos" })).toHaveClass("w-full");
  const tabs = screen.getByRole("tablist");
  expect(tabs).toHaveAttribute("data-variant", "line");
  expect(screen.getByRole("tab", { name: "Resumen" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: "Procesos 1" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "Historial" }).querySelector('[data-slot="badge"]')).toBeNull();
  const footer = screen.getByText("Solo visible para tu equipo de reclutamiento").closest('[data-slot="sheet-footer"]')!;
  expect(footer.querySelector("svg.lucide-shield-check")).not.toBeNull();
  expect(document.querySelector('[data-slot="sheet-content"]')).toHaveClass("max-sm:[--sheet-inset:0px]");
});
it("renders Resumen contact arrows, six professional facts, skills and corrections note", async () => {
  const data = detailFixture("organic"); data.linkedin_url = "https://linkedin.com/in/lucia"; data.portfolio_url = "https://example.com";
  vi.mocked(loadOrgCandidateDetailAction).mockResolvedValue({ ok: true, data }); open();
  const contact = await screen.findByRole("region", { name: "Contacto" });
  for (const link of within(contact).getAllByRole("link")) expect(link.querySelector("svg.lucide-arrow-up-right")).not.toBeNull();
  const profile = screen.getByRole("region", { name: "Perfil profesional" });
  expect(Array.from(profile.querySelectorAll("dt")).map(item => item.textContent)).toEqual(["Ubicación", "Experiencia", "Seniority", "Estudios", "Idiomas", "Enlaces"]);
  expect(within(profile).getByText("React")).toHaveAttribute("data-slot", "badge");
  expect(within(profile).getByText("El perfil incluye correcciones internas de tu empresa.")).toBeVisible();
  expect(within(profile).getByRole("link", { name: "LinkedIn" })).toHaveAttribute("href", data.linkedin_url);
});
it("previews only active, unfinished processes and Ver todos opens all opportunities", async () => {
  const data = detailFixture(); const item = data.participations[0];
  data.participations.push({ ...item, id: id(8), vacancy: { ...item.vacancy, title: "Finalizado", lifecycle: { publication: "closed", process: "finished" } } });
  vi.mocked(loadOrgCandidateDetailAction).mockResolvedValue({ ok: true, data }); open();
  const preview = await screen.findByRole("region", { name: "Procesos activos" });
  expect(within(preview).getByText("Frontend")).toBeVisible();
  expect(within(preview).queryByText("Finalizado")).not.toBeInTheDocument();
  expect(within(preview).getByText("Entrevista")).toHaveAttribute("data-slot", "badge");
  fireEvent.click(within(preview).getByRole("button", { name: "Ver todos" }));
  expect(screen.getByRole("tab", { name: "Procesos 2" })).toHaveAttribute("aria-selected", "true");
  const all = screen.getByRole("region", { name: "Procesos" });
  expect(within(all).getByRole("heading", { name: "Todas sus oportunidades" })).toBeVisible();
  expect(within(all).getByRole("link", { name: "Finalizado" })).toBeVisible();
  expect(all.querySelector('[data-slot="card"]')).toBeNull();
});
it.each(["corrected", "original", "missing"] as const)("renders the %s CV composition in Procesos", async mode => {
  const data = detailFixture();
  if (mode === "corrected") { data.participations[0].original_cv = data.participations[0].cv; data.participations[0].cv = { ...data.participations[0].cv!, source: "company" }; }
  if (mode === "missing") data.participations[0].cv = null;
  vi.mocked(loadOrgCandidateDetailAction).mockResolvedValue({ ok: true, data }); open();
  const section = await processes();
  expect(within(section).getByText("PDF o DOCX · Máximo 5 MB")).toBeVisible();
  if (mode === "missing") expect(within(section).getByText("Sin CV en este proceso").closest('[data-slot="item"]')).toHaveAttribute("data-variant", "muted");
  else {
    const download = within(section).getByRole("link", { name: "Descargar CV de Frontend" });
    const document = download.closest('[data-slot="item"]')!;
    expect(document).toHaveAttribute("data-variant", "muted");
    expect(document.querySelector('[data-slot="item-footer"]')).toContainElement(download);
    expect(document.querySelector('[data-slot="item-media"]')).toHaveTextContent("PDF");
    expect(within(section).getByRole("link", { name: "Descargar archivo CV de Frontend" })).toHaveAttribute("download");
  }
  expect(within(section).queryByRole("link", { name: "Descargar CV original de Frontend" }) !== null).toBe(mode === "corrected");
});
it("keeps the isolated upload left-aligned with its helper and reserved status below", async () => {
  open(); const section = await processes();
  const upload = within(section).getByRole("button", { name: "Subir CV corregido" });
  expect(upload).toHaveClass("self-start");
  expect(upload.closest("[data-pf-action-bar]")).toBeNull();
  expect(section.querySelector("[data-pf-action-status-slot]")).toContainElement(within(section).getByText("PDF o DOCX · Máximo 5 MB"));
});
it("keeps a canceled CV selection and the same input mounted across tab navigation", async () => {
  open(); await processes();
  const input = screen.getByLabelText("CV corregido para Frontend");
  fireEvent.change(input, { target: { files: [new File(["%PDF"], "seleccionado.pdf", { type: "application/pdf" })] } });
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancelar" }));
  fireEvent.click(screen.getByRole("tab", { name: "Resumen" }));
  await processes();
  expect(screen.getByLabelText("CV corregido para Frontend")).toBe(input);
  fireEvent.click(screen.getByRole("button", { name: "Subir CV corregido" }));
  expect(await screen.findByRole("alertdialog")).toHaveTextContent("seleccionado.pdf");
});
it("shows DOCX media without inventing file size or company correction metadata", async () => {
  const data = detailFixture(); data.participations[0].cv!.file_name = "experiencia.docx";
  vi.mocked(loadOrgCandidateDetailAction).mockResolvedValue({ ok: true, data }); open();
  const section = await processes();
  expect(within(section).getByText("DOCX")).toBeVisible();
  expect(within(section).getByText("Documento Word")).toBeVisible();
  expect(within(section).queryByText("CV corregido por tu empresa")).not.toBeInTheDocument();
  expect(within(section).queryByText(/KB/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Resumen" }));
  expect(screen.queryByText("El perfil incluye correcciones internas de tu empresa.")).not.toBeInTheDocument();
});
it("keeps history pages across tabs and never calls the loaded page count a total", async () => {
  const entry = { id: id(9), kind: "cv_corrected" as const, at: "2026-10-22T18:00:00Z", actor: { id: id(6), name: "Tomás Ríos" }, participation_id: id(2), file_name: "cv.pdf" };
  vi.mocked(loadOrgCandidateHistoryAction).mockResolvedValueOnce({ ok: true, data: { items: [entry], next_cursor: "next" } }).mockResolvedValueOnce({ ok: true, data: { items: [{ ...entry, id: id(10), file_name: "anterior.pdf" }], next_cursor: null } });
  open(); fireEvent.click(await screen.findByRole("tab", { name: "Historial" }));
  fireEvent.click(await screen.findByRole("button", { name: "Ver más" }));
  expect(await screen.findByText("CV corregido: anterior.pdf")).toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: "Resumen" }));
  fireEvent.click(screen.getByRole("tab", { name: "Historial" }));
  expect(screen.getByText("CV corregido: anterior.pdf")).toBeVisible();
  expect(loadOrgCandidateHistoryAction).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("tab", { name: "Historial" }).querySelector('[data-slot="badge"]')).toBeNull();
});
it("switches to a check-marker history timeline, retaining the real pagination action", async () => {
  vi.mocked(loadOrgCandidateHistoryAction).mockResolvedValue({ ok: true, data: { items: [{ id: id(9), kind: "cv_corrected", at: "2026-10-22T18:00:00Z", actor: { id: id(6), name: "Tomás Ríos" }, participation_id: id(2), file_name: "cv.pdf" }], next_cursor: "next" } });
  open(); fireEvent.click(await screen.findByRole("tab", { name: "Historial" }));
  const section = screen.getByRole("region", { name: "Historial de cambios" });
  const actor = await within(section).findByText("Tomás Ríos");
  expect(actor.closest('[data-slot="item"]')?.querySelector('[data-slot="item-media"] svg.lucide-check')).not.toBeNull();
  expect(within(section).getByRole("button", { name: "Ver más" }).querySelector("svg.lucide-chevron-down")).not.toBeNull();
});
it("shows one global «Corregido» in the header even when the title and company are corrected", async () => {
  const detail = detailFixture("organic");
  vi.mocked(loadOrgCandidateDetailAction).mockResolvedValue({ ok: true, data: { ...detail, professional_title: "Desarrolladora Frontend", current_company: "Acme", corrected_fields: [...new Set([...detail.corrected_fields, "professional_title", "current_company"])] } as typeof detail });
  open();
  const header = (await screen.findByRole("heading", { level: 2, name: "Lucía Ramírez Torres" })).closest('[data-slot="sheet-header"]') as HTMLElement;
  expect(within(header).getAllByText("Corregido")).toHaveLength(1);
  expect(within(header).getByText("Desarrolladora Frontend · Acme")).toBeInTheDocument();
});
