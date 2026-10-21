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
