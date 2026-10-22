import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen as queries, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ManualIntakeSheet } from "./sheet";
import { submitManualCandidate } from "./upload";
import { checkDuplicatesAction } from "./actions";
import { boardFixture, vacancyId } from "../pipeline-movement/board-fixture";
// jsdom cannot model Base UI Select positioning/focus restoration; keep product
// labels, option lists and controlled changes while replacing only that boundary.
vi.mock("@/components/ui/select", async () => {
 const React = await import("react");
 const Context = React.createContext({ value: "", items: [] as { value: string; label: string }[], change: (value: string) => { void value; } });
 return {
  Select: ({ value, items, onValueChange, children }: { value: string; items: { value: string; label: string }[]; onValueChange: (value: string) => void; children: ReactNode }) => <Context.Provider value={{ value, items, change: onValueChange }}>{children}</Context.Provider>,
  SelectTrigger: (props: ComponentProps<"select">) => { const state = React.useContext(Context); return <select {...props} value={state.value ?? ""} onChange={event => state.change(event.target.value)}><option value="">Elige una opción</option>{state.items.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>; },
  SelectValue: () => null, SelectContent: () => null, SelectGroup: () => null, SelectItem: () => null,
 };
});
vi.mock("@/components/ui/combobox", async () => {
 const React = await import("react");
 type Item = { id?: string; code?: string; name: string };
 const Context = React.createContext({ value: null as Item | null, items: [] as Item[], change: (item: Item | null) => { void item; } });
 return {
  Combobox: ({ value, items, onValueChange, children }: { value: Item | null; items: Item[]; onValueChange: (item: Item | null) => void; children: ReactNode }) => <Context.Provider value={{ value, items, change: onValueChange }}>{children}</Context.Provider>,
  ComboboxInput: ({ id, disabled, ...props }: { id: string; disabled: boolean; "aria-invalid": boolean }) => { const state = React.useContext(Context); return <select id={id} disabled={disabled} aria-invalid={props["aria-invalid"]} value={state.value?.id ?? state.value?.code ?? ""} onChange={event => state.change(state.items.find(item => (item.id ?? item.code) === event.target.value) ?? null)}><option value="">Elige</option>{state.items.map(item => <option key={item.id ?? item.code} value={item.id ?? item.code}>{item.name}</option>)}</select>; },
  ComboboxContent: () => null, ComboboxEmpty: () => null, ComboboxList: () => null, ComboboxItem: () => null,
 };
});
vi.mock("@/features/languages/use-language-catalog", () => ({ useLanguageCatalog: () => ({ status: "success", data: { items: [{ code: "es", name: "Español" }, { code: "nah", name: "Náhuatl" }] } }) }));
vi.mock("./upload", () => ({ submitManualCandidate: vi.fn() }));
vi.mock("./actions", () => ({ checkDuplicatesAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
vi.mock("@/features/geo/use-geo-catalog", () => ({
 useGeoCatalog: () => ({ countries: { status: "success", data: { items: [{ id: "MX", name: "México" }, { id: "US", name: "Estados Unidos" }] } }, states: { status: "success", data: { items: [{ id: "09", name: "Ciudad de México" }] } }, municipalities: { status: "success", data: { items: [{ id: "09002", name: "Azcapotzalco" }] } } }),
 useGeoPostalCode: () => ({ status: "idle" }),
}));
// Required markers are visual; keep label assertions focused on their wording.
const normalizer = (value: string) => value.replace(/\s*\*$/, "").trim();
const screen = { ...queries, getByLabelText: (label: string | RegExp) => queries.getByLabelText(label, { normalizer }), queryByLabelText: (label: string | RegExp) => queries.queryByLabelText(label, { normalizer }) };
afterEach(cleanup);
beforeEach(() => { vi.resetAllMocks(); vi.mocked(checkDuplicatesAction).mockResolvedValue({ ok: true, data: { matches: [] } }); });
const success = vi.fn(); const viewExisting = vi.fn();
function mount() { return render(<ManualIntakeSheet vacancyId={vacancyId} stages={boardFixture().stages} onClose={vi.fn()} onSuccess={success} onViewExisting={viewExisting} />); }
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
function fill(country = "US") {
 change("Nombre completo", "Ana Nueva"); change("Correo electrónico", "ana@example.com"); change("País", country);
 change("Nivel", "bachelor"); fireEvent.change(within(screen.getByRole("group", { name: "Estudio 1" })).getByLabelText(/^Estatus/), { target: { value: "completed" } });
 fireEvent.change(screen.getByLabelText("CV"), { target: { files: [new File(["%PDF"], "cv.pdf", { type: "application/pdf" })] } });
}
async function submit() {
 fireEvent.click(screen.getByRole("button", { name: "Agregar candidato" }));
 const button = await screen.findByRole("button", { name: "Agregar" });
 await act(async () => { fireEvent.click(button); });
}
const match = { kind: "manual" as const, id: vacancyId, full_name: "Ana anterior", email_masked: "a***@example.com", phone_masked: null, last_vacancy: { id: vacancyId, title: "Ventas" }, last_added_at: "2026-10-21T12:00:00Z", in_this_process: false };

it("focuses the visible picker when CV is the only missing requirement", async () => {
 mount(); fill(); fireEvent.click(screen.getByRole("button", { name: "Quitar" }));
 fireEvent.click(screen.getByRole("button", { name: "Agregar candidato" }));
 await waitFor(() => expect(screen.getByRole("button", { name: "Elegir archivo" })).toHaveFocus());
 expect(screen.getByText("Revisa 1 dato marcado.")).toBeVisible();
});
it("composes the CV picker with change and remove actions", () => {
 mount(); expect(screen.getByRole("button", { name: "Elegir archivo" })).toBeVisible();
 expect(screen.getByText("PDF o Word (.docx), máximo 5 MB.")).toBeVisible();
 fill(); expect(screen.getByText("cv.pdf").closest('[data-slot="item"]')).not.toBeNull();
 expect(screen.getByRole("button", { name: "Cambiar" })).toBeVisible();
 fireEvent.click(screen.getByRole("button", { name: "Quitar" }));
 expect(screen.queryByText("cv.pdf")).not.toBeInTheDocument();
 expect(screen.getByRole("button", { name: "Elegir archivo" })).toBeVisible();
});
it("starts with an optional collapsed profile and labels required inputs", () => {
 mount(); expect(screen.getByText("* Obligatorio")).toBeVisible();
 for (const label of ["Nombre completo", "Correo electrónico", "Teléfono", "País", "CV", "Etapa de ingreso"]) {
  const control = screen.getByLabelText(label);
  expect(document.querySelector(`label[for="${control.id}"]`)).toHaveTextContent(/\*/);
 }
 const trigger = screen.getByRole("button", { name: /Perfil profesional \(opcional\)/ });
 expect(trigger).toHaveAttribute("aria-expanded", "false");
 // No count while nothing is filled: «0 datos» is noise.
 expect(trigger).not.toHaveTextContent(/\d+ datos?/);
 fireEvent.click(trigger);
 // The trigger already says «(opcional)»; no repeated description inside.
 expect(screen.queryByText("Estos datos son opcionales.")).toBeNull();
 expect(screen.getByText("Sin idiomas agregados.")).toBeVisible();
 expect(screen.getByText("Idiomas").closest("fieldset")).not.toBeNull();
 change("Título profesional", "Ingeniera");
 expect(trigger).toHaveTextContent("1 dato");
 change("Empresa actual o última", "Empresa");
 expect(trigger).toHaveTextContent("2 datos");
});
it.each(["required", "invalid", "not_allowed"] as const)("maps data.stage_id %s to the stage control", async code => {
 mount(); fill(); vi.mocked(submitManualCandidate).mockResolvedValue({ ok: false, reason: "validation_error", reference: { status: 400 }, fields: [{ field: "data.stage_id", code }] });
 await submit(); await waitFor(() => expect(screen.getByLabelText("Etapa de ingreso")).toHaveFocus());
 expect(screen.getByLabelText("Etapa de ingreso")).toHaveAttribute("aria-invalid", "true");
});
it("opens the optional profile before focusing a server-invalid field", async () => {
 mount(); fill(); vi.mocked(submitManualCandidate).mockResolvedValue({ ok: false, reason: "validation_error", reference: { status: 400 }, fields: [{ field: "candidate.professional_title", code: "invalid" }] });
 await submit();
 await waitFor(() => expect(screen.getByLabelText("Título profesional")).toHaveFocus());
 expect(screen.getByRole("button", { name: /Perfil profesional \(opcional\)/ })).toHaveAttribute("aria-expanded", "true");
});
it("shows one shared contact error, specific residence copy and a validation count", async () => {
 mount(); fireEvent.click(screen.getByRole("button", { name: "Agregar candidato" }));
 expect(screen.getByLabelText("Correo electrónico")).toHaveAttribute("aria-invalid", "true");
 expect(screen.getByLabelText("Teléfono")).toHaveAttribute("aria-invalid", "true");
 expect(screen.getAllByText("Agrega un correo o un teléfono.")).toHaveLength(1);
 expect(screen.getByText("Elige un país.")).toBeVisible();
 expect(screen.getByText(/Revisa \d+ datos marcados\./)).toBeVisible();
});
it("validates required controls and focuses name without sending", async () => {
 mount(); fireEvent.click(screen.getByRole("button", { name: "Agregar candidato" }));
 await waitFor(() => expect(screen.getByLabelText("Nombre completo")).toHaveFocus());
 expect(screen.getByText("Escribe el nombre completo.")).toBeVisible();
 expect(screen.getByText("Agrega un correo o un teléfono.")).toBeVisible();
 // The form opens with one study, so an empty submit marks its level and status (the collection itself is present).
 const study = within(screen.getByRole("group", { name: "Estudio 1" }));
 expect(study.getByLabelText(/^Nivel/)).toHaveAttribute("aria-invalid", "true");
 expect(study.getByLabelText(/^Estatus/)).toHaveAttribute("aria-invalid", "true");
 expect(screen.getByText("Selecciona un CV.")).toBeVisible();
 expect(submitManualCandidate).not.toHaveBeenCalled();
});
it("clears the CV error as soon as a file is chosen", async () => {
 mount(); fireEvent.click(screen.getByRole("button", { name: "Agregar candidato" }));
 await waitFor(() => expect(screen.getByText("Selecciona un CV.")).toBeVisible());
 fireEvent.change(screen.getByLabelText("CV"), { target: { files: [new File(["%PDF"], "cv.pdf", { type: "application/pdf" })] } });
 expect(screen.queryByText("Selecciona un CV.")).toBeNull();
 expect(screen.getByText(/Revisa \d+ datos marcados\./)).toBeVisible();
});
it("defaults to the first stage and exposes no private profile fields", () => {
 mount(); expect(screen.getByLabelText("Etapa de ingreso")).toHaveTextContent("Entrada");
 expect(screen.queryByLabelText(/nacimiento/i)).not.toBeInTheDocument();
 expect(screen.queryByLabelText(/salario/i)).not.toBeInTheDocument();
});
it("confirms discarding unsaved data", async () => {
 mount(); fireEvent.change(screen.getByLabelText("Nombre completo"), { target: { value: "Ana" } });
 fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
 expect(await screen.findByRole("button", { name: "Seguir editando" })).toBeVisible();
 expect(screen.getByRole("button", { name: "Descartar" })).toBeVisible();
});
it("checks a valid blurred contact and allows explicit existing selection", async () => {
 vi.mocked(checkDuplicatesAction).mockResolvedValue({ ok: true, data: { matches: [{ kind: "manual", id: vacancyId, full_name: "Ana anterior", email_masked: "a***@example.com", phone_masked: null, last_vacancy: { id: vacancyId, title: "Ventas" }, last_added_at: "2026-10-21T12:00:00Z", in_this_process: false }] } });
 mount(); const email = screen.getByLabelText("Correo electrónico");
 fireEvent.change(email, { target: { value: "ana@example.com" } }); fireEvent.blur(email);
 expect(await screen.findByText("Ana anterior")).toBeVisible();
 expect(screen.getByText("a***@example.com · Última vacante: Ventas")).toBeVisible();
 // The notice sits with the contact fields that triggered it, not after the CV at the end of the form.
 expect(screen.getByText("Posibles coincidencias").closest("fieldset")?.querySelector("legend")).toHaveTextContent("Datos de contacto");
 fireEvent.click(screen.getByRole("button", { name: "Usar el existente" }));
 expect(screen.queryByLabelText("Nombre completo")).not.toBeInTheDocument();
 expect(screen.getByLabelText("CV")).toBeVisible();
});
it("validates Mexican state and municipality but not subdivisions abroad", async () => {
 mount(); fill("MX"); fireEvent.click(screen.getByRole("button", { name: "Agregar candidato" }));
 const state = within(screen.getAllByRole("group", { name: "Residencia" })[0]).getByLabelText("Estado", { normalizer });
 await waitFor(() => expect(state).toHaveFocus());
 expect(state).toHaveAttribute("aria-invalid", "true");
 expect(screen.getByLabelText("Municipio")).toHaveAttribute("aria-invalid", "true");
 change("País", "US");
 vi.mocked(submitManualCandidate).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
 await submit(); await waitFor(() => expect(submitManualCandidate).toHaveBeenCalledOnce());
 expect(vi.mocked(submitManualCandidate).mock.calls[0][1].candidate?.residence).toEqual({ country: "US", state: null, municipality: null, postal_code: null });
});
it.each([["+52", "55 1234 5678", "+525512345678"], ["+1", "2025550100", "+12025550100"]])("sends E.164 %s and retains the intent key on retry", async (dial, phone, expected) => {
 mount(); fill(); change("Correo electrónico", ""); change("Lada de país", dial); change("Teléfono", phone);
 vi.mocked(submitManualCandidate).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
 await submit(); await screen.findByText("No hubo respuesta. Puedes reintentar sin duplicar el ingreso.");
 const first = vi.mocked(submitManualCandidate).mock.calls[0]; expect(first[1].candidate?.phone).toBe(expected);
 await submit(); await waitFor(() => expect(submitManualCandidate).toHaveBeenCalledTimes(2));
 expect(vi.mocked(submitManualCandidate).mock.calls[1][3]).toBe(first[3]);
});
it("409 duplicates require an explicit choice and new submit", async () => {
 mount(); fill(); vi.mocked(submitManualCandidate).mockResolvedValueOnce({ ok: false, reason: "possible_duplicates", reference: { status: 409 }, matches: [match] }).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
 await submit(); await screen.findByText("Ana anterior"); expect(submitManualCandidate).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByRole("button", { name: "Es otra persona, crear" })); expect(submitManualCandidate).toHaveBeenCalledOnce();
 await submit(); await waitFor(() => expect(submitManualCandidate).toHaveBeenCalledTimes(2));
 expect(vi.mocked(submitManualCandidate).mock.calls[1][1]).toMatchObject({ existing: null, confirmed_distinct: true, candidate: { full_name: "Ana Nueva" } });
});
it("existing selection sends candidate null and confirmed_distinct false", async () => {
 vi.mocked(checkDuplicatesAction).mockResolvedValue({ ok: true, data: { matches: [match] } });
 mount(); change("Correo electrónico", "ana@example.com"); fireEvent.blur(screen.getByLabelText("Correo electrónico"));
 fireEvent.click(await screen.findByRole("button", { name: "Usar el existente" }));
 fireEvent.change(screen.getByLabelText("CV"), { target: { files: [new File(["pdf"], "cv.pdf", { type: "application/pdf" })] } });
 vi.mocked(submitManualCandidate).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
 await submit(); await waitFor(() => expect(submitManualCandidate).toHaveBeenCalledOnce());
 expect(vi.mocked(submitManualCandidate).mock.calls[0][1]).toEqual({ stage_id: "new", existing: { kind: "manual", id: vacancyId }, candidate: null, confirmed_distinct: false });
});
it("maps 400 fields and focuses the first invalid in visual order", async () => {
 mount(); fill(); vi.mocked(submitManualCandidate).mockResolvedValue({ ok: false, reason: "validation_error", reference: { status: 400 }, fields: [{ field: "candidate.education[0].level", code: "invalid" }, { field: "candidate.full_name", code: "too_long" }] });
 await submit(); await waitFor(() => expect(screen.getByLabelText("Nombre completo")).toHaveFocus());
 expect(screen.getByLabelText(/^Nivel/)).toHaveAttribute("aria-invalid", "true");
});
it("offers Ver ficha with participation_id for an already present candidate", async () => {
 mount(); fill(); vi.mocked(submitManualCandidate).mockResolvedValue({ ok: false, reason: "candidate_already_in_process", reference: { status: 409 }, participationId: "existing-participation" });
 await submit(); fireEvent.click(await screen.findByRole("button", { name: "Ver ficha" })); expect(viewExisting).toHaveBeenCalledWith("existing-participation");
});
it("keeps the latest duplicate check when older responses arrive late", async () => {
 let finish!: (value: Awaited<ReturnType<typeof checkDuplicatesAction>>) => void;
 vi.mocked(checkDuplicatesAction).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ ok: true, data: { matches: [{ ...match, full_name: "Coincidencia nueva" }] } });
 mount(); change("Correo electrónico", "old@example.com"); fireEvent.blur(screen.getByLabelText("Correo electrónico"));
 await waitFor(() => expect(checkDuplicatesAction).toHaveBeenCalledOnce());
 change("Correo electrónico", "new@example.com"); fireEvent.blur(screen.getByLabelText("Correo electrónico"));
 await screen.findByText("Coincidencia nueva");
 await act(async () => finish({ ok: true, data: { matches: [{ ...match, full_name: "Coincidencia vieja" }] } }));
 expect(screen.queryByText("Coincidencia vieja")).not.toBeInTheDocument();
});
it("disables using a match already in this process", async () => {
 vi.mocked(checkDuplicatesAction).mockResolvedValue({ ok: true, data: { matches: [{ ...match, in_this_process: true }] } });
 mount(); change("Correo electrónico", "ana@example.com"); fireEvent.blur(screen.getByLabelText("Correo electrónico"));
 expect(await screen.findByText("Ya está en este proceso")).toBeVisible(); expect(screen.getByRole("button", { name: "Usar el existente" })).toBeDisabled();
});
it.each([["+52", "123456789"], ["+1", "12345"], ["52", "5512345678"]])("rejects an invalid phone %s/%s", async (dial, phone) => {
 mount(); fill(); change("Lada de país", dial); change("Teléfono", phone); fireEvent.click(screen.getByRole("button", { name: "Agregar candidato" }));
 await waitFor(() => expect(screen.getByLabelText("Teléfono")).toHaveFocus()); expect(submitManualCandidate).not.toHaveBeenCalled();
});
it.each([["cv.exe", "application/x-msdownload", 5], ["cv.pdf", "application/pdf", 5_242_881], ["cv.pdf", "application/pdf", 0]])("validates CV %s/%s/%s before submission", async (name, type, size) => {
 mount(); fill(); const file = new File([new Uint8Array(size)], name, { type }); fireEvent.change(screen.getByLabelText("CV"), { target: { files: [file] } });
 fireEvent.click(screen.getByRole("button", { name: "Agregar candidato" })); await waitFor(() => expect(screen.getByRole("button", { name: "Cambiar" })).toHaveFocus()); expect(submitManualCandidate).not.toHaveBeenCalled();
});
it.each(["01", "1.50", "60.5", "61", "-1", "1e1"])("rejects experience %s", async value => {
 mount(); fill(); fireEvent.click(screen.getByRole("button", { name: /Perfil profesional \(opcional\)/ })); change("Años de experiencia", value); fireEvent.click(screen.getByRole("button", { name: "Agregar candidato" }));
 await waitFor(() => expect(screen.getByLabelText("Años de experiencia")).toHaveFocus()); expect(submitManualCandidate).not.toHaveBeenCalled();
});
it("sends harmonized studies, decimal experience, seniority and catalog languages", async () => {
 mount(); fill();
 expect(screen.queryByLabelText("Nivel máximo de estudios")).toBeNull();
 expect(screen.getByText("Estudios")).toHaveTextContent("Estudios *");
 expect(document.querySelector('[data-slot="card"]')).toBeNull();
 change("Institución", " UNAM "); change("Carrera o campo", " Computación "); change("Año de inicio", "2015"); change("Año de fin", "2020");
 fireEvent.click(screen.getByRole("button", { name: /Perfil profesional \(opcional\)/ }));
 expect(screen.queryByLabelText("Campo de estudio")).toBeNull();
 expect(screen.getByText("Puedes usar decimales, por ejemplo 1.5.")).toBeVisible();
 change("Años de experiencia", "1.5"); change("Seniority", "semi_senior");
 fireEvent.click(screen.getByRole("button", { name: "Agregar idioma" }));
 change("Idioma 1", "nah"); change("Nivel del idioma 1", "native");
 expect(screen.getByRole("button", { name: /Perfil profesional/ })).toHaveTextContent("3 datos");
 vi.mocked(submitManualCandidate).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
 await submit();
 const candidate = vi.mocked(submitManualCandidate).mock.calls[0][1].candidate!;
 expect(candidate).toMatchObject({ years_of_experience: "1.5", seniority: "semi_senior", education: [{ level: "bachelor", institution: "UNAM", field: "Computación", status: "completed", start_year: 2015, end_year: 2020 }], languages: [{ code: "nah", level: "native" }] });
 for (const key of ["education_level", "field_of_study", "experience_years"]) expect(candidate).not.toHaveProperty(key);
});
it("clears the end year on switching to ongoing and preserves the embedded intake editors", async () => {
 mount(); fill(); change("Año de fin", "2024");
 change("Estatus", "in_progress");
 expect(screen.queryByLabelText("Año de fin")).toBeNull();
 change("Estatus", "paused");
 expect(screen.getByLabelText("Año de fin")).toHaveValue(null);
 change("Estatus", "incomplete"); change("Año de fin", "2023");
 expect(screen.getByLabelText("Año de fin")).toHaveValue(2023);
 change("Estatus", "in_progress");
 const study = screen.getByRole("group", { name: "Estudio 1" });
 expect(study.closest('[data-slot="card"]')).toBeNull();
 expect(within(study).getByRole("button", { name: "Quitar estudio 1" })).toHaveTextContent(/^Quitar$/);
 fireEvent.click(screen.getByRole("button", { name: /Perfil profesional/ }));
 fireEvent.click(screen.getByRole("button", { name: "Agregar idioma" }));
 change("Idioma 1", "es"); change("Nivel del idioma 1", "native");
 expect(screen.getByRole("button", { name: "Quitar idioma 1" }).closest('[data-pf-profile-language-grid]')).toContainElement(screen.getByLabelText("Idioma 1"));
 vi.mocked(submitManualCandidate).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
 await submit();
 expect(vi.mocked(submitManualCandidate).mock.calls[0][1].candidate).toMatchObject({ education: [expect.objectContaining({ status: "in_progress", end_year: null })], languages: [{ code: "es", level: "native" }] });
});
it("focuses the education add action when there are no studies", async () => {
 mount(); fill(); fireEvent.click(screen.getByRole("button", { name: "Quitar estudio 1" }));
 fireEvent.click(screen.getByRole("button", { name: "Agregar candidato" }));
 expect(screen.getByText("Agrega al menos un estudio.")).toBeVisible();
 await waitFor(() => expect(screen.getByRole("button", { name: "Agregar estudio" })).toHaveFocus());
});
it.each(["candidate.education[0].status", "candidate.languages[0].code", "candidate.languages[0].level", "candidate.years_of_experience", "candidate.seniority"])("maps H2 server error %s", async field => {
 mount(); fill(); fireEvent.click(screen.getByRole("button", { name: /Perfil profesional/ }));
 fireEvent.click(screen.getByRole("button", { name: "Agregar idioma" })); change("Idioma 1", "es"); change("Nivel del idioma 1", "native");
 fireEvent.click(screen.getByRole("button", { name: /Perfil profesional/ }));
 vi.mocked(submitManualCandidate).mockResolvedValue({ ok: false, reason: "validation_error", reference: { status: 400 }, fields: [{ field, code: "invalid" }] });
 await submit();
 const label = field.includes("education") ? "Estatus" : field.endsWith(".code") ? "Idioma 1" : field.endsWith(".level") ? "Nivel del idioma 1" : field.endsWith("seniority") ? "Seniority" : "Años de experiencia";
 await waitFor(() => expect(screen.getByLabelText(label)).toHaveFocus());
 expect(screen.getByLabelText(label)).toHaveAttribute("aria-invalid", "true");
 if (!field.includes("education")) expect(screen.getByRole("button", { name: /Perfil profesional/ })).toHaveAttribute("aria-expanded", "true");
});
it("limits studies to ten and lets a removed slot be reused", () => {
 mount();
 for (let i = 0; i < 10; i++) fireEvent.click(screen.getByRole("button", { name: "Agregar estudio" }));
 expect(screen.getByRole("button", { name: "Agregar estudio" })).toBeDisabled();
 expect(screen.getAllByRole("group", { name: /^Estudio \d+$/ })).toHaveLength(10);
 fireEvent.click(screen.getByRole("button", { name: "Quitar estudio 3" }));
 expect(screen.getByRole("button", { name: "Agregar estudio" })).toBeEnabled();
});
it.each([
 ["completed", "2025", "2020"], ["paused", "1949", ""], ["incomplete", "", "2101"],
])("rejects invalid study dates for %s (%s–%s)", async (status, start, end) => {
 mount(); fill(); change("Estatus", status); change("Año de inicio", start); change("Año de fin", end);
 fireEvent.click(screen.getByRole("button", { name: "Agregar candidato" }));
 const label = start === "1949" ? "Año de inicio" : "Año de fin";
 await waitFor(() => expect(screen.getByLabelText(label)).toHaveFocus());
 expect(submitManualCandidate).not.toHaveBeenCalled();
});
it.each(["0", "0.5", "60", "60.0"])("sends valid decimal string %s unchanged", async value => {
 mount(); fill(); fireEvent.click(screen.getByRole("button", { name: /Perfil profesional/ })); change("Años de experiencia", value);
 vi.mocked(submitManualCandidate).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
 await submit(); expect(vi.mocked(submitManualCandidate).mock.calls[0][1].candidate?.years_of_experience).toBe(value);
});
it("sends two independent studies with optional values as null", async () => {
 mount(); fill(); fireEvent.click(screen.getByRole("button", { name: "Agregar estudio" }));
 const study = within(screen.getByRole("group", { name: "Estudio 2" }));
 fireEvent.change(study.getByLabelText(/^Nivel/), { target: { value: "tsu" } });
 fireEvent.change(study.getByLabelText(/^Estatus/), { target: { value: "paused" } });
 vi.mocked(submitManualCandidate).mockResolvedValue({ ok: false, reason: "no_response", reference: {} });
 await submit();
 expect(vi.mocked(submitManualCandidate).mock.calls[0][1].candidate).toMatchObject({ years_of_experience: null, seniority: null, languages: [], education: [{ level: "bachelor", institution: null, field: null, status: "completed", start_year: null, end_year: null }, { level: "tsu", institution: null, field: null, status: "paused", start_year: null, end_year: null }] });
});
it("maps a required education collection error to the editor action", async () => {
 mount(); fill(); vi.mocked(submitManualCandidate).mockResolvedValue({ ok: false, reason: "validation_error", reference: { status: 400 }, fields: [{ field: "candidate.education", code: "required" }] });
 await submit(); expect(screen.getByText("Agrega al menos un estudio.")).toBeVisible();
 await waitFor(() => expect(screen.getByLabelText(/^Nivel/)).toHaveFocus());
});
it("focuses years before seniority regardless of server declaration order", async () => {
 mount(); fill(); vi.mocked(submitManualCandidate).mockResolvedValue({ ok: false, reason: "validation_error", reference: { status: 400 }, fields: [{ field: "candidate.seniority", code: "invalid" }, { field: "candidate.years_of_experience", code: "invalid" }] });
 await submit(); await waitFor(() => expect(screen.getByLabelText("Años de experiencia")).toHaveFocus());
 expect(screen.getByLabelText("Seniority")).toHaveAttribute("aria-invalid", "true");
});
it("maps indexed errors to the second study without marking the first", async () => {
 mount(); fill(); fireEvent.click(screen.getByRole("button", { name: "Agregar estudio" }));
 const second = within(screen.getByRole("group", { name: "Estudio 2" }));
 fireEvent.change(second.getByLabelText(/^Nivel/), { target: { value: "master" } });
 fireEvent.change(second.getByLabelText(/^Estatus/), { target: { value: "in_progress" } });
 vi.mocked(submitManualCandidate).mockResolvedValue({ ok: false, reason: "validation_error", reference: { status: 400 }, fields: [{ field: "candidate.education[1].status", code: "invalid" }] });
 await submit(); await waitFor(() => expect(second.getByLabelText(/^Estatus/)).toHaveFocus());
 expect(within(screen.getByRole("group", { name: "Estudio 1" })).getByLabelText(/^Estatus/)).toHaveAttribute("aria-invalid", "false");
});
it("validates partial language rows and excludes already selected catalog codes", async () => {
 mount(); fill(); fireEvent.click(screen.getByRole("button", { name: /Perfil profesional/ }));
 fireEvent.click(screen.getByRole("button", { name: "Agregar idioma" })); change("Idioma 1", "es"); change("Nivel del idioma 1", "native");
 fireEvent.click(screen.getByRole("button", { name: "Agregar idioma" }));
 expect(screen.getByLabelText("Idioma 2")).not.toHaveTextContent("Español");
 fireEvent.click(screen.getByRole("button", { name: "Agregar candidato" }));
 await waitFor(() => expect(screen.getByLabelText("Idioma 2")).toHaveFocus());
 expect(screen.getByLabelText("Nivel del idioma 2")).toHaveAttribute("aria-invalid", "true");
 expect(submitManualCandidate).not.toHaveBeenCalled();
});
it("maps second-language server errors and opens the collapsed profile", async () => {
 mount(); fill(); fireEvent.click(screen.getByRole("button", { name: /Perfil profesional/ }));
 fireEvent.click(screen.getByRole("button", { name: "Agregar idioma" })); change("Idioma 1", "es"); change("Nivel del idioma 1", "native");
 fireEvent.click(screen.getByRole("button", { name: "Agregar idioma" })); change("Idioma 2", "nah"); change("Nivel del idioma 2", "B2");
 fireEvent.click(screen.getByRole("button", { name: /Perfil profesional/ }));
 vi.mocked(submitManualCandidate).mockResolvedValue({ ok: false, reason: "validation_error", reference: { status: 400 }, fields: [{ field: "candidate.languages[1].code", code: "invalid" }] });
 await submit(); await waitFor(() => expect(screen.getByLabelText("Idioma 2")).toHaveFocus());
 expect(screen.getByLabelText("Idioma 1")).toHaveAttribute("aria-invalid", "false");
});
it("excludes Placement and Descartados from stage choices", () => {
 mount(); expect(screen.getByLabelText("Etapa de ingreso")).not.toHaveTextContent(/Contratación|Descartados/);
});
it.each([
 ["process_finished", "El proceso finalizó. No puedes agregar candidatos."],
 ["vacancy_not_published", "Publica la vacante antes de agregar candidatos."],
 ["cv_content_mismatch", "El contenido del CV no coincide con su formato."],
 ["cv_unsupported_type", "Sube un PDF o un documento de Word (.docx)."],
 ["cv_too_large", "El CV pesa más de 5 MB."],
 ["cv_storage_unavailable", "No pudimos guardar el CV. Intenta de nuevo."],
])("shows the dedicated %s message", async (reason, message) => {
 mount(); fill(); vi.mocked(submitManualCandidate).mockResolvedValue({ ok: false, reason, reference: { code: reason } }); await submit();
 await waitFor(() => expect(screen.getAllByText(message).length).toBeGreaterThan(0));
});
it("stacks the footer status above the actions on small screens instead of squeezing it", () => {
 mount();
 const footer = document.querySelector('[data-slot="sheet-footer"]')!;
 expect(footer.className).toContain("max-sm:[&_[data-pf-action-bar]]:flex-col");
 expect(footer.className).not.toContain("wrap-anywhere");
});
it("remounts the field block on the new/existing switch so Chromium lays out stage and CV again", () => {
 // jsdom has no layout: the browser bug (stage and CV at zero height after «Usar el existente») is pinned by source.
 const source = readFileSync(join(process.cwd(), "src/features/manual-intake/sheet.tsx"), "utf8");
 expect(source).toContain('<IntakeFields key={existing ? "existing" : "new"}');
});
it("opens with one study ready because at least one is required", () => {
 mount();
 expect(screen.getByRole("group", { name: "Estudio 1" })).toBeVisible();
 expect(screen.getByText("Estudio 1", { selector: "span" })).toBeVisible();
});
