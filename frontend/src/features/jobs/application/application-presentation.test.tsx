import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { PrototypeJobView } from "../enrich";
import { ApplicationCandidateCard } from "./application-candidate-card";
import { VacancyApplicationSummary } from "./vacancy-application-summary";

const job: PrototypeJobView = { id: "job", title: "Vacante con un título largo que debe leerse completo", company: { id: "company", name: "Empresa" }, description: "", work_mode: "remote", employment_type: "full_time", seniority: "senior", salary_currency: "USD" };
afterEach(cleanup);

it("keeps every real profile skill available instead of hiding the remainder", () => {
  const skills = Array.from({ length: 8 }, (_, index) => `Habilidad ${index}`);
  render(<ApplicationCandidateCard draft={{ fullName: "Persona", email: "persona@example.test", phone: "", professionalTitle: "", location: null }} skills={skills} avatarSrc="" />);
  for (const skill of skills) expect(screen.getByText(skill)).toBeVisible();
});

it("renders the authoritative server label rather than rebuilding it from references", () => {
  const { container } = render(<ApplicationCandidateCard draft={{ fullName: "Persona", email: "persona@example.test", phone: "", professionalTitle: "", location: { country: { id: "MX", name: "México" }, state: null, municipality: null, postal_code: null, label: "Etiqueta del servidor" } }} skills={[]} avatarSrc="" />);
  expect(container.querySelector("[data-pf-application-candidate-location]")).toHaveTextContent("Etiqueta del servidor");
  expect(container.querySelector("[data-pf-application-candidate-location]")).not.toHaveTextContent("México");
});

it("keeps salary explicit when unavailable, and secondary facts as text", () => {
  render(<VacancyApplicationSummary job={job} />);
  expect(screen.getByText("Salario no publicado")).toBeVisible();
  expect(screen.getByText("Tiempo completo · Senior").closest('[data-slot="badge"]')).toBeNull();
  expect(screen.getByText(job.title)).not.toHaveClass("truncate");
});

it("uses shared public money presentation without inventing legacy cadence or basis", () => {
  render(<VacancyApplicationSummary job={{ ...job, salary_min: 50000, salary_max: 70000 }} />);
  expect(screen.getByText("$50,000 – $70,000 USD")).toHaveClass("tabular-nums");
  expect(screen.getByText("Periodicidad y neto/bruto no publicados")).toBeVisible();
});
