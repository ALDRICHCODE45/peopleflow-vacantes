import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen as queries, waitFor } from "@testing-library/react";
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
 type Item = { id: string; name: string };
 const Context = React.createContext({ value: null as Item | null, items: [] as Item[], change: (item: Item | null) => { void item; } });
 return {
  Combobox: ({ value, items, onValueChange, children }: { value: Item | null; items: Item[]; onValueChange: (item: Item | null) => void; children: ReactNode }) => <Context.Provider value={{ value, items, change: onValueChange }}>{children}</Context.Provider>,
  ComboboxInput: ({ id, disabled, ...props }: { id: string; disabled: boolean; "aria-invalid": boolean }) => { const state = React.useContext(Context); return <select id={id} disabled={disabled} aria-invalid={props["aria-invalid"]} value={state.value?.id ?? ""} onChange={event => state.change(state.items.find(item => item.id === event.target.value) ?? null)}><option value="">Elige</option>{state.items.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>; },
  ComboboxContent: () => null, ComboboxEmpty: () => null, ComboboxList: () => null, ComboboxItem: () => null,
 };
});
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
 change("Nivel máximo de estudios", "bachelor");
 fireEvent.change(screen.getByLabelText("CV"), { target: { files: [new File(["%PDF"], "cv.pdf", { type: "application/pdf" })] } });
}
async function submit() {
 fireEvent.click(screen.getByRole("button", { name: "Agregar candidato" }));
 const button = await screen.findByRole("button", { name: "Agregar" });
 await act(async () => { fireEvent.click(button); });
}
const match = { kind: "manual" as const, id: vacancyId, full_name: "Ana anterior", email_masked: "a***@example.com", phone_masked: null, last_vacancy: "Ventas", last_added_at: "2026-10-21T12:00:00Z", in_this_process: false };

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
 for (const label of ["Nombre completo", "Correo electrónico", "Teléfono", "País", "Nivel máximo de estudios", "CV", "Etapa de ingreso"]) {
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
 expect(screen.getByText("Selecciona el nivel de estudios.")).toBeVisible();
 expect(screen.getByText("Selecciona un CV.")).toBeVisible();
 expect(submitManualCandidate).not.toHaveBeenCalled();
});
it("clears the CV error as soon as a file is chosen", async () => {
 mount(); fireEvent.click(screen.getByRole("button", { name: "Agregar candidato" }));
 await waitFor(() => expect(screen.getByText("Selecciona un CV.")).toBeVisible());
 fireEvent.change(screen.getByLabelText("CV"), { target: { files: [new File(["%PDF"], "cv.pdf", { type: "application/pdf" })] } });
 expect(screen.queryByText("Selecciona un CV.")).toBeNull();
 expect(screen.getByText("Revisa 4 datos marcados.")).toBeVisible();
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
 vi.mocked(checkDuplicatesAction).mockResolvedValue({ ok: true, data: { matches: [{ kind: "manual", id: vacancyId, full_name: "Ana anterior", email_masked: "a***@example.com", phone_masked: null, last_vacancy: "Ventas", last_added_at: "2026-10-21T12:00:00Z", in_this_process: false }] } });
 mount(); const email = screen.getByLabelText("Correo electrónico");
 fireEvent.change(email, { target: { value: "ana@example.com" } }); fireEvent.blur(email);
 expect(await screen.findByText("Ana anterior")).toBeVisible();
 fireEvent.click(screen.getByRole("button", { name: "Usar el existente" }));
 expect(screen.queryByLabelText("Nombre completo")).not.toBeInTheDocument();
 expect(screen.getByLabelText("CV")).toBeVisible();
});
it("validates Mexican state and municipality but not subdivisions abroad", async () => {
 mount(); fill("MX"); fireEvent.click(screen.getByRole("button", { name: "Agregar candidato" }));
 await waitFor(() => expect(screen.getByLabelText("Estado")).toHaveFocus());
 expect(screen.getByLabelText("Estado")).toHaveAttribute("aria-invalid", "true");
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
 mount(); fill(); vi.mocked(submitManualCandidate).mockResolvedValue({ ok: false, reason: "validation_error", reference: { status: 400 }, fields: [{ field: "candidate.education_level", code: "invalid" }, { field: "candidate.full_name", code: "too_long" }] });
 await submit(); await waitFor(() => expect(screen.getByLabelText("Nombre completo")).toHaveFocus());
 expect(screen.getByLabelText("Nivel máximo de estudios")).toHaveAttribute("aria-invalid", "true");
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
it.each(["0.5", "61", "-1"])("rejects experience %s", async value => {
 mount(); fill(); fireEvent.click(screen.getByRole("button", { name: /Perfil profesional \(opcional\)/ })); change("Años de experiencia", value); fireEvent.click(screen.getByRole("button", { name: "Agregar candidato" }));
 await waitFor(() => expect(screen.getByLabelText("Años de experiencia")).toHaveFocus()); expect(submitManualCandidate).not.toHaveBeenCalled();
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
