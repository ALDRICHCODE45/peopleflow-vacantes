import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CandidateEditSummary } from "./candidate-edit-summary";
import { CANDIDATE_EDIT_FIELDS, type CandidateEditBody } from "./edit-model";
import { valuesFixture } from "./test-fixtures";

afterEach(cleanup);
it.each([
 ["Nombre completo", "lucide-contact-round"], ["Correo", "lucide-mail"], ["Teléfono", "lucide-phone"],
 ["Ubicación", "lucide-map-pin"], ["Título profesional", "lucide-briefcase-business"], ["Empresa actual", "lucide-briefcase-business"],
 ["Seniority", "lucide-trending-up"], ["Años de experiencia", "lucide-briefcase-business"], ["Estudios", "lucide-graduation-cap"],
 ["Idiomas", "lucide-languages"], ["Habilidades", "lucide-sparkles"], ["LinkedIn", "lucide-link"], ["Portafolio", "lucide-link"],
])("uses the read-view / form-section icon for %s", (label, iconClass) => {
 render(<CandidateEditSummary body={{ set: {}, reset: [...CANDIDATE_EDIT_FIELDS] }} />);
 const term = screen.getByText(label, { selector: "dt" });
 expect(term.querySelector('svg[aria-hidden="true"]')).toHaveClass(iconClass);
});
it("labels every editable field and reuses readable enum, study and language formatting", () => {
 const set: CandidateEditBody["set"] = {
  ...valuesFixture(), location: { country: "US", postal_code: "90210" },
  education: [{ level: "bachelor", status: "completed", institution: "UNAM", field: "Ingeniería", start_year: 2014, end_year: 2018 }],
  current_company: "Acme", linkedin_url: "https://linkedin.com/in/lucia", portfolio_url: "https://example.com",
 };
 const { container } = render(<CandidateEditSummary body={{ set }} />);
 expect([...container.querySelectorAll("dt")].map(term => term.textContent)).toEqual([
  "Nombre completo", "Correo", "Teléfono", "Ubicación", "Título profesional", "Empresa actual", "Seniority", "Años de experiencia", "Estudios", "Idiomas", "Habilidades", "LinkedIn", "Portafolio",
 ]);
 expect(screen.getByText("US · 90210")).toBeVisible();
 expect(screen.getByText("Senior")).toBeVisible();
 expect(screen.getByText("4.5 años")).toBeVisible();
 expect(screen.getByText(/Licenciatura o Ingeniería.*UNAM.*Ingeniería.*2014–2018/)).toBeVisible();
 expect(screen.getByText("es · Nativo")).toBeVisible();
 expect(container.querySelectorAll("dd")).toHaveLength(CANDIDATE_EDIT_FIELDS.length);
 for (const value of container.querySelectorAll("dd")) expect(value).toHaveClass("line-clamp-2", "break-words");
});
it("renders one reset row per field even without a set value", () => {
 const { container } = render(<CandidateEditSummary body={{ set: {}, reset: [...CANDIDATE_EDIT_FIELDS] }} />);
 expect(container.querySelectorAll("dt")).toHaveLength(CANDIDATE_EDIT_FIELDS.length);
 expect(screen.getAllByText("Se restaurará el original")).toHaveLength(CANDIDATE_EDIT_FIELDS.length);
});
it("distinguishes cleared collections from zero and formats singular years", () => {
 const { rerender } = render(<CandidateEditSummary body={{ set: { skills: null, education: [], languages: [], years_of_experience: "0" } }} />);
 expect(screen.getAllByText("Sin dato")).toHaveLength(3);
 expect(screen.getByText("0 años")).toBeVisible();
 rerender(<CandidateEditSummary body={{ set: { years_of_experience: "1" } }} />);
 expect(screen.getByText("1 año")).toBeVisible();
});
