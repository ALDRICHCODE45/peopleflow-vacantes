import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TeamWorkspace } from "@/features/employer-team/team-workspace";
import { SectionCards } from "@/components/company-dashboard/section-cards";
import { ActiveVacancies } from "@/components/company-dashboard/active-vacancies";
import { CompanyCareersView } from "@/features/company-profile/company-careers-view";
import { siteContentFromProfile } from "@/features/company-profile/company-site-content";
import { ACME_PROTOTYPE_PROFILE } from "@/features/company-profile/prototype-companies";
import { ACME_PROTOTYPE_JOBS } from "@/features/jobs/prototype-jobs";
import { CompanySiteEditor } from "@/features/company-site-editor/company-site-editor";
import { EmployerSessionProvider } from "@/features/company-site-editor/employer-session";
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
  ["dashboard", <SectionCards key="dashboard" />, "data-slot=card", 4],
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

it("keeps website actions in fact and vacancy footers, with mission and vacancy titles in headers", () => {
  const { container } = render(<CompanyCareersView content={siteContentFromProfile(ACME_PROTOTYPE_PROFILE)} jobs={ACME_PROTOTYPE_JOBS} />);
  for (const card of container.querySelectorAll('[data-slot="card"]')) {
    for (const link of card.querySelectorAll('a')) {
      expect(link.closest('[data-slot="card-title"], [data-slot="card-footer"]')).not.toBeNull();
    }
  }
  const mission = container.querySelector('[data-pf-company-mission]');
  expect(mission?.querySelector('[data-slot="card-header"] [data-slot="card-title"] h3')).toHaveTextContent("Nuestra misión");
  for (const card of container.querySelectorAll('li > [data-slot="card"]')) {
    expect(card.querySelector('[data-slot="card-title"] h3')).not.toBeNull();
    expect(card.querySelector('[data-slot="card-description"]')).not.toBeNull();
    expect(card.querySelector('[data-slot="card-footer"]')).not.toBeNull();
  }
});

it("gives the site readiness badge a header action and confirmation a footer", () => {
  const { container } = render(<EmployerSessionProvider><CompanySiteEditor /></EmployerSessionProvider>);
  const card = container.querySelector('[data-pf-sitio-readiness]')!;
  expect(card.querySelector('[data-slot="card-header"] [data-slot="card-description"]')).not.toBeNull();
  expect(card.querySelector('[data-slot="card-action"] [data-slot="badge"]')).not.toBeNull();
  expect(card.querySelector('[data-slot="card-footer"] button')).toHaveTextContent("Confirmar nombre");
  expect(container.querySelector('[data-pf-sitio-preview-surface] [data-slot="card-header"] [data-slot="card-title"] h2')).toHaveTextContent("Vista previa");
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
