import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CANDIDATE_IDENTITY, CANDIDATE_PROFILE } from "@/features/candidate/prototype-candidate";
import { enrichJob } from "../enrich";
import { VacancyApplicationShell } from "./vacancy-application-shell";
import { VacancyApplicationWizard } from "./vacancy-application-wizard";

const job = enrichJob({ id: "job-id", title: "Frontend", description: "Interfaces", work_mode: "remote", employment_type: "full_time", seniority: "senior", salary_currency: "MXN", company: { id: "company-id", name: "Acme" } });
afterEach(cleanup);

it("keeps vacancy, company and honest salary information beside the final action", () => {
  render(<VacancyApplicationWizard job={job} identity={CANDIDATE_IDENTITY} profile={CANDIDATE_PROFILE} avatarSrc="" vacancySummary={null} />);
  for (let step = 0; step < 3; step++) fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  const footer = screen.getByRole("link", { name: "Iniciar sesión para enviar" }).closest('[data-slot="card-footer"]')! as HTMLElement;
  expect(within(footer).getByText("Frontend")).toBeVisible();
  expect(within(footer).getByText("Acme")).toBeVisible();
  expect(within(footer).getByText("Salario no publicado")).toBeVisible();
});

it("leaves application return navigation to the app header without repeating it in content", () => {
  render(<VacancyApplicationShell job={job}><p>Formulario</p></VacancyApplicationShell>);
  expect(screen.queryByRole("navigation", { name: "Ruta de navegación" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Volver a la vacante" })).toBeNull();
  expect(screen.getByRole("heading", { level: 1, name: "Postularme" })).toBeVisible();
  expect(screen.getByText("Formulario")).toBeVisible();
});

it("keeps a single primary per step and stacks step actions on narrow screens", () => {
  render(<VacancyApplicationWizard job={job} identity={CANDIDATE_IDENTITY} profile={CANDIDATE_PROFILE} avatarSrc="" vacancySummary={null} />);
  for (let step = 0; step < 4; step++) {
    const primary = step === 3
      ? screen.getByRole("link", { name: "Iniciar sesión para enviar" })
      : screen.getByRole("button", { name: "Continuar" });
    const footer = primary.closest('[data-slot="card-footer"]')!;
    expect(footer).toHaveClass("flex-col", "sm:flex-row");
    expect(primary).toHaveClass("bg-primary", "w-full", "sm:w-auto");
    if (step > 0) expect(screen.getByRole("button", { name: "Atrás" })).not.toHaveClass("bg-primary");
    if (step < 3) fireEvent.click(primary);
  }
});
