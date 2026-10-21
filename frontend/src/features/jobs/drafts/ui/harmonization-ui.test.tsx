import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LocalDraftForm } from "./local-draft-form";
import { PublicJobDetailView } from "../../components/PublicJobDetailView";
import { vacancyDetail } from "../../api/public-fixtures";
import { saveDraftV2Action } from "../actions";
import { createDraftModel } from "../model";
import { initialDraftFormState } from "./draft-form-state";
import { draftToPublicDetail } from "./draft-public-detail";
vi.setConfig({ testTimeout: 30000 });
vi.mock("../actions", () => ({ saveDraftV2Action: vi.fn() }));
vi.mock("../pipeline/publication-actions", () => ({ loadDraftPublicationAction: vi.fn().mockResolvedValue({ ok: false }), publishDraftAction: vi.fn() }));
vi.mock("@/features/geo/use-geo-catalog", () => ({ useGeoCatalog: () => ({ countries: { status: "success", data: { items: [] } }, states: { status: "success", data: { items: [] } }, municipalities: { status: "success", data: { items: [] } } }), useGeoPostalCode: () => ({ status: "idle" }) }));
vi.mock("@/features/languages/use-language-catalog", () => ({ useLanguageCatalog: () => ({ status: "success", data: { items: [{ code: "en", name: "Inglés" }] }, retry: vi.fn() }) }));
vi.mock("@/components/ui/combobox", async original => ({ ...await original<typeof import("@/components/ui/combobox")>(), ComboboxContent: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ui/select", async original => ({ ...await original<typeof import("@/components/ui/select")>(), SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("sileo", () => ({ sileo: { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("places minimum experience and education in requirements without publication markers", () => {
  render(<LocalDraftForm />);
  fireEvent.click(screen.getByRole("tab", { name: "Descripción y perfil" }));
  expect(screen.getByLabelText("Experiencia mínima (años)")).toHaveValue("");
  expect(screen.getByText("Mínimo requerido; puedes usar decimales, por ejemplo 1.5.")).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Estudios mínimos" })).toBeVisible();
  expect(screen.getByRole("checkbox", { name: "Acepta estudios en curso" })).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Agregar idioma" }));
  expect(screen.getByRole("combobox", { name: "Idioma 1" })).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Nivel mínimo del idioma 1" })).toBeVisible();
});
it("lets an optional minimum education be cleared after selection", () => {
  const model = createDraftModel(); model.fields.min_education_level = "bachelor";
  render(<LocalDraftForm initialModel={model} />);
  fireEvent.click(screen.getByRole("tab", { name: "Descripción y perfil" }));
  const control = screen.getByRole("combobox", { name: "Estudios mínimos" });
  const field = control.closest('[data-slot="field"]') as HTMLElement;
  expect(within(field).getByRole("option", { name: "Sin especificar" })).toBeTruthy();
});
it("projects requirements into the draft public preview and handles singular/native", () => {
  const model = createDraftModel();
  Object.assign(model.fields, { seniority: "director", languages: [{ code: "en", min_level: "native" }], min_years_of_experience: "1.0", min_education_level: "bachelor", accepts_in_progress_education: false });
  render(<PublicJobDetailView preview job={draftToPublicDetail(initialDraftFormState(model))} />);
  expect(screen.getByText("Director")).toBeVisible();
  expect(screen.getByText("Idiomas: Inglés Nativo")).toBeVisible();
  expect(screen.getByText("Experiencia mínima: 1 año")).toBeVisible();
  expect(screen.getByText("Estudios: Licenciatura o Ingeniería concluida")).toBeVisible();
});
it("shows catalog language minima, decimal years and completed education publicly", () => {
  const job = { ...vacancyDetail, seniority: "semi_senior" as const, requirements_profile: { languages: [{ code: "en", min_level: "B2" as const }], min_years_of_experience: "1.5", min_education_level: "bachelor" as const, accepts_in_progress_education: true } };
  render(<PublicJobDetailView job={job} />);
  expect(screen.getByText("Semi-senior")).toBeVisible();
  expect(screen.getByText("Idiomas: Inglés B2 o más")).toBeVisible();
  expect(screen.getByText("Experiencia mínima: 1.5 años")).toBeVisible();
  expect(screen.getByText("Estudios: Licenciatura o Ingeniería concluida (acepta en curso)")).toBeVisible();
});
it.each([
  ["fields.seniority", "Nivel"],
  ["fields.min_education_level", "Estudios mínimos"],
  ["fields.accepts_in_progress_education", "Acepta estudios en curso"],
  ["fields.languages", "Idiomas requeridos"],
  ["fields.languages[0].code", "Idioma 1"],
  ["fields.languages[0].min_level", "Nivel mínimo del idioma 1"],
] as const)("focuses and annotates server path %s", async (field, label) => {
  const model = createDraftModel(); model.fields.languages = [{ code: "en", min_level: "B2" }];
  vi.mocked(saveDraftV2Action).mockResolvedValue({ ok: false, reason: "invalid_request", reference: { status: 400, code: "validation_error" }, fields: [{ field, code: "invalid" }] });
  render(<LocalDraftForm initialModel={model} initialScreeningQuestionsV2={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
  const control = await screen.findByRole(label === "Acepta estudios en curso" ? "checkbox" : label === "Idiomas requeridos" ? "group" : "combobox", { name: label });
  await waitFor(() => expect(control).toHaveFocus());
  expect(control).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByText("Revisa este dato.")).toHaveAttribute("data-slot", "field-error");
});
it("routes server requirement errors and focuses the first visually invalid control", async () => {
  vi.mocked(saveDraftV2Action).mockResolvedValue({ ok: false, reason: "invalid_request", reference: { status: 400, code: "validation_error" }, fields: [{ field: "languages[0].min_level", code: "invalid" }, { field: "min_years_of_experience", code: "invalid" }] });
  render(<LocalDraftForm />);
  fireEvent.click(screen.getByRole("tab", { name: "Descripción y perfil" }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
  await waitFor(() => expect(saveDraftV2Action).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByLabelText("Experiencia mínima (años)")).toHaveFocus());
  expect(screen.getByLabelText("Experiencia mínima (años)")).toHaveAttribute("aria-invalid", "true");
});
