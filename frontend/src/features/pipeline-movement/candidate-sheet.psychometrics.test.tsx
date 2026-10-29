import { StrictMode, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CandidateSheet } from "./candidate-sheet";
import { boardFixture, detailFixture, historyFixture, vacancyId } from "./board-fixture";
import { InvitationsProvider } from "@/features/psychometrics/sheet/state";
import * as actions from "@/features/psychometrics/actions";
import { loadHistoryAction, loadParticipationAction } from "./actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { invitation, profile, result, comparison, id } from "@/features/psychometrics/fixtures.test";
import { comparisonSchema, invitationSchema, profileSchema, resultSchema } from "@/features/psychometrics/model";
vi.mock("./actions", () => ({ loadHistoryAction: vi.fn(), loadParticipationAction: vi.fn() }));
vi.mock("@/features/psychometrics/actions", () => ({ loadInvitationsAction: vi.fn(), loadProfileAction: vi.fn(), loadResultAction: vi.fn(), createComparisonAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
vi.mock("@/features/languages/use-language-catalog", () => ({ useLanguageCatalog: () => ({}) }));
const stored = () => resultSchema.parse(result);
function Harness() {
  const [open, setOpen] = useState(true);
  const board = boardFixture();
  return <InvitationsProvider vacancyId={vacancyId}><button onClick={() => setOpen(true)}>Abrir ficha</button>{open && <CandidateSheet vacancyId={vacancyId} item={board.participations[0]} board={board} onClose={() => setOpen(false)} />}</InvitationsProvider>;
}
async function openTab() { const tab = await screen.findByRole("tab", { name: "Psicometría" }); await act(async () => fireEvent.click(tab)); }
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: detailFixture() });
  vi.mocked(loadHistoryAction).mockResolvedValue({ ok: true, data: historyFixture() });
  vi.mocked(actions.loadInvitationsAction).mockResolvedValue({ ok: true, data: { items: [{ ...invitationSchema.parse({ ...invitation, status: "finished", finished_at: result.finished_at }), participation_id: boardFixture().participations[0].id }] } });
  vi.mocked(actions.loadProfileAction).mockResolvedValue({ ok: true, data: profileSchema.parse(profile) });
  vi.mocked(actions.loadResultAction).mockResolvedValue({ ok: true, data: stored() });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(cleanup);
it("loads invitations once per board and never audits on mount/hover/focus, including StrictMode", async () => {
  render(<StrictMode><Harness /></StrictMode>);
  const tab = await screen.findByRole("tab", { name: "Psicometría" });
  await act(async () => { fireEvent.mouseOver(tab); fireEvent.focus(tab); });
  expect(actions.loadResultAction).not.toHaveBeenCalled();
  expect(actions.loadProfileAction).not.toHaveBeenCalled();
  expect(actions.loadInvitationsAction).toHaveBeenCalledTimes(1);
  await act(async () => fireEvent.click(tab));
  expect(await screen.findByText("Cuestionario de personalidad laboral")).toBeVisible();
  expect(actions.loadResultAction).toHaveBeenCalledExactlyOnceWith({ vacancyId, invitationId: id });
});
// Separate lifetimes keep each assertion tied to one observable transition,
// rather than putting StrictMode + three full result renders in one timed test.
it("caches the audited result across tab switches within an open sheet", async () => {
  render(<Harness />); await openTab();
  await screen.findByText("Texto almacenado STAR");
  await act(async () => fireEvent.click(screen.getByRole("tab", { name: "Resumen" })));
  expect(screen.getByRole("tab", { name: "Resumen" })).toHaveAttribute("aria-selected", "true");
  await openTab();
  expect(await screen.findByText("Texto almacenado STAR")).toBeVisible();
  expect(actions.loadResultAction).toHaveBeenCalledTimes(1);
  expect(actions.loadInvitationsAction).toHaveBeenCalledTimes(1);
});
it("drops the result cache when the sheet closes but keeps the board invitation read", async () => {
  render(<Harness />); await openTab();
  await screen.findByText("Texto almacenado STAR");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cerrar ficha" })));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Abrir ficha" })));
  await openTab();
  expect(await screen.findByText("Texto almacenado STAR")).toBeVisible();
  expect(actions.loadResultAction).toHaveBeenCalledTimes(2);
  expect(actions.loadInvitationsAction).toHaveBeenCalledTimes(1);
});
it("omits tab without an invitation, keeps other tabs working", async () => {
  vi.mocked(actions.loadInvitationsAction).mockResolvedValue({ ok: true, data: { items: [] } });
  render(<Harness />);
  await screen.findByRole("region", { name: "Perfil" });
  expect(screen.queryByRole("tab", { name: "Psicometría" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: /Respuestas/ }));
  expect(await screen.findByText("¿Disponibilidad?")).toBeVisible();
  expect(actions.loadResultAction).not.toHaveBeenCalled();
});
it("invitation failures do not block the sheet and offer quiet explicit retry", async () => {
  vi.mocked(actions.loadInvitationsAction).mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} });
  render(<Harness />);
  fireEvent.click(await screen.findByRole("button", { name: "Actualizar psicometría" }));
  await screen.findByRole("tab", { name: "Psicometría" });
  expect(actions.loadInvitationsAction).toHaveBeenCalledTimes(2);
  expect(notifyActionResult).not.toHaveBeenCalled();
  expect(actions.loadResultAction).not.toHaveBeenCalled();
});
it.each(["created", "in_progress", "expired", "revoked"] as const)("%s is just state and progress, never a result read or management UI", async status => {
  vi.mocked(actions.loadInvitationsAction).mockResolvedValue({ ok: true, data: { items: [{ ...invitationSchema.parse({ ...invitation, status, answered_count: 12 }), participation_id: boardFixture().participations[0].id }] } });
  render(<Harness />); await openTab();
  expect(screen.getByText(/12 de 63 respuestas/)).toHaveClass("text-muted-foreground");
  expect(actions.loadResultAction).not.toHaveBeenCalled();
  expect(actions.loadProfileAction).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /Enviar|Recordar|Revocar|Copiar enlace/ })).not.toBeInTheDocument();
});
it("shows result skeleton during the real wait and a persistent failure with explicit retry", async () => {
  let resolve!: (v: Awaited<ReturnType<typeof actions.loadResultAction>>) => void;
  vi.mocked(actions.loadResultAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  render(<Harness />); await openTab();
  expect(screen.getByRole("status")).toHaveTextContent("Cargando resultado psicométrico");
  expect(document.querySelector('[data-pf-result-skeleton] [data-slot="skeleton"]')).not.toBeNull();
  await act(async () => resolve({ ok: false, reason: "server_error", reference: { status: 500 } }));
  expect(await screen.findByText("No pudimos cargar el resultado")).toBeVisible();
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", reference: expect.objectContaining({ status: 500 }) }));
  fireEvent.click(screen.getByRole("button", { name: "Reintentar resultado" }));
  await screen.findByText("Texto almacenado STAR");
  expect(actions.loadResultAction).toHaveBeenCalledTimes(2);
});
it("renders only stored guide and interpretations, copies plain text after success, and discloses exactly 15 facet bands", async () => {
  const data = stored(); data.latest_comparison.guide[0].text = "Pregunta guardada\nSTAR guardado";
  data.latest_comparison.guide[0].good_answer_checklist = "Evidencia guardada";
  data.interpretations[0].work_text = "Interpretación guardada";
  vi.mocked(actions.loadResultAction).mockResolvedValue({ ok: true, data });
  render(<Harness />); await openTab();
  expect(await screen.findByText(/Pregunta guardada/)).toHaveTextContent("STAR guardado");
  expect(screen.getByText(/Por qué se sugiere:/)).toHaveTextContent("Medio");
  expect(screen.getByText("Interpretación guardada")).toBeVisible();
  expect(screen.getAllByText("sin perfil confirmado")).toHaveLength(7);
  expect(screen.getByRole("button", { name: /Ver detalle por rasgo/ })).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(screen.getByRole("button", { name: "Copiar guía" }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("Pregunta guardada\nSTAR guardado")));
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Guía copiada" }));
  fireEvent.click(screen.getByRole("button", { name: /Ver detalle por rasgo/ }));
  const facets = await screen.findByRole("region", { name: "Bandas por rasgo" });
  expect(facets.querySelectorAll("dt")).toHaveLength(15);
  expect(facets).not.toHaveTextContent(/10|sum|%/);
  expect(screen.getByText("Cuestionario de personalidad laboral")).not.toHaveAttribute("tabindex");
  expect(document.body).not.toHaveTextContent(/apto|%/i);
});
it.each([
  ["unauthenticated", "Tu sesión expiró"], ["forbidden", "No tienes permiso para esta acción"],
  ["server_error", "El servidor tuvo un problema"], ["no_response", "No hubo respuesta del servidor"],
] as const)("result %s communicates its cause without exposing server text or repeating the audited read", async (reason, title) => {
  vi.mocked(actions.loadResultAction).mockResolvedValue({ ok: false, reason, reference: { status: reason === "server_error" ? 500 : undefined } });
  render(<Harness />); await openTab();
  await screen.findByText("No pudimos cargar el resultado");
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error", title }));
  expect(actions.loadResultAction).toHaveBeenCalledTimes(1);
});
it("copy rejection shows no success and keeps guide available", async () => {
  vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error("denied"));
  render(<Harness />); await openTab(); await screen.findByText("Texto almacenado STAR");
  fireEvent.click(screen.getByRole("button", { name: "Copiar guía" }));
  expect(await screen.findByText("No se copió · selecciona las preguntas")).toBeVisible();
  expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
  expect(notifyActionResult).not.toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
});
it("quality uses exact plain wording, partial disclosure and triggered counts, never unavailable zeroes", async () => {
  const data = stored();
  data.quality = { tier: "tier.relevantes", partial: true, signals: [{ id: "signal.attention", severity: "mild", counts: { misses: 1, total: 3 } }, { id: "signal.long_string", severity: "strong", counts: { run: 12 } }, { id: "signal.fast", severity: "unknown", counts: null }, { id: "signal.changes", severity: "mild", counts: { value_changes: 10, clears: 10, reanswers: 10, total: 30 } }] };
  vi.mocked(actions.loadResultAction).mockResolvedValue({ ok: true, data });
  render(<Harness />); await openTab();
  expect(await screen.findByText("Señales relevantes")).toHaveAttribute("data-variant", "info");
  expect(document.querySelector('[data-pf-psychometric-result] [data-variant="review"]')).toBeNull();
  expect(screen.getByText("Información parcial: no se registraron todos los tiempos o cambios de respuesta.")).toBeVisible();
  expect(screen.getByText(/No coincidieron 1 de 3/)).toBeVisible();
  expect(screen.getByText(/Se repitió la misma opción en 12 frases/)).toBeVisible();
  expect(screen.getByText(/10 cambios de opción, 10 borrados y 10 respuestas después de borrar: 30/)).toBeVisible();
  expect(screen.queryByText(/Se registraron menos de 2 segundos/)).not.toBeInTheDocument();
});
it("focus links target the matching ordered question and accent badges differ by icon; matrix shows outline desired and fill obtained", async () => {
  const data = stored();
  const c = data.latest_comparison;
  c.profile_version = "1";
  c.competencies[0] = { ...c.competencies[0], desired_band: "band.high", importance: "importance.clave", fit: "fit.atencion", direction: "below", band: "band.low" };
  c.competencies[1] = { ...c.competencies[1], desired_band: "band.high", importance: "importance.importante", fit: "fit.explorar", direction: "below" };
  c.focus_areas = [{ type: "focus.distant", competency_id: "comp.organizacion", observed_band: "band.low", desired_band: "band.high", importance: "importance.clave", fit: "fit.atencion", profile_version: "1" }];
  c.guide[0] = { ...c.guide[0], selector: "distant", originating_focus_type: "focus.distant", fit: "fit.atencion" };
  vi.mocked(actions.loadResultAction).mockResolvedValue({ ok: true, data });
  render(<Harness />); await openTab(); await screen.findByText("Texto almacenado STAR");
  const link = screen.getByRole("link", { name: /Orden para avanzar · Pregunta 1/ });
  expect(document.getElementById(link.getAttribute("href")!.slice(1))).toHaveTextContent("Texto almacenado STAR");
  const focus = screen.getByText("Foco de atención").closest('[data-slot="badge"]')!;
  const explore = screen.getByText("Por explorar").closest('[data-slot="badge"]')!;
  expect(focus).toHaveAttribute("data-variant", "accent");
  expect(explore).toHaveAttribute("data-variant", "accent");
  expect(focus.querySelector("svg")).not.toBeNull(); expect(explore.querySelector("svg")).not.toBeNull();
  expect(focus.querySelector("svg")?.getAttribute("class")).not.toEqual(explore.querySelector("svg")?.getAttribute("class"));
  const matrix = screen.getByRole("region", { name: "Bandas · Orden para avanzar" });
  expect(within(matrix).getByText("Alto")).toHaveAttribute("data-desired", "true");
  expect(within(matrix).getByText("Bajo")).toHaveAttribute("data-obtained", "true");
});
it("compares explicitly with current confirmed profile, replaces guide/fit, preserves original bands and history without another audited GET", async () => {
  vi.mocked(actions.loadProfileAction).mockResolvedValue({ ok: true, data: profileSchema.parse({ ...profile, version: "2", confirmed: true, confirmed_at: result.finished_at }) });
  const next = comparisonSchema.parse({ ...comparison, id: "10000000-0000-4000-8000-000000000002", profile_version: "2", guide: [{ ...comparison.guide[0], text: "Nueva guía almacenada" }] });
  vi.mocked(actions.createComparisonAction).mockResolvedValue({ ok: true, data: next });
  render(<Harness />); await openTab();
  fireEvent.click(await screen.findByRole("button", { name: "Comparar con el perfil actual" }));
  expect(actions.createComparisonAction).not.toHaveBeenCalled();
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Comparar" }));
  expect(await screen.findByText("Nueva guía almacenada")).toBeVisible();
  expect(screen.queryByText("Texto almacenado STAR")).not.toBeInTheDocument();
  expect(screen.getByText("Perfil sin confirmar · comparación anterior")).toBeVisible();
  expect(screen.getAllByText("Trabajo")).toHaveLength(7);
  expect(actions.createComparisonAction).toHaveBeenCalledExactlyOnceWith({ vacancyId, invitationId: id });
  expect(actions.loadResultAction).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Comparar con el perfil actual" })).not.toBeInTheDocument();
});
it("uncertain comparison never automatically replays or audits again and preserves the shown snapshot", async () => {
  // All requirements remain No relevante: the current contract requires null
  // rationale/task for these entries, even in a confirmed profile.
  vi.mocked(actions.loadProfileAction).mockResolvedValue({ ok: true, data: profileSchema.parse({ ...profile, version: "2", confirmed: true, confirmed_at: result.finished_at }) });
  let resolve!: (value: Awaited<ReturnType<typeof actions.createComparisonAction>>) => void;
  vi.mocked(actions.createComparisonAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  render(<Harness />); await openTab();
  fireEvent.click(await screen.findByRole("button", { name: "Comparar con el perfil actual" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Comparar" }));
  expect(within(dialog).getByRole("button", { name: "Comparando…" })).toBeDisabled();
  expect(actions.createComparisonAction).toHaveBeenCalledExactlyOnceWith({ vacancyId, invitationId: id });
  expect(actions.loadResultAction).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ ok: false, reason: "no_response", reference: {} }));
  expect(await screen.findByText("No se confirmó · conserva la comparación anterior")).toBeVisible();
  expect(screen.getByText("Texto almacenado STAR")).toBeVisible();
  // The status is rendered before Base UI finishes restoring modal accessibility.
  // Wait for the actual sheet action, not an arbitrary animation delay.
  expect(await screen.findByRole("button", { name: "Comparar con el perfil actual" })).toBeDisabled();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(actions.createComparisonAction).toHaveBeenCalledTimes(1);
  expect(actions.loadResultAction).toHaveBeenCalledTimes(1);
});
it("preserves all eight stored questions in returned order, including their STAR and evidence", async () => {
  const data = stored();
  const template = data.latest_comparison.guide[0];
  data.latest_comparison.guide = Array.from({ length: 8 }, (_, i) => ({ ...template, question_id: `q.organizacion.${["low", "medium", "high", "adjacent"][Math.floor(i / 2)]}.${i % 2 + 1}`, text: `Pregunta ${8 - i} guardada\nSTAR ${i}`, good_answer_checklist: `Evidencia ${i}` }));
  vi.mocked(actions.loadResultAction).mockResolvedValue({ ok: true, data });
  render(<Harness />); await openTab();
  const guide = await screen.findByRole("region", { name: "Guía de entrevista" });
  expect(Array.from(guide.querySelectorAll("ol > li > p:first-of-type")).map(p => p.textContent)).toEqual(data.latest_comparison.guide.map(q => q.text));
  expect(within(guide).getByText("8 preguntas del banco redactado. Pide contexto, acciones y resultados.")).toBeVisible();
  fireEvent.click(within(guide).getByRole("button", { name: "Copiar guía" }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1));
  const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0];
  data.latest_comparison.guide.forEach(q => { expect(copied).toContain(q.text); expect(copied).toContain(q.good_answer_checklist); });
});
it("does not offer a new comparison for an unconfirmed current profile", async () => {
  render(<Harness />); await openTab(); await screen.findByText("Texto almacenado STAR");
  expect(screen.queryByRole("button", { name: "Comparar con el perfil actual" })).not.toBeInTheDocument();
  expect(actions.createComparisonAction).not.toHaveBeenCalled();
  expect(screen.getByText("Sin señales")).toHaveAttribute("data-variant", "neutral");
});
it("preserves the shown result when the profile read fails, without guessing whether a newer profile exists", async () => {
  vi.mocked(actions.loadProfileAction).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
  render(<Harness />); await openTab();
  expect(await screen.findByText("Texto almacenado STAR")).toBeVisible();
  expect(screen.getByText("No pudimos consultar el perfil actual. Se conserva la comparación almacenada.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Comparar con el perfil actual" })).not.toBeInTheDocument();
  expect(actions.loadResultAction).toHaveBeenCalledTimes(1);
});
