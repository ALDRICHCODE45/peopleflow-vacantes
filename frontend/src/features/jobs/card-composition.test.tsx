import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { legacyDetail, vacancyDetail, listItem } from "./api/public-fixtures";
import { PublicVacancyCard } from "./components/PublicVacancyCard";
import { PublicJobDetailView } from "./components/PublicJobDetailView";
import { VacancyCard } from "./components/VacancyCard";
import { JobDetailView } from "./components/JobDetailView";
import { PublicJobCardSkeleton, PublicJobDetailSkeleton } from "./components/PublicJobSkeleton";
import { JobsNavigationIsland } from "./components/JobsNavigationIsland";
import { VacancyPreview } from "./create/VacancyPreview";
import { INITIAL_PROTOTYPE_VALUES } from "./create/form/prototype-model";
import { DraftPreview } from "./drafts/ui/draft-preview";
import { DraftQuestionnairePreview } from "./drafts/ui/draft-questionnaire-preview";
import { initialDraftFormState } from "./drafts/ui/draft-form-state";
import { createDraftModel } from "./drafts/model";
import { ApplicationCandidateCard } from "./application/application-candidate-card";
import { VacancyApplicationSummary } from "./application/vacancy-application-summary";
import { enrichJob } from "./enrich";
import type { JobItem } from "./types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(cleanup);

const job: JobItem = {
  id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e", title: "Ingeniera Frontend",
  description: "Construye experiencias accesibles.", work_mode: "remote", employment_type: "full_time",
  seniority: "senior", salary_currency: "MXN", salary_min: 30000,
  company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f", name: "Acme" },
};
const values = { title: "Backend Go", description: "Servicios seguros", location: "CDMX", workMode: "remote", employmentType: "full_time", seniority: "senior", salaryMin: "30000", salaryMax: "40000", salaryCurrency: "MXN" } as const;

function expectHeader(heading: HTMLElement) {
  const title = heading.closest('[data-slot="card-title"]');
  expect(title).not.toBeNull();
  expect(title?.parentElement).toHaveAttribute("data-slot", "card-header");
  return title!.parentElement!;
}
function expectParts(card: Element, slots: string[]) {
  for (const slot of slots) expect(card.querySelector(`:scope > [data-slot="${slot}"]`), slot).not.toBeNull();
}

it("keeps public identity titles and descriptions directly in the native header grid", () => {
  const { unmount } = render(<ul><PublicVacancyCard job={listItem(vacancyDetail)} /></ul>);
  const header = expectHeader(screen.getByRole("heading", { name: vacancyDetail.title }));
  expect(header.querySelector(':scope > [data-slot="card-description"]')).toHaveTextContent(vacancyDetail.company.name);
  unmount();
  render(<PublicJobDetailView job={vacancyDetail} />);
  expectHeader(screen.getByRole("heading", { level: 1 }));
  expectHeader(screen.getByRole("heading", { name: "La vacante de un vistazo" }));
  expectHeader(screen.getByRole("heading", { name: "Compensación" }));
  // Anchored sections share one content Card with a navigation header.
  for (const name of ["Sobre la vacante", "Lo que buscamos", "Habilidades", "Beneficios para ti"]) {
    expect(screen.getByRole("heading", { name }).closest("section")).not.toBeNull();
  }
});

it("composes the legacy vacancy row with a contextual action and a closing salary/CTA footer", () => {
  const { container } = render(<ul><VacancyCard job={enrichJob(job)} /></ul>);
  const card = container.querySelector('[data-slot="card"]')!;
  expect(card).not.toBeNull();
  expectParts(card, ["card-header", "card-content", "card-footer"]);
  const header = expectHeader(screen.getByRole("heading", { name: job.title }));
  expect(screen.getByRole("button", { name: "Guardar vacante" }).closest('[data-slot="card-action"]')?.parentElement).toBe(header);
  expect(screen.getByText("Destacada").closest('[data-slot="card-action"]')).not.toBeNull();
  expect(screen.getByRole("link", { name: "Ver vacante" }).closest('[data-slot="card-footer"]')).not.toBeNull();
});

it.each([vacancyDetail, enrichJob(job)])("separates public detail return navigation from the sole apply action", (job) => {
  render(<JobDetailView job={job} />);
  const back = screen.getByRole("link", { name: "Volver a vacantes" });
  expect(back.closest('[data-slot="card"]')).toBeNull();
  expect(back).not.toHaveClass("bg-primary");
  expect(back).toHaveClass("hover:bg-muted");
  expect(screen.getByRole("link", { name: "Postularme" })).toHaveClass("bg-primary");
  expect(screen.getAllByRole("link", { name: "Postularme" })).toHaveLength(1);
  const description = screen.getByRole("heading", { name: "Sobre la vacante" }).closest('[data-slot="card"]')!;
  expect(description.querySelector(".max-w-prose")).not.toBeNull();
});

