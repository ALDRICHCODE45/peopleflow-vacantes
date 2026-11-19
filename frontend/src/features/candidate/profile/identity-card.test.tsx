import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CANDIDATE_PROFILE } from "../prototype-candidate";
import { profileToDraft, type CandidateProfileDraft } from "../profile-draft";
import { draftCompleteness, KEY_DATA, type KeyDataKey } from "../profile-completeness";
import { IdentityCard } from "./identity-card";
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  PopoverContent: () => null, PopoverTitle: () => null, PopoverDescription: () => null,
}));
afterEach(cleanup);

const full = profileToDraft(CANDIDATE_PROFILE);
const noLocation = { location: { ...full.location, country: null, state: null, municipality: null } };
const without: Readonly<Record<KeyDataKey, Partial<CandidateProfileDraft>>> = {
  professionalTitle: { professionalTitle: "" }, currentCompany: { currentCompany: "" }, yearsOfExperience: { yearsOfExperience: "" },
  summary: { summary: "" }, phone: { phone: "" }, location: noLocation,
  education: { education: [] }, skills: { skills: "" }, expectedSalary: { expectedSalary: "" }, languages: { languages: [] },
};
const step: Readonly<Record<KeyDataKey, string>> = {
  professionalTitle: "Agrega tu título profesional", currentCompany: "Agrega tu empresa actual", yearsOfExperience: "Agrega tus años de experiencia",
  summary: "Agrega tu resumen profesional", phone: "Agrega tu teléfono", location: "Agrega tu ubicación", education: "Agrega tus estudios",
  skills: "Agrega tus habilidades", expectedSalary: "Agrega tu salario esperado", languages: "Agrega tus idiomas",
};
const ORDER = KEY_DATA.map(({ key }) => key);
function show(draft: CandidateProfileDraft, onGoto = vi.fn()) {
  render(<IdentityCard fullName="Ximena Barrera" draft={draft} baseline={CANDIDATE_PROFILE} completeness={draftCompleteness(draft)} onGoto={onGoto} />);
  return onGoto;
}

it.each(ORDER)("offers one link for the next missing item when %s is missing, and sends its key", missing => {
  // Every later item is missing too: the link names the FIRST missing item only.
  const done = ORDER.indexOf(missing);
  const draft = ORDER.slice(done).reduce<CandidateProfileDraft>((current, name) => ({ ...current, ...without[name] }), full);
  const onGoto = show(draft);
  expect(screen.getByText(`${done} de 10`)).toBeVisible();
  const meter = document.querySelector("[data-pf-profile-meter]")!;
  expect(Array.from(meter.querySelectorAll("button")).map(button => button.textContent)).toEqual([step[missing]]);
  fireEvent.click(screen.getByRole("button", { name: step[missing] }));
  expect(onGoto).toHaveBeenCalledWith(missing);
});

it("says «Perfil completo» with a check and no link at 10 de 10", () => {
  show(full);
  expect(screen.getByText("10 de 10")).toBeVisible();
  expect(screen.getByText("Perfil completo")).toBeVisible();
  expect(document.querySelector("[data-pf-profile-meter] button")).toBeNull();
});

it("shows «Sin dato» on both tiles and no skills or title badge for an empty draft", () => {
  show({ ...full, ...noLocation, yearsOfExperience: "", seniority: "", skills: "", professionalTitle: "" });
  expect(screen.getAllByText("Sin dato")).toHaveLength(2);
  expect(screen.queryByRole("list", { name: "Habilidades" })).not.toBeInTheDocument();
  expect(document.querySelector('[data-slot="badge"]')).toBeNull();
});
