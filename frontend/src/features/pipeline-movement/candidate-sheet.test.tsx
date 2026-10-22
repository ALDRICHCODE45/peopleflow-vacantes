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
vi.mock("@/features/languages/use-language-catalog", () => ({ useLanguageCatalog: () => ({ status: "success", data: { items: [{ code: "en", name: "Inglés" }, { code: "es", name: "Español" }] } }) }));
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
it.each(["0", "1", "2.5", null])("profile shows exact years %s and honest missing data", async years => {
  const detail = detailFixture();
  detail.profile = { location: null, skills: [], years_of_experience: years, seniority: null, education: { highest_completed: null, in_progress: null }, languages: [] };
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: detail });
  render(<SheetHarness />);
  const profile = await screen.findByRole("region", { name: "Perfil" });
  expect(within(profile).getByText("Copiado del perfil al postularse.")).toBeVisible();
  expect(within(profile).getAllByText("Sin dato")).toHaveLength(years === null ? 6 : 5);
  within(profile).getAllByText("Sin dato").forEach(value => expect(value).toHaveClass("text-muted-foreground"));
  expect(Array.from(profile.querySelectorAll("dt")).map(dt => dt.textContent)).toEqual(["Ubicación", "Habilidades", "Años de experiencia", "Seniority", "Nivel de estudios", "Idiomas"]);
  expect(profile.querySelectorAll("dt svg")).toHaveLength(6);
  if (years !== null) expect(within(profile).getByText(`${years} ${Number(years) === 1 ? "año" : "años"}`)).toBeVisible();
});
it("profile uses actual location, skill badges and education label", async () => {
  const detail = detailFixture();
  detail.profile = { location: { country: { id: "MX", name: "México" }, state: { id: "21", name: "Puebla" }, municipality: null, postal_code: null, label: "Puebla" }, skills: ["Go", "SQL"], years_of_experience: "5", seniority: "junior", education: { highest_completed: "bachelor", in_progress: "master" }, languages: [{ code: "en", level: "B2" }, { code: "es", level: "native" }] };
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: detail });
  render(<SheetHarness />);
  const profile = await screen.findByRole("region", { name: "Perfil" });
  expect(within(profile).getByText("Puebla")).toBeVisible();
  expect(within(profile).getByText("Licenciatura o Ingeniería · Maestría en curso")).toBeVisible();
  expect(within(profile).getByText("Junior")).toBeVisible();
  // One pill per language, like skills: «Inglés · B2 · Español · Nativo» was ambiguous.
  const pills = within(profile).getAllByText(/^(Inglés B2|Español Nativo)$/);
  expect(pills.map(pill => pill.textContent)).toEqual(["Inglés B2", "Español Nativo"]);
  pills.forEach(pill => expect(pill).toHaveAttribute("data-slot", "badge"));
  // Each profile row has its own icon.
  const icons = Array.from(profile.querySelectorAll("dt svg")).map(svg => svg.getAttribute("class"));
  expect(new Set(icons).size).toBe(icons.length);
  const skillsRow = Array.from(profile.querySelectorAll("dt")).find(dt => dt.textContent === "Habilidades")!.nextElementSibling!;
  expect(Array.from(skillsRow.querySelectorAll('[data-slot="badge"]')).map(badge => badge.textContent)).toEqual(["Go", "SQL"]);
});
it.each([
  [{ highest_completed: "bachelor" as const, in_progress: null }, "Licenciatura o Ingeniería"],
  [{ highest_completed: null, in_progress: "master" as const }, "Maestría en curso"],
])("shows completed-only and ongoing-only studies without inventing completion: %s", async (education, label) => {
  const detail = detailFixture();
  detail.profile.education = education;
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: detail });
  render(<SheetHarness />);
  const profile = await screen.findByRole("region", { name: "Perfil" });
  expect(within(profile).getByText(label)).toBeVisible();
});
it("sheet loading is independent, closes with a Spanish button, and ignores the late read", async () => {
  let resolve!: (value: Result<History>) => void;
  vi.mocked(loadHistoryAction).mockReturnValueOnce(new Promise(yes => { resolve = yes; }));
  render(<SheetHarness />);
  const sheet = await screen.findByRole("dialog", { name: "Ana Pérez" });
  expect(within(sheet).getByRole("status")).toHaveTextContent("Cargando detalle e historial");
  expect(sheet.querySelectorAll('[data-pf-detail-skeleton="summary"] dl')[2]?.querySelectorAll('dt')).toHaveLength(6);
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
it("shows the candidate's available contact as mail and phone links (user decision L18)", async () => {
  const detail = { ...detailFixture(), contact: { email: "ana.perez@ejemplo.com", phone: "+525512345678" } };
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: detail });
  render(<SheetHarness />);
  const contact = await screen.findByRole("region", { name: "Contacto" });
  expect(within(contact).getByRole("link", { name: "ana.perez@ejemplo.com" })).toHaveAttribute("href", "mailto:ana.perez@ejemplo.com");
  expect(within(contact).getByRole("link", { name: "ana.perez@ejemplo.com" }).querySelector("wbr")).not.toBeNull();
  expect(within(contact).getByRole("link", { name: "+52 55 1234 5678" })).toHaveAttribute("href", "tel:+525512345678");
  expect(Array.from(contact.querySelectorAll("dt")).map(dt => dt.textContent)).toEqual(["Correo", "Teléfono"]);
});
it("says honestly when a contact channel is missing", async () => {
  const detail = { ...detailFixture(), contact: { email: null, phone: "+14155550123" } };
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: detail });
  render(<SheetHarness />);
  const contact = await screen.findByRole("region", { name: "Contacto" });
  expect(within(contact).getByText("Sin dato")).toHaveClass("text-muted-foreground");
  expect(within(contact).getByRole("link", { name: "+14155550123" })).toHaveAttribute("href", "tel:+14155550123");
});
it("keeps a free-text organic phone as written but dials only its digits", async () => {
  const detail = { ...detailFixture(), contact: { email: "ana@example.com", phone: "33 1234 5678" } };
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: detail });
  render(<SheetHarness />);
  const contact = await screen.findByRole("region", { name: "Contacto" });
  expect(within(contact).getByRole("link", { name: "33 1234 5678" })).toHaveAttribute("href", "tel:3312345678");
});
