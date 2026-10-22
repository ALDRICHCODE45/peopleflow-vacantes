import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { CandidateResults, CandidateResultsSkeleton } from "./candidate-results";
import { candidate } from "./test-fixtures";
import type { OrgCandidate } from "../model";

const languages = [{ code: "en", name: "Inglés" }];
const empty: OrgCandidate = { ...candidate, professional_title: null, profile: {
  location: null, skills: [], seniority: null, years_of_experience: null,
  education: { highest_completed: null, in_progress: null }, languages: [],
} };
afterEach(cleanup);
function show(item: OrgCandidate = candidate, view: "table" | "cards" = "table") {
  return render(<CandidateResults items={[item]} view={view} languages={languages} />);
}
it("merges seniority and years into one experience column", () => {
  show();
  expect(screen.queryByRole("columnheader", { name: "Seniority" })).not.toBeInTheDocument();
  expect(screen.getAllByRole("columnheader")).toHaveLength(7);
  expect(screen.getByRole("cell", { name: "Senior · 4.5 años" })).toBeInTheDocument();
  // The number and its unit never wrap apart («4.5» / «años» on separate lines).
  expect(screen.getByText("4.5 años")).toHaveClass("whitespace-nowrap");
});
it("constrains the table without minimum-width cells and wraps vacancy titles and language pills", () => {
  show({ ...candidate, latest_participation: { ...candidate.latest_participation!, vacancy: { ...candidate.latest_participation!.vacancy, title: "Desarrollador Web Full Stack" } } });
  expect(screen.getByRole("table")).toHaveClass("table-fixed");
  for (const cell of screen.getAllByRole("cell")) {
    expect(cell.className).not.toMatch(/min-w-(?:\d|\[)/u);
    expect(cell).toHaveClass("whitespace-normal");
  }
  expect(screen.getByText("Desarrollador Web Full Stack")).toHaveClass("break-words");
  expect(screen.getByRole("columnheader", { name: "Actividad" })).not.toHaveClass("hidden");
});
it("keeps the origin and title inside the name text block, beside the avatar", () => {
  show();
  const name = screen.getByRole("button", { name: `Abrir ficha de ${candidate.full_name}` });
  const block = name.parentElement!.parentElement!;
  expect(block).toContainElement(screen.getByText("Manual"));
  expect(block).toContainElement(screen.getByText(candidate.professional_title));
  expect(block.querySelector('[data-slot="avatar"]')).toBeNull();
});
it.each(["table", "cards"] as const)("uses neutral, focusable name actions in %s", view => {
  show(candidate, view);
  const name = screen.getByRole("button", { name: `Abrir ficha de ${candidate.full_name}` });
  expect(name).toHaveClass("text-foreground", "font-medium", "hover:underline");
  expect(name).not.toHaveClass("text-primary");
  expect(name.className).toMatch(/focus-visible:ring/u);
});
it.each(["table", "cards"] as const)("matches the sheet's language pills in %s, including native and catalog failure", view => {
  show({ ...candidate, profile: { ...candidate.profile, languages: [{ code: "en", level: "C1" }, { code: "es", level: "native" }] } }, view);
  const pill = screen.getByText("Inglés C1");
  expect(pill).toHaveAttribute("data-variant", "outline");
  expect(pill.parentElement).toHaveClass("flex-wrap");
  expect(screen.getByText("Idioma no disponible Nativo")).toBeInTheDocument();
});
it("mutes every missing fact in the table", () => {
  show(empty);
  const missing = screen.getAllByText("Sin dato");
  expect(missing).toHaveLength(4);
  for (const fact of missing) expect(fact).toHaveClass("text-muted-foreground");
});
it("cards omit missing facts and show only one incomplete-profile message", () => {
  show(empty, "cards");
  expect(screen.queryAllByText(/Sin dato/u)).toHaveLength(0);
  expect(screen.getAllByText("Perfil sin completar")).toHaveLength(1);
  expect(screen.getByText("Perfil sin completar")).toHaveClass("text-muted-foreground");
  expect(screen.getByText("Backend Go")).toBeInTheDocument();
});
it.each([
  { seniority: "senior" as const, years_of_experience: null, text: "Senior" },
  { seniority: null, years_of_experience: "0", text: "0 años" },
  { seniority: null, years_of_experience: "1", text: "1 año" },
])("cards retain partial experience without empty separators: $text", ({ text, ...experience }) => {
  show({ ...empty, profile: { ...empty.profile, ...experience } }, "cards");
  expect(screen.getByText(text)).toBeInTheDocument();
  expect(screen.queryAllByText(/Sin dato|Perfil sin completar/u)).toHaveLength(0);
});
it.each([
  { profile: { ...empty.profile, location: candidate.profile.location }, text: "Guadalajara, Jalisco" },
  { profile: { ...empty.profile, education: candidate.profile.education }, text: "Licenciatura o Ingeniería" },
  { profile: { ...empty.profile, languages: candidate.profile.languages }, text: "Inglés C1" },
  { profile: { ...empty.profile, skills: ["Go"] }, text: "Go" },
])("cards retain an isolated profile fact without inventing missing data: $text", ({ profile, text }) => {
  show({ ...empty, profile }, "cards");
  expect(screen.getByText(text)).toBeInTheDocument();
  expect(screen.queryAllByText(/Sin dato|Perfil sin completar/u)).toHaveLength(0);
});
it.each(["table", "cards"] as const)("uses the sheet's accent origin variant for both origins in %s", view => {
  render(<CandidateResults items={[candidate, { ...candidate, kind: "organic", full_name: "Ana Ríos" }]} view={view} languages={languages} />);
  expect(screen.getByText("Manual")).toHaveAttribute("data-variant", "accent");
  expect(screen.getByText("Orgánico")).toHaveAttribute("data-variant", "accent");
  expect(screen.getByText("Manual").className).toBe(screen.getByText("Orgánico").className);
});
it("keeps loading columns aligned with the merged results table", () => {
  const { container } = render(<CandidateResultsSkeleton view="table" />);
  expect(within(container).queryByText("Seniority")).not.toBeInTheDocument();
  expect(container.querySelectorAll("th")).toHaveLength(7);
});
