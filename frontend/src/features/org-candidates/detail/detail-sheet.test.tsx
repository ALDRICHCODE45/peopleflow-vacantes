import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OrgCandidateDetailSheet } from "./detail-sheet";
import { loadOrgCandidateDetailAction } from "./detail-actions";
import { detailFixture, id } from "./test-fixtures";
vi.mock("./detail-actions", () => ({ loadOrgCandidateDetailAction: vi.fn() }));
vi.mock("@/features/languages/use-language-catalog", () => ({ useLanguageCatalog: () => ({ data: { items: [{ code: "es", name: "Español" }] } }) }));
beforeEach(() => { vi.resetAllMocks(); vi.mocked(loadOrgCandidateDetailAction).mockResolvedValue({ ok: true, data: detailFixture() }); });
afterEach(cleanup);
const identity = { kind: "manual" as const, id: id(1) };
const open = () => render(<OrgCandidateDetailSheet candidate={identity} onOpenChange={vi.fn()} />);
it.each(["manual", "organic"] as const)("shows the %s header facts, never mixing origin dates", async kind => {
  vi.mocked(loadOrgCandidateDetailAction).mockResolvedValue({ ok: true, data: detailFixture(kind) });
  render(<OrgCandidateDetailSheet candidate={{ ...identity, kind }} onOpenChange={vi.fn()} />);
  const title = await screen.findByRole("heading", { name: "Lucía Ramírez Torres" });
  expect(title.closest('[data-slot="sheet-header"]')).not.toBeNull();
  expect(screen.getByText(kind === "manual" ? "Manual" : "Orgánico")).toHaveAttribute("data-slot", "badge");
  if (kind === "manual") {
    expect(screen.getByText(/Agregado por Tomás Ríos el/)).toBeVisible();
    expect(screen.getByText("Desarrolladora Frontend · Empresa actual")).toBeVisible();
    expect(screen.queryByText(/Primera postulación/)).not.toBeInTheDocument();
  } else {
    expect(screen.getByText(/Primera postulación el/)).toBeVisible();
    expect(screen.queryByText(/Agregado por Tomás Ríos el/)).not.toBeInTheDocument();
  }
});
it("renders contact links and the board's six profile rows and labels", async () => {
  open();
  const contact = await screen.findByRole("region", { name: "Contacto" });
  expect(within(contact).getByRole("link", { name: "lucia@example.com" })).toHaveAttribute("href", "mailto:lucia@example.com");
  expect(within(contact).getByRole("link", { name: "+52 33 1234 5678" })).toHaveAttribute("href", "tel:+523312345678");
  const profile = screen.getByRole("region", { name: "Perfil" });
  expect(Array.from(profile.querySelectorAll("dt")).map(dt => dt.textContent)).toEqual(["Ubicación", "Habilidades", "Años de experiencia", "Seniority", "Nivel de estudios", "Idiomas"]);
  expect(within(profile).getByText("Licenciatura o Ingeniería · Maestría en curso")).toBeVisible();
  expect(within(profile).getByText("Español Nativo")).toHaveAttribute("data-slot", "badge");
  expect(within(profile).getByText("React")).toHaveAttribute("data-slot", "badge");
  expect(within(profile).getByText("4.5 años")).toBeVisible();
});
it("uses Sin dato and honest attribution for missing facts and no processes", async () => {
  const data = detailFixture(); data.contact = { email: null, phone: null }; data.created_by = { id: id(6), name: null }; data.participations = [];
  vi.mocked(loadOrgCandidateDetailAction).mockResolvedValue({ ok: true, data }); open();
  const contact = await screen.findByRole("region", { name: "Contacto" });
  expect(within(contact).getAllByText("Sin dato")).toHaveLength(2);
  expect(screen.getByText(/Agregado por Cuenta no disponible el/)).toBeVisible();
  expect(screen.getByText("Sin procesos")).toBeVisible();
});
it("orders participations newest first and shows lifecycle, substate, discard, source and CV", async () => {
  const data = detailFixture();
  const current = data.participations[0];
  data.participations = [{ ...current, id: id(7), vacancy: { id: id(8), title: "Backend", lifecycle: { publication: "closed", process: "finished" } }, state: "discarded", substate: null, source: "organic", added_by: null, cv: null, applied_at: "2026-10-20T10:00:00Z", discard: { reason: { group: "candidate", key: "unresponsive" }, comment: "No respondió\nal correo", discarded_at: data.created_at } }, current];
  vi.mocked(loadOrgCandidateDetailAction).mockResolvedValue({ ok: true, data }); open();
  const section = await screen.findByRole("region", { name: "Procesos" });
  expect(within(section).getAllByRole("link").filter(a => a.getAttribute("href")?.endsWith("/pipeline")).map(a => a.textContent)).toEqual(["Frontend", "Backend"]);
  expect(within(section).getByRole("link", { name: "Frontend" })).toHaveAttribute("href", `/empresa/vacantes/${id(3)}/pipeline`);
  ["Entrevista · Esperando respuesta", "Publicada", "Cerrada", "Proceso finalizado", "Descartado · Sin respuesta del candidato", "No respondió al correo", "Ingreso manual", "Postulación", "Agregado por Tomás Ríos", "cv.pdf", "Sin CV"].forEach(text => expect(within(section).getByText(text)).toBeVisible());
  const download = within(section).getByRole("link", { name: /Descargar CV/ });
  expect(download).toHaveAttribute("href", `/api/company/candidates/manual/${id(1)}/participations/${id(2)}/cv`);
  expect(download).toHaveAttribute("download");
});
it("renders paused and never-published lifecycles", async () => {
  const data = detailFixture(); data.participations[0].vacancy.lifecycle = { publication: "paused", process: "active" };
  vi.mocked(loadOrgCandidateDetailAction).mockResolvedValue({ ok: true, data }); const view = open();
  expect(await screen.findByText("Pausada")).toBeVisible(); view.unmount();
  data.participations[0].vacancy.lifecycle = { publication: null, process: null }; open();
  expect(await screen.findByText("Borrador")).toBeVisible();
});
it.each(["not_found", "server_error"] as const)("keeps %s inside the sheet with a retry for other failures", async reason => {
  vi.mocked(loadOrgCandidateDetailAction).mockResolvedValueOnce({ ok: false, reason, reference: {} }); open();
  expect(await screen.findByText(reason === "not_found" ? "Este candidato ya no está disponible" : "No pudimos cargar el detalle")).toBeVisible();
  if (reason !== "not_found") {
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { name: "Lucía Ramírez Torres" })).toBeVisible();
    expect(loadOrgCandidateDetailAction).toHaveBeenCalledTimes(2);
  }
});
it("shows a layout skeleton and ignores late reads after closing", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof loadOrgCandidateDetailAction>>) => void;
  vi.mocked(loadOrgCandidateDetailAction).mockReturnValue(new Promise(yes => { resolve = yes; }));
  const onOpenChange = vi.fn(); const view = render(<OrgCandidateDetailSheet candidate={identity} onOpenChange={onOpenChange} />);
  expect(await screen.findByRole("status")).toHaveTextContent("Cargando detalle");
  expect(document.querySelectorAll('[data-org-detail-skeleton] section')).toHaveLength(3);
  expect(document.querySelector('[data-slot="sheet-overlay"]')).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cerrar ficha" })); expect(onOpenChange).toHaveBeenCalledWith(false);
  view.rerender(<OrgCandidateDetailSheet candidate={null} onOpenChange={onOpenChange} />);
  await act(async () => resolve({ ok: true, data: detailFixture() }));
  expect(screen.queryByRole("heading", { name: "Lucía Ramírez Torres" })).not.toBeInTheDocument();
});
it("focuses the title and restores the opening row action after closing", async () => {
  function Harness() {
    const [candidate, setCandidate] = useState<typeof identity | null>(null);
    return <><button onClick={() => setCandidate(identity)}>Ver ficha</button><OrgCandidateDetailSheet candidate={candidate} onOpenChange={open => { if (!open) setCandidate(null); }} /></>;
  }
  render(<Harness />);
  const opener = screen.getByRole("button", { name: "Ver ficha" }); opener.focus(); fireEvent.click(opener);
  const title = await screen.findByRole("heading", { name: "Lucía Ramírez Torres" });
  await waitFor(() => expect(title).toHaveFocus());
  fireEvent.click(screen.getByRole("button", { name: "Cerrar ficha" }));
  await waitFor(() => expect(opener).toHaveFocus());
});
it("does not request until opened and discards a stale candidate response", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof loadOrgCandidateDetailAction>>) => void;
  const view = render(<OrgCandidateDetailSheet candidate={null} onOpenChange={vi.fn()} />);
  expect(loadOrgCandidateDetailAction).not.toHaveBeenCalled();
  vi.mocked(loadOrgCandidateDetailAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  view.rerender(<OrgCandidateDetailSheet candidate={identity} onOpenChange={vi.fn()} />);
  view.rerender(<OrgCandidateDetailSheet candidate={{ kind: "organic", id: id(10) }} onOpenChange={vi.fn()} />);
  await screen.findByRole("heading", { name: "Lucía Ramírez Torres" });
  await act(async () => resolve({ ok: true, data: { ...detailFixture(), full_name: "Viejo" } }));
  expect(screen.queryByText("Viejo")).not.toBeInTheDocument();
});
