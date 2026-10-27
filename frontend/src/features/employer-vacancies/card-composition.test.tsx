import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TeamWorkspace } from "@/features/employer-team/team-workspace";
import { SectionCards } from "@/components/company-dashboard/section-cards";
import { ActiveVacancies } from "@/components/company-dashboard/active-vacancies";
import { CompanyJobs } from "@/features/company-site/public/company-jobs";
import { CareersSiteEditorLoading } from "@/features/company-site/editor/editor-feedback";
import { listItem, vacancyDetail } from "@/features/jobs/api/public-fixtures";
import { BoardSkeleton } from "@/features/pipeline-movement/board-states";
import { EmployerSettingsWorkspace } from "@/features/employer-settings/settings-workspace";
import { VacancyPortfolio } from "./vacancy-portfolio";

vi.mock("./use-portfolio-drafts", () => ({ usePortfolioDrafts: () => ({ items: [], pending: false, retry: vi.fn(), published: vi.fn() }), DRAFT_LIST_MESSAGES: {} }));
vi.mock("@/features/jobs/drafts/reopen/load", () => ({ loadDraftForEditAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/actions", () => ({ loadDraftPipelineAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/delivery-actions", () => ({ loadDraftDeliveryAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/publication-actions", () => ({ loadDraftPublicationAction: vi.fn(), publishDraftAction: vi.fn() }));
afterEach(cleanup);

it.each([
  ["team", <TeamWorkspace key="team" members={[]} />, "data-pf-team-metric", 3],
  ["vacancies", <VacancyPortfolio key="vacancies" />, "data-pf-vacancy-metric", 5],
  ["dashboard", <SectionCards key="dashboard" data={{ published_vacancies: 0, in_process: 0, pool_added_last_7_days: 0, positions: { covered: 0, required: 0 } }} />, "data-slot=card", 4],
] as const)("composes %s metrics with title headings and supporting labels", (_name, view, attribute, count) => {
  const { container } = render(view);
  const cards = container.querySelectorAll(`[${attribute}]`);
  expect(cards).toHaveLength(count);
  for (const card of cards) {
    expect(card).toHaveAttribute("data-slot", "card");
    expect(card.querySelector(':scope > [data-slot="card-header"] > [data-slot="card-title"] h3')).not.toBeNull();
    expect(card.querySelector(':scope > [data-slot="card-header"] > [data-slot="card-description"]')).not.toBeNull();
  }
});

it("composes current careers vacancy cards with a title, area, conditions and closing date", () => {
  const { container } = render(<CompanyJobs jobs={[listItem(vacancyDetail)]} variant="cards" />);
  const card = container.querySelector('[data-slot="card"]')!;
  expect(card.querySelector('[data-slot="card-header"] [data-slot="card-title"] h3')).toHaveTextContent(vacancyDetail.title);
  expect(card.querySelector('[data-slot="card-description"]')).not.toBeNull();
  expect(card.querySelector('[data-slot="card-content"] [data-job-meta]')).not.toBeNull();
  expect(card.querySelector('[data-slot="card-footer"] time')).toHaveAttribute("datetime", vacancyDetail.published_at);
  expect(card.closest("a")).toHaveAttribute("href", `/vacantes/${vacancyDetail.id}`);
});

it("mirrors the real editor toolbar, sections, preview and properties while loading", () => {
  const { container } = render(<CareersSiteEditorLoading />);
  for (const region of ["toolbar", "sections", "preview", "properties"]) {
    expect(container.querySelector(`[data-editor-region="${region}"] [data-slot="skeleton"]`)).not.toBeNull();
  }
  expect(container.querySelector('[role="status"]')).toHaveTextContent("Cargando editor");
});

it("uses the Empty primitive for the dashboard's empty list", () => {
  const { container } = render(<ActiveVacancies vacancies={[]} />);
  expect(container.querySelector('[data-pf-active-vacancies-empty]')).toHaveAttribute("data-slot", "card");
  expect(container.querySelector('[data-pf-active-vacancies-empty] [data-slot="empty"]')).not.toBeNull();
});

it("replicates the draggable card title, menu, date rows and footer slots", async () => {
  const { container } = render(<BoardSkeleton />);
  await act(async () => {});
  for (const card of container.querySelectorAll('[data-slot="card"]')) {
    expect(card.querySelector('[data-slot="card-title"] [data-slot="skeleton"]')).not.toBeNull();
    expect(card.querySelector('[data-slot="card-action"] [data-slot="skeleton"]')).not.toBeNull();
    expect(card.querySelector('[data-slot="card-content"] [data-slot="skeleton"]')).not.toBeNull();
    expect(card.querySelector('[data-slot="card-footer"] [data-slot="skeleton"]')).not.toBeNull();
  }
});

it("retains the existing settings card heading and description composition", () => {
  const { container } = render(<EmployerSettingsWorkspace />);
  expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(5);
  for (const card of container.querySelectorAll('[data-slot="card"]')) {
    expect(card.querySelector('[data-slot="card-header"] > [data-slot="card-title"] h2')).not.toBeNull();
    expect(card.querySelector('[data-slot="card-header"] > [data-slot="card-description"]')).not.toBeNull();
    expect(card.querySelector(':scope > [data-slot="card-content"] [data-slot="item-group"]')).not.toBeNull();
  }
});
