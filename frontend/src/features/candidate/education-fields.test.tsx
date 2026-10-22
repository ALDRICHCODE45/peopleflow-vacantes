import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { EducationFields } from "./education-fields";
afterEach(cleanup);
it("keeps the default Card surface", () => {
 const { container } = render(<EducationFields value={[]} onChange={() => {}} issues={[]} />);
 expect(container.querySelector('[data-slot="card"]')).not.toBeNull();
 expect(screen.getByRole("button", { name: "Agregar estudio" })).toBeVisible();
});
it("embeds the FieldSet without a Card surface", () => {
 const { container } = render(<EducationFields embedded value={[]} onChange={() => {}} issues={[]} />);
 expect(container.querySelector('[data-slot="card"]')).toBeNull();
 expect(screen.getByRole("group", { name: "Formación académica" })).toBeVisible();
 expect(screen.getByRole("button", { name: "Agregar estudio" })).toBeVisible();
});
const blank = { level: "", institution: "", field: "", status: "", start_year: "", end_year: "" } as const;
it("asks to choose a level and a status instead of offering «Sin especificar» for required fields", () => {
 render(<EducationFields embedded value={[blank]} onChange={() => {}} issues={[]} />);
 expect(screen.queryByText("Sin especificar")).toBeNull();
 expect(screen.getByLabelText(/^Nivel/)).toHaveTextContent("Elige un nivel");
 expect(screen.getByLabelText(/^Estatus/)).toHaveTextContent("Elige un estatus");
 // «Estado» is the residence state elsewhere in the same forms; the study status is «Estatus».
 expect(screen.queryByLabelText(/^Estado/)).toBeNull();
});
it("marks level and status as required when the host asks for markers", () => {
 render(<EducationFields embedded requiredMarker={<span data-testid="req"> *</span>} value={[blank]} onChange={() => {}} issues={[]} />);
 expect(screen.getAllByTestId("req")).toHaveLength(2);
});
