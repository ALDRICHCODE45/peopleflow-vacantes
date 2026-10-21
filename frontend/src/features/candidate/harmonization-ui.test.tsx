import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { ProfileFormFields } from "./profile-form-fields";
import { profileToDraft } from "./profile-draft";
import { profileFromWire } from "./profile-adapter";
afterEach(cleanup);
function Editor({ category }: { category: "education" | "experience" }) {
  const [draft, setDraft] = useState(() => profileToDraft(profileFromWire({ user_id: "11111111-1111-4111-8111-111111111111", location: null, salary_currency: "MXN", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }, { languages: [] })));
  return <ProfileFormFields draft={draft} onChange={setDraft} issues={[]} category={category} />;
}
it("adds and removes studies in the existing education section", async () => {
  const user = userEvent.setup(); render(<Editor category="education" />);
  await user.click(screen.getByRole("button", { name: "Agregar estudio" }));
  for (const name of ["Nivel", "Institución", "Carrera o campo", "Estado", "Año de inicio", "Año de fin"]) expect(screen.getByLabelText(name)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Quitar estudio 1" }));
  expect(screen.queryByLabelText("Institución")).toBeNull();
});
it("offers seniority and decimal years without replacing the professional section", () => {
  render(<Editor category="experience" />);
  expect(screen.getByLabelText("Seniority")).toBeTruthy();
  expect(screen.getByText("Puedes usar decimales, por ejemplo 1.5.")).toBeTruthy();
  expect(screen.getByLabelText("Años de experiencia").getAttribute("step")).toBe("0.1");
  expect(screen.getByRole("group", { name: "Perfil profesional" })).toBeTruthy();
});
