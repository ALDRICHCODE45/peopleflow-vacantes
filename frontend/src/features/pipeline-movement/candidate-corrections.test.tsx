import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CandidateSheet } from "./candidate-sheet";
import { loadHistoryAction, loadParticipationAction } from "./actions";
import { boardFixture, detailFixture, historyFixture, vacancyId } from "./board-fixture";

vi.mock("./actions", () => ({ loadHistoryAction: vi.fn(), loadParticipationAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
vi.mock("@/features/languages/use-language-catalog", () => ({ useLanguageCatalog: () => ({ status: "success", data: { items: [] } }) }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: detailFixture() });
  vi.mocked(loadHistoryAction).mockResolvedValue({ ok: true, data: historyFixture() });
});
afterEach(cleanup);
function show() {
  const board = boardFixture();
  render(<CandidateSheet vacancyId={vacancyId} item={board.participations[0]} board={board} onClose={vi.fn()} />);
}
it.each([
  ["email", "Contacto", "Correo"], ["phone", "Contacto", "Teléfono"],
  ["location", "Perfil", "Ubicación"], ["skills", "Perfil", "Habilidades"],
  ["years_of_experience", "Perfil", "Años de experiencia"], ["seniority", "Perfil", "Seniority"],
  ["education", "Perfil", "Nivel de estudios"], ["languages", "Perfil", "Idiomas"],
])("marks only the corrected %s value, including an explicit empty correction", async (field, region, label) => {
  const detail = Object.assign(detailFixture(), { corrected_fields: [field] });
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: detail });
  show();
  const section = await screen.findByRole("region", { name: region });
  const value = Array.from(section.querySelectorAll("dt")).find(dt => dt.textContent === label)!.nextElementSibling!;
  const badge = within(value as HTMLElement).getByText("Corregido");
  expect(badge).toHaveAttribute("data-slot", "badge");
  expect(badge).toHaveAttribute("data-variant", "accent");
  expect(screen.getAllByText("Corregido")).toHaveLength(1);
  expect(screen.queryByRole("button", { name: /Editar|Restaurar|Subir CV/ })).not.toBeInTheDocument();
});
it("uses the freshly read effective name and marks it next to the sheet title", async () => {
  const detail = Object.assign(detailFixture(), { corrected_fields: ["full_name"] });
  detail.candidate = { ...detail.candidate, full_name: "Ana Pérez López" };
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: detail });
  show();
  const title = await screen.findByRole("heading", { name: "Ana Pérez López" });
  expect(within(title.parentElement!).getByText("Corregido")).toHaveAttribute("data-variant", "accent");
  expect(title).toHaveAttribute("title", "Ana Pérez López");
});
it("does not label uncorrected data", async () => {
  show();
  await screen.findByRole("region", { name: "Perfil" });
  expect(screen.queryByText("Corregido")).not.toBeInTheDocument();
  expect(screen.queryByText("CV corregido por tu empresa")).not.toBeInTheDocument();
});
it.each(["candidate", "company"] as const)("shows the %s CV downloads in one wrapping, intrinsic-width action row", async source => {
  const detail = Object.assign(detailFixture(), { original_cv: source === "company" ? { file_name: "CV original.pdf", uploaded_at: "2026-10-16T12:00:00Z" } : null });
  Object.assign(detail.cv, { source });
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: detail });
  show();
  const current = await screen.findByRole("link", { name: "Descargar CV" });
  expect(current).toHaveAttribute("href", `/api/company/vacancies/${vacancyId}/participations/person/cv`);
  expect(current).toHaveAttribute("download");
  expect(current).toHaveClass("min-h-10");
  expect(current).not.toHaveClass("w-full");
  expect(current).toHaveClass("border-border", "bg-background");
  expect(current.querySelector('svg[data-icon="inline-start"]')).not.toBeNull();
  const row = current.closest('[data-slot="item-actions"]')!;
  expect(row).toHaveClass("flex-wrap");
  const document = row.closest('[data-slot="item"]')!;
  expect(document).toHaveAttribute("data-size", "sm");
  expect(document.querySelector('[data-slot="item-media"]')).toHaveAttribute("data-variant", "icon");
  expect(document.querySelector('[data-slot="item-media"] > svg')).not.toBeNull();
  expect(document.querySelector('[data-slot="item-title"]')).toHaveTextContent(detail.cv.name);
  expect(within(document as HTMLElement).getByTitle(detail.cv.name)).toHaveTextContent(detail.cv.name);
  expect(document.querySelector('[class*="basis-full"]')).toBeNull();
  expect(document.querySelector('[data-slot="item-description"]')).toHaveTextContent("Documento PDF");
  expect(current).toHaveAttribute("data-slot", "button");
  expect(current).toHaveClass("h-7");
  // Outline download links keep their border (cva is not twMerged; QA L24).
  for (const link of row.querySelectorAll("a")) expect(link).not.toHaveClass("border-transparent");
  if (source === "company") {
    const badge = screen.getByText("CV corregido por tu empresa");
    expect(badge).toHaveAttribute("data-variant", "accent");
    expect(document.querySelector('[data-slot="item-description"]')).toContainElement(badge);
    const original = screen.getByRole("link", { name: "Descargar CV original" });
    expect(original.closest('[data-slot="item-actions"]')).toBe(row);
    expect(original).toHaveAttribute("href", `/api/company/vacancies/${vacancyId}/participations/person/cv/original`);
    expect(original).toHaveAttribute("download");
    expect(original).toHaveClass("border-border", "bg-background");
    expect(original).toHaveClass("min-h-10");
    expect(original).not.toHaveClass("w-full");
    expect(original.querySelector('svg[data-icon="inline-start"]')).not.toBeNull();
  } else expect(screen.queryByRole("link", { name: "Descargar CV original" })).not.toBeInTheDocument();
});
it("does not offer an unavailable original when only the corrected CV metadata exists", async () => {
  const detail = Object.assign(detailFixture(), { original_cv: null });
  Object.assign(detail.cv, { source: "company" });
  vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: detail });
  show();
  expect(await screen.findByText("CV corregido por tu empresa")).toBeVisible();
  expect(screen.queryByRole("link", { name: "Descargar CV original" })).not.toBeInTheDocument();
});
