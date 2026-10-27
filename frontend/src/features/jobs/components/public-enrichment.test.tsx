import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { legacyDetail, listItem, vacancyDetail } from "../api/public-fixtures";
import { PublicVacancyCard } from "./PublicVacancyCard";
import { PublicJobDetailView } from "./PublicJobDetailView";

vi.mock("@/components/ui/tooltip", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/tooltip")>();
  return { ...actual, TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span> };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const job = {
  ...vacancyDetail,
  company: { ...vacancyDetail.company, logo_url: "https://example.test/logo.png" },
  excerpt: "Construye servicios con Go", excerpt_truncated: true,
  skills_preview: ["Go", "SQL", "Redis", "AWS", "Docker", "Linux"], skills_total: 8,
  skills: ["Go", "SQL", "Redis", "AWS", "Docker", "Linux", "Git", "HTTP"],
  benefits_preview: { predefined: ["health_insurance", "training_budget"] as const, custom: ["Café"] }, benefits_total: 5,
  applicants: "under_10" as const, screening_questions: 0,
};
// Keep the mutable wire arrays expected by the schema-inferred model.
const detail = { ...job, benefits_preview: { ...job.benefits_preview, predefined: [...job.benefits_preview.predefined] } };

it.each(["card", "detail"])("loads a private-referrer lazy logo with a colored initials fallback in the %s", (view) => {
  const images: HTMLImageElement[] = [];
  vi.stubGlobal("Image", class { constructor() { const image = document.createElement("img"); images.push(image); return image; } });
  const { container, unmount } = render(view === "card" ? <PublicVacancyCard job={listItem(detail)} /> : <PublicJobDetailView job={detail} />);
  expect(images).toHaveLength(1);
  expect(images[0].referrerPolicy).toBe("no-referrer");
  act(() => { fireEvent.load(images[0]); });
  const image = container.querySelector('[data-slot="avatar"] img')!;
  expect(image).toHaveAttribute("src", detail.company.logo_url);
  expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
  expect(image).toHaveAttribute("loading", "lazy");
  expect(image).toHaveAttribute("alt", "");
  unmount();
  const failed = render(view === "card" ? <PublicVacancyCard job={listItem(detail)} /> : <PublicJobDetailView job={detail} />);
  act(() => { fireEvent.error(images[1]); });
  const fallback = failed.container.querySelector('[data-slot="avatar-fallback"]')!;
  expect(fallback).toHaveTextContent("Ac");
  expect(fallback).toHaveClass("bg-background", "text-primary");
  expect(failed.container.querySelector('[data-slot="avatar"] img')).toBeNull();
});

it("renders the wire excerpt as escaped text with an ellipsis only when truncated", () => {
  const { rerender } = render(<PublicVacancyCard job={{ ...listItem(detail), excerpt: "<b>Go</b>" }} />);
  expect(screen.getByText("<b>Go</b>…")).toHaveClass("line-clamp-2");
  expect(document.querySelector("b")).toBeNull();
  rerender(<PublicVacancyCard job={{ ...listItem(detail), excerpt: "<b>Go</b>", excerpt_truncated: false }} />);
  expect(screen.getByText("<b>Go</b>")).toBeVisible();
  expect(screen.queryByText(/…/)).toBeNull();
  rerender(<PublicVacancyCard job={{ ...listItem(detail), excerpt: null, excerpt_truncated: false }} />);
  expect(screen.queryByText("<b>Go</b>")).toBeNull();
});

it("shows the six entered skills and remaining count, and catalog benefit labels with their count", () => {
  const { container, rerender } = render(<PublicVacancyCard job={listItem(detail)} />);
  expect(screen.getByText("Habilidades")).toBeVisible();
  const skills = screen.getByText("Habilidades").parentElement!;
  for (const skill of detail.skills_preview) expect(within(skills).getByText(skill)).toBeVisible();
  expect(within(skills).getByText("+2")).toBeVisible();
  expect(within(skills).queryByText("Git")).toBeNull();
  expect(screen.getByRole("link", { name: "y 2 beneficios más" })).toBeVisible();
  expect(container).not.toHaveTextContent(/health_insurance|training_budget/);
  rerender(<PublicVacancyCard job={{ ...listItem(detail), skills_total: 6, benefits_total: 3 }} />);
  expect(screen.queryByText("+2")).toBeNull();
  expect(screen.getByText("Seguro de gastos médicos · Presupuesto de capacitación · Café")).toBeVisible();
});

it("omits empty lower sections and all absent legacy screening/applicant metadata", () => {
  const { container } = render(<PublicVacancyCard job={{ ...listItem(legacyDetail), excerpt: null, excerpt_truncated: false }} />);
  expect(container).not.toHaveTextContent(/Habilidades|Beneficios|postulantes|Postulación rápida|preguntas? de filtro/);
  expect(container.querySelector('[data-slot="separator"]')).toBeNull();
});

it.each([
  ["under_10", "Menos de 10 postulantes"], ["10_plus", "Más de 10 postulantes"],
  ["25_plus", "Más de 25 postulantes"], ["50_plus", "Más de 50 postulantes"],
] as const)("uses the same range copy and Users icon for %s on card and near the detail CTA", (applicants, copy) => {
  const { unmount } = render(<PublicVacancyCard job={{ ...listItem(detail), applicants }} />);
  const meta = screen.getByRole("list", { name: "Condiciones principales" });
  expect(within(meta as HTMLElement).getByText(copy).querySelector("svg")).toHaveClass("lucide-users");
  unmount();
  render(<PublicJobDetailView job={{ ...detail, applicants }} />);
  const cta = screen.getByRole("link", { name: "Postularme" }).closest('[data-slot="card"]')!;
  expect(within(cta as HTMLElement).getByText(copy)).toBeVisible();
});

it.each([[0, "Postulación rápida"], [1, "1 pregunta de filtro"], [3, "3 preguntas de filtro"]] as const)("shows only the real screening copy for %i questions beside each CTA", (screening_questions, copy) => {
  const { container, unmount } = render(<PublicVacancyCard job={{ ...listItem(detail), screening_questions }} />);
  const rail = container.querySelector('[data-slot="card-footer"]')!;
  expect(within(rail as HTMLElement).getByText(copy)).toBeVisible();
  if (screening_questions === 0) expect(rail.querySelector(".lucide-zap")).not.toBeNull();
  else expect(within(rail as HTMLElement).queryByText("Postulación rápida")).toBeNull();
  unmount();
  render(<PublicJobDetailView job={{ ...detail, screening_questions }} />);
  const cta = screen.getByRole("link", { name: "Postularme" }).closest('[data-slot="card"]')!;
  expect(within(cta as HTMLElement).getByText(copy)).toBeVisible();
});

it("uses a full skills section in entered order on detail, not just its preview, and omits empty skills", () => {
  const { rerender } = render(<PublicJobDetailView job={detail} />);
  const heading = screen.getByRole("heading", { name: "Habilidades" });
  const card = heading.closest("section")!;
  expect(card).toHaveAttribute("id", "habilidades");
  expect([...card.querySelectorAll('[data-slot="badge"]')].map(node => node.textContent)).toEqual(detail.skills);
  rerender(<PublicJobDetailView job={legacyDetail} />);
  expect(screen.queryByRole("heading", { name: "Habilidades" })).toBeNull();
  expect(screen.queryByText(/postulantes|Postulación rápida|preguntas? de filtro/)).toBeNull();
});
