import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CandidateSheet } from "./candidate-sheet";
import { loadHistoryAction, loadParticipationAction } from "./actions";
import { boardFixture, detailFixture, historyFixture, vacancyId } from "./board-fixture";
import type { History, Result } from "./model";
vi.mock("./actions", () => ({ loadHistoryAction: vi.fn(), loadParticipationAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: detailFixture() });
  vi.mocked(loadHistoryAction).mockResolvedValue({ ok: true, data: historyFixture() });
});
afterEach(cleanup);
function SheetHarness() {
  const [open, setOpen] = useState(true);
  const board = boardFixture();
  return open ? <CandidateSheet vacancyId={vacancyId} vacancyTitle="Software Developer" item={board.participations[0]} board={board} onClose={() => setOpen(false)} /> : null;
}
it.each([0, 1, 3, null])("profile shows exact years %s and honest missing data", async years => {
  const detail = detailFixture();
  detail.profile = { city: null, skills: [], years_of_experience: years, education_level: null };
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: detail });
  render(<SheetHarness />);
  const profile = await screen.findByRole("region", { name: "Perfil" });
  expect(within(profile).getByText("Copiado del perfil al postularse.")).toBeVisible();
  expect(within(profile).getAllByText("Sin dato")).toHaveLength(years === null ? 4 : 3);
  within(profile).getAllByText("Sin dato").forEach(value => expect(value).toHaveClass("text-muted-foreground"));
  expect(Array.from(profile.querySelectorAll("dt")).map(dt => dt.textContent)).toEqual(["Ciudad", "Habilidades", "Años de experiencia", "Nivel de estudios"]);
  expect(profile.querySelectorAll("dt svg")).toHaveLength(4);
  if (years !== null) expect(within(profile).getByText(`${years} ${years === 1 ? "año" : "años"}`)).toBeVisible();
});
it("profile uses actual city, skill badges and education label", async () => {
  const detail = detailFixture();
  detail.profile = { city: "Puebla", skills: ["Go", "SQL"], years_of_experience: 5, education_level: "high_school" };
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: detail });
  render(<SheetHarness />);
  const profile = await screen.findByRole("region", { name: "Perfil" });
  expect(within(profile).getByText("Puebla")).toBeVisible();
  expect(within(profile).getByText("Preparatoria")).toBeVisible();
  expect(Array.from(profile.querySelectorAll('[data-slot="badge"]')).map(badge => badge.textContent)).toEqual(["Go", "SQL"]);
});
it("sheet loading is independent, closes with a Spanish button, and ignores the late read", async () => {
  let resolve!: (value: Result<History>) => void;
  vi.mocked(loadHistoryAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  render(<SheetHarness />);
  const sheet = await screen.findByRole("dialog", { name: "Ana Pérez" });
  expect(within(sheet).getByRole("status")).toHaveTextContent("Cargando detalle e historial");
  expect(sheet.querySelector('[data-pf-detail-skeleton="summary"] dl')?.querySelectorAll('dt')).toHaveLength(4);
  expect(sheet.querySelector('[data-pf-detail-skeleton="summary"] [data-slot="item"] [data-slot="item-actions"] [data-slot="skeleton"]')).not.toBeNull();
  fireEvent.click(within(sheet).getByRole("button", { name: "Cerrar ficha" }));
  await act(async () => resolve({ ok: true, data: historyFixture() }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("a rejected detail load offers retry; screening/history display no invented scores", async () => {
  vi.mocked(loadParticipationAction).mockRejectedValueOnce(new Error("offline"));
  render(<SheetHarness />);
  const sheet = await screen.findByRole("dialog", { name: "Ana Pérez" });
  const retry = await within(sheet).findByRole("button", { name: "Reintentar" });
  expect(retry.closest('[data-slot="empty-content"]')).not.toBeNull();
  expect(within(sheet).getByText("No pudimos cargar el detalle")).toHaveClass("text-xl", "font-semibold");
  expect(retry).toHaveClass("w-full", "sm:w-auto");
  fireEvent.click(retry);
  await within(sheet).findByRole("tab", { name: "Respuestas 2" });
  fireEvent.click(within(sheet).getByRole("tab", { name: "Respuestas 2" }));
  expect(await within(sheet).findByText("¿Disponibilidad?")).toBeVisible();
  expect(sheet).not.toHaveTextContent(/Compatibilidad|Puntuación|Correcta|Experiencia/);
  expect(loadParticipationAction).toHaveBeenCalledTimes(2);
});
