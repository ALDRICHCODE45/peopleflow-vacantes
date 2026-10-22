import { useState, type ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { EducationDraft } from "./profile-draft";
// Preserve Select selection semantics without jsdom's anchored-positioning loop.
vi.mock("@/components/ui/select", async importOriginal => ({
 ...await importOriginal<typeof import("@/components/ui/select")>(),
 SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
import { cleanup, render, screen, within } from "@testing-library/react";
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
it.each([false, true])("groups studies with removal in the header and a divider (embedded=%s)", embedded => {
 const { container } = render(<EducationFields embedded={embedded} value={[blank, blank]} onChange={() => {}} issues={[]} />);
 for (const n of [1, 2]) {
  const study = screen.getByRole("group", { name: `Estudio ${n}` });
  const remove = within(study).getByRole("button", { name: `Quitar estudio ${n}` });
  expect(remove).toHaveTextContent(/^Quitar$/);
  expect(remove.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  expect(remove.parentElement).toContainElement(within(study).getByText(`Estudio ${n}`, { selector: "span" }));
  expect(remove.compareDocumentPosition(within(study).getByLabelText("Nivel")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 }
 expect(container.querySelectorAll('[data-slot="separator"]')).toHaveLength(1);
});
it.each([false, true])("hides the end year of ongoing studies (embedded=%s)", embedded => {
 render(<EducationFields embedded={embedded} value={[{ ...blank, status: "in_progress" }]} onChange={() => {}} issues={[]} />);
 expect(screen.queryByLabelText("Año de fin")).toBeNull();
 expect(screen.getByLabelText("Año de inicio")).toBeVisible();
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
function ControlledStudies({ embedded }: { embedded: boolean }) {
 const [value, setValue] = useState<EducationDraft[]>([{ ...blank, status: "completed", end_year: "2024" }, { ...blank, status: "paused", end_year: "2020" }]);
 return <><EducationFields embedded={embedded} value={value} onChange={setValue} issues={[]} /><output aria-label="Estudios editados">{JSON.stringify(value)}</output></>;
}
it.each([false, true])("clears only the changed study's end year and removes the named study (embedded=%s)", async embedded => {
 const user = userEvent.setup();
 render(<ControlledStudies embedded={embedded} />);
 const study = within(screen.getByRole("group", { name: "Estudio 1" }));
 await user.click(study.getByLabelText("Estatus"));
 await user.click(study.getByRole("option", { name: "En curso" }));
 expect(study.queryByLabelText("Año de fin")).toBeNull();
 expect(JSON.parse(screen.getByLabelText("Estudios editados").textContent!)).toEqual([
  { ...blank, status: "in_progress", end_year: "" }, { ...blank, status: "paused", end_year: "2020" },
 ]);
 await user.click(study.getByLabelText("Estatus"));
 await user.click(study.getByRole("option", { name: "Concluido" }));
 expect(study.getByLabelText("Año de fin")).toHaveValue(null);
 await user.click(study.getByRole("button", { name: "Quitar estudio 1" }));
 expect(JSON.parse(screen.getByLabelText("Estudios editados").textContent!)).toEqual([{ ...blank, status: "paused", end_year: "2020" }]);
});
it("marks level and status as required when the host asks for markers", () => {
 render(<EducationFields embedded requiredMarker={<span data-testid="req"> *</span>} value={[blank]} onChange={() => {}} issues={[]} />);
 expect(screen.getAllByTestId("req")).toHaveLength(2);
});