it("uses Card for every legacy detail surface, Item for benefit rows, and native header actions", () => {
  const { container } = render(<JobDetailView job={enrichJob(job)} />);
  for (const node of container.querySelectorAll('[data-detail-card], [data-detail-stat], [data-detail-region="header"]')) expect(node).toHaveAttribute("data-slot", "card");
  expectHeader(screen.getByRole("heading", { level: 1 }));
  for (const node of container.querySelectorAll('[data-benefit-tile]')) expect(node.querySelector('[data-slot="item"]')).not.toBeNull();
  expect(screen.getByRole("button", { name: "Guardar vacante" }).closest('[data-slot="card-action"]')).not.toBeNull();
  expect(screen.getByRole("link", { name: "Postularme" }).closest('[data-slot="card-footer"]')).not.toBeNull();
});

it("composes both preview cards and the complementary dossier instead of hand-made surfaces", () => {
  const { container } = render(<VacancyPreview {...values} prototype={{ ...INITIAL_PROTOTYPE_VALUES, skills: ["Go"] }} />);
  expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(3);
  expectHeader(screen.getByRole("heading", { name: "Vista previa pública" }));
  expectHeader(screen.getByRole("heading", { name: values.title }));
  expectHeader(screen.getByRole("heading", { name: "Información complementaria" }));
  expect(screen.getByText("Borrador").closest('[data-slot="card-action"]')).not.toBeNull();
  expect(screen.getByText("$30,000 – $40,000 MXN").closest('[data-slot="card-footer"]')).not.toBeNull();
  expect(screen.getByText(/Vista previa de borrador:/).closest('[data-slot="card-footer"]')).not.toBeNull();
});

it("gives the persisted draft preview and questionnaire native headers and descriptions", () => {
  render(<><DraftPreview state={initialDraftFormState(createDraftModel())} /><DraftQuestionnairePreview questions={[]} /></>);
  for (const name of ["Vista previa pública", "Simular cuestionario"]) {
    const header = expectHeader(screen.getByRole("heading", { name }));
    expect(header.querySelector(':scope > [data-slot="card-description"]')).not.toBeNull();
  }
  expect(screen.getByText("Pública").closest('[data-slot="card-action"]')).not.toBeNull();
});

it("uses native titles and descriptions in the two application rail cards", () => {
  render(<><ApplicationCandidateCard draft={{ fullName: "Ana", email: "ana@example.test", phone: "", professionalTitle: "Ingeniera", location: null }} skills={[]} avatarSrc="" /><VacancyApplicationSummary job={enrichJob(job)} /></>);
  for (const name of ["Tu perfil", "Resumen de la vacante"]) expectHeader(screen.getByRole("heading", { name }));
  expect(screen.getByText("Ingeniera").closest('[data-slot="card-description"]')).not.toBeNull();
  expect(screen.getByText("Acme").closest('[data-slot="card-description"]')).not.toBeNull();
});

it.each([vacancyDetail, legacyDetail, { ...vacancyDetail, compensation: null, requirements: { required: null, preferred: null }, benefits: { predefined: [], custom: [] } }])("mirrors the $source projection's optional card slots while loading", (job) => {
  const sequence = (root: Element) => [...root.querySelectorAll('[data-slot]')].map(node => node.getAttribute("data-slot")).filter(slot => slot?.startsWith("card"));
  const list = render(<PublicVacancyCard job={listItem(job)} />);
  const factsCount = list.container.querySelectorAll('dl > div').length;
  const listSlots = sequence(list.container);
  list.unmount();
  const loadingList = render(<PublicJobCardSkeleton job={job} />);
  expect(sequence(loadingList.container)).toEqual(listSlots);
  expect(loadingList.container.querySelectorAll('dl > div')).toHaveLength(factsCount);
  loadingList.unmount();
  const detail = render(<PublicJobDetailView job={job} />);
  const itemCount = detail.container.querySelectorAll('[data-slot="item"]').length;
  const detailSlots = sequence(detail.container);
  detail.unmount();
  const loadingDetail = render(<PublicJobDetailSkeleton job={job} />);
  expect(sequence(loadingDetail.container)).toEqual(detailSlots);
  expect(loadingDetail.container.querySelectorAll('[data-slot="item"]')).toHaveLength(itemCount);
  for (const skeleton of loadingDetail.container.querySelectorAll('[data-slot="skeleton"]')) expect(skeleton.closest('[aria-hidden="true"]')).not.toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("Cargando vacante");
});

it("keeps filter closing actions in a footer inside their original form", () => {
  render(<JobsNavigationIsland routeKey="/vacantes" query={{}}><p>Resultados</p></JobsNavigationIsland>);
  const submit = screen.getByRole("button", { name: "Aplicar filtros" });
  expect(submit.closest('[data-slot="card-footer"]')).not.toBeNull();
  expect(submit.closest("form")).toHaveAttribute("data-nav-intent", "filters");
});
