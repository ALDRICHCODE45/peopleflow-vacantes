import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProfileWorkspace } from "./profile-workspace";
import { CANDIDATE_IDENTITY, CANDIDATE_PROFILE } from "./prototype-candidate";
import { profileToDraft, parseProfileDraft } from "./profile-draft";
import { profileToWrite } from "./profile-adapter";
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), notify: vi.fn() }));
vi.mock("./profile-actions", () => ({ loadProfileAction: mocks.load, saveProfileAction: mocks.save }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: mocks.notify, dismissActionResult: vi.fn() }));
vi.mock("@/features/identity/identity-session", () => ({ useIdentity: () => ({ status: "ready", result: { ok: true, data: { role: "candidate", user: { id: "6f1a3c2e-9b4d-4e7a-8c2f-5d3b1a9e7f04", email: "ximena.barrera@correo.mx", full_name: "Ximena Barrera" } } } }) }));
vi.mock("@/features/geo/use-geo-catalog", () => ({
  useGeoCatalog: () => ({ countries: { status: "success", data: { items: [{ id: "MX", name: "México" }] }, retry: vi.fn() }, states: { status: "success", data: { items: [{ id: "09", name: "Ciudad de México" }] }, retry: vi.fn() }, municipalities: { status: "success", data: { items: [] }, retry: vi.fn() } }),
  useGeoPostalCode: () => ({ status: "idle" }),
}));
const valid = parseProfileDraft(profileToDraft(CANDIDATE_PROFILE), CANDIDATE_PROFILE);
if (!valid.ok) throw new Error("Invalid fixture");
const wire = { ...profileToWrite(valid.profile), user_id: CANDIDATE_IDENTITY.userId, location: CANDIDATE_PROFILE.location, created_at: CANDIDATE_PROFILE.createdAt, updated_at: CANDIDATE_PROFILE.updatedAt };
const loaded = { ok: true, data: { profile: wire, languages: { languages: CANDIDATE_PROFILE.languages } } };
const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => fireEvent.click(screen.getByRole("button", { name: "Guardar perfil" }));
async function ready() { const view = render(<ProfileWorkspace />); await screen.findByRole("button", { name: "Guardar perfil" }); return view; }
beforeEach(() => { vi.resetAllMocks(); mocks.load.mockResolvedValue(loaded); mocks.save.mockResolvedValue({ kind: "saved", profile: { ...wire, phone: "12345678" } }); });
afterEach(cleanup);
describe("live candidate profile", () => {
  it("loads a form-shaped skeleton without fixture data, then the server profile", async () => {
    let resolve!: (value: unknown) => void; mocks.load.mockReturnValue(new Promise(r => { resolve = r; }));
    const { container } = render(<ProfileWorkspace />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando perfil");
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(3);
    expect(screen.queryByText(CANDIDATE_IDENTITY.fullName)).not.toBeInTheDocument();
    await act(async () => resolve(loaded));
    expect(screen.getByLabelText("Teléfono")).toHaveValue(CANDIDATE_PROFILE.phone);
    expect(screen.getByRole("button", { name: "Guardar perfil" })).toBeDisabled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it("opens an empty editor for a missing profile and creates it even with only language changes", async () => {
    mocks.load.mockResolvedValue({ ok: true, data: { profile: null, languages: { languages: [{ name: "english", level: "B2" }] } } });
    const empty = Object.fromEntries(Object.keys(profileToWrite(valid.profile)).map(key => [key, key === "skills" ? [] : key === "salary_currency" ? "MXN" : null]));
    const created = { ...wire, ...empty };
    mocks.save.mockResolvedValueOnce({ kind: "saved", profile: created, languages: { languages: [{ name: "french", level: "B2" }] } });
    await ready();
    expect(screen.getByText("Completa tu perfil para postularte más rápido. Se crea al guardar por primera vez.")).toBeInTheDocument();
    expect(screen.queryByText("Todavía no tienes perfil")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Teléfono")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Guardar perfil" })).toBeEnabled();
    tab("Compensación"); expect(screen.getByLabelText("Moneda")).toHaveValue("MXN");
    tab("Idiomas"); change("Nombre del idioma 1", "French"); save();
    await screen.findByText("Perfil creado.");
    expect(mocks.save).toHaveBeenCalledWith({ profile: empty, languages: { languages: [{ name: "french", level: "B2" }] } });
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Perfil creado." }));
    expect(screen.queryByText(/Se crea al guardar por primera vez/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar perfil" })).toBeDisabled();
    mocks.save.mockResolvedValueOnce({ kind: "saved", profile: { ...created, phone: "12345678" } });
    tab("Personal"); change("Teléfono", "12345678"); save();
    await screen.findByText("Perfil guardado.");
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Perfil guardado." }));
    expect(mocks.save.mock.calls[1][0]).toEqual({ profile: { ...empty, phone: "12345678" } });
  });
  it.each(["unauthenticated", "no_response", "forbidden"])("keeps the error Empty for %s", async reason => {
    mocks.load.mockResolvedValue({ ok: false, reason, reference: {} });
    const { container } = render(<ProfileWorkspace />);
    expect(await screen.findByText("No pudimos cargar tu perfil")).toBeInTheDocument();
    expect(container.querySelector('[data-slot="empty"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Guardar perfil" })).not.toBeInTheDocument();
    expect(screen.getByRole(reason === "unauthenticated" ? "link" : "button", { name: reason === "unauthenticated" ? "Iniciar sesión" : "Reintentar" })).toBeInTheDocument();
  });
  it("offers an explicit read retry without writes", async () => {
    mocks.load.mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} });
    render(<ProfileWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
    await screen.findByRole("button", { name: "Guardar perfil" });
    expect(mocks.load).toHaveBeenCalledTimes(2); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("keeps native cards, five tabs, one form, meaningful headings and optional geo helper", async () => {
    const { container } = await ready();
    expect(container.querySelectorAll("form")).toHaveLength(1);
    expect(container.querySelector("form")).toHaveAttribute("novalidate");
    expect(screen.getAllByRole("tab").map(node => node.textContent)).toEqual(["Personal", "Experiencia", "Educación", "Compensación", "Idiomas"]);
    expect(screen.getByRole("heading", { name: CANDIDATE_IDENTITY.fullName })).toBeInTheDocument();
    expect(screen.getByText("Opcional. Algunas vacantes solo aceptan postulantes de ciertos países.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Código postal")).not.toBeInTheDocument();
    expect(container.querySelector('[data-pf-profile-context]')).toHaveTextContent(wire.location!.label);
    expect(screen.queryByLabelText("Ciudad de residencia")).not.toBeInTheDocument();
    expect(container.querySelector('[data-pf-profile-card] > [data-slot="card-header"] > [data-slot="card-action"]')).not.toBeNull();
  });
  it("sends a complete replacement for one changed field, not a patch, and confirms the new baseline", async () => {
    await ready(); change("Teléfono", "12345678"); save();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][0]).toEqual({ profile: { ...profileToWrite(valid.profile), phone: "12345678" } });
    await screen.findByText("Perfil guardado.");
    expect(screen.getByRole("button", { name: "Guardar perfil" })).toBeDisabled();
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Perfil guardado." }));
  });
  it("clears optional location with null and does not silently reinstate MX", async () => {
    await ready(); fireEvent.click(screen.getByRole("button", { name: "Quitar ubicación" })); save();
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0][0].profile.location).toBeNull();
  });
  it("retains edits across tabs and reset restores the confirmed baseline", async () => {
    await ready(); change("Teléfono", "12345678"); tab("Experiencia"); change("Título profesional", "Nuevo título"); tab("Personal");
    expect(screen.getByLabelText("Teléfono")).toHaveValue("12345678");
    fireEvent.click(screen.getByRole("button", { name: "Restaurar cambios" }));
    expect(screen.getByLabelText("Teléfono")).toHaveValue(CANDIDATE_PROFILE.phone);
    tab("Experiencia"); expect(screen.getByLabelText("Título profesional")).toHaveValue(CANDIDATE_PROFILE.professionalTitle);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("validates all tabs and focuses the first error without a write", async () => {
    await ready(); change("Perfil de LinkedIn", "not-url"); tab("Compensación"); change("Moneda", ""); save();
    expect(await screen.findByLabelText("Perfil de LinkedIn")).toHaveFocus();
    expect(screen.getByLabelText("Perfil de LinkedIn")).toHaveAttribute("aria-invalid", "true");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects a language with empty level before writing either block", async () => {
    await ready(); change("Teléfono", "12345678"); tab("Idiomas"); fireEvent.click(screen.getByRole("button", { name: "Agregar idioma" })); change("Nombre del idioma 3", "French"); save();
    expect(screen.getByLabelText("Nivel del idioma 3")).toHaveAttribute("aria-invalid", "true");
    expect(document.querySelector("#profile-language-2-level")).toHaveFocus(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("locks controls and double submissions during a write", async () => {
    let resolve!: (value: unknown) => void; mocks.save.mockReturnValue(new Promise(r => { resolve = r; }));
    await ready(); change("Teléfono", "12345678"); save();
    expect(screen.getByRole("button", { name: "Guardando…" })).toBeDisabled();
    expect(screen.getByLabelText("Teléfono")).toBeDisabled();
    await act(async () => resolve({ kind: "saved", profile: { ...wire, phone: "12345678" } }));
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it("keeps only language edits dirty after partial success and retries only that block", async () => {
    mocks.save.mockResolvedValueOnce({ kind: "partial", profile: { ...wire, phone: "12345678" }, failure: { ok: false, reason: "invalid_request", reference: { status: 400 } } }).mockResolvedValueOnce({ kind: "saved", languages: { languages: [{ name: "español", level: "C2" }, { name: "english", level: "B2" }] } });
    await ready(); change("Teléfono", "12345678"); tab("Idiomas"); change("Nombre del idioma 2", "english"); save();
    await screen.findByText("Guardamos tu perfil, pero no los idiomas. Revisa y vuelve a guardar.");
    expect(screen.getByLabelText("Nombre del idioma 2")).toHaveValue("english");
    expect(screen.getByRole("button", { name: "Guardar perfil" })).toBeEnabled();
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "warning" }));
    save(); await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1][0]).toEqual({ languages: { languages: [{ name: "español", level: "C2" }, { name: "english", level: "B2" }] } });
    await screen.findByText("Perfil guardado.");
  });
  it("saves language-only changes without sending a profile replacement", async () => {
    mocks.save.mockResolvedValue({ kind: "saved", languages: { languages: [{ name: "español", level: "C2" }, { name: "english", level: "B2" }] } });
    await ready(); tab("Idiomas"); change("Nombre del idioma 2", "English"); save();
    await screen.findByText("Perfil guardado.");
    expect(mocks.save.mock.calls[0][0]).toEqual({ languages: { languages: [{ name: "español", level: "C2" }, { name: "english", level: "B2" }] } });
    expect(screen.getByLabelText("Nombre del idioma 2")).toHaveValue("english");
    expect(screen.getByRole("button", { name: "Guardar perfil" })).toBeDisabled();
  });
  it("preserves both edited blocks after a definite profile failure", async () => {
    mocks.save.mockResolvedValue({ kind: "failed", part: "profile", failure: { ok: false, reason: "invalid_request", reference: { status: 400 } } });
    await ready(); change("Teléfono", "12345678"); tab("Idiomas"); change("Nombre del idioma 2", "english"); save();
    await screen.findByText("No se guardó el perfil");
    expect(screen.getByLabelText("Nombre del idioma 2")).toHaveValue("english");
    tab("Personal"); expect(screen.getByLabelText("Teléfono")).toHaveValue("12345678");
    fireEvent.click(screen.getByRole("button", { name: "Restaurar cambios" }));
    expect(screen.getByLabelText("Teléfono")).toHaveValue(CANDIDATE_PROFILE.phone);
    tab("Idiomas"); expect(screen.getByLabelText("Nombre del idioma 2")).toHaveValue("inglés");
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it("reconciles uncertain language writes without discarding rows that were not saved", async () => {
    mocks.save.mockResolvedValue({ kind: "uncertain", part: "languages", profile: { ...wire, phone: "12345678" }, failure: { ok: false, reason: "no_response", reference: {} } });
    await ready(); change("Teléfono", "12345678"); tab("Idiomas"); change("Nombre del idioma 2", "english"); save();
    await screen.findByText("No pudimos confirmar si se guardó");
    mocks.load.mockResolvedValue({ ok: true, data: { ...loaded.data, profile: { ...wire, phone: "12345678" } } });
    fireEvent.click(screen.getByRole("button", { name: "Comprobar" }));
    await screen.findByText("Perfil comprobado.");
    expect(screen.getByLabelText("Nombre del idioma 2")).toHaveValue("english");
    expect(screen.getByRole("button", { name: "Guardar perfil" })).toBeEnabled();
    mocks.save.mockResolvedValue({ kind: "saved", languages: { languages: [{ name: "español", level: "C2" }, { name: "english", level: "B2" }] } });
    save(); await screen.findByText("Perfil guardado.");
    expect(mocks.save.mock.calls[1][0]).not.toHaveProperty("profile");
  });
  it("renders shared level errors, preserves dirty fields and never marks a failed profile saved", async () => {
    mocks.save.mockResolvedValue({ kind: "failed", part: "profile", failure: { ok: false, reason: "invalid_location", reference: { status: 422 }, locationIssues: [{ field: "state", reason: "unknown" }] } });
    await ready(); change("Teléfono", "12345678"); save();
    await screen.findByText("Elige una opción de la lista.");
    expect(screen.getByLabelText("Estado")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Teléfono")).toHaveValue("12345678");
    expect(screen.getByRole("button", { name: "Guardar perfil" })).toBeEnabled();
  });
  it("uncertain writes require read-only Comprobar, preserving edits and keeping write lock on read failure", async () => {
    mocks.save.mockResolvedValue({ kind: "uncertain", part: "profile", failure: { ok: false, reason: "no_response", reference: {} } });
    await ready(); change("Teléfono", "12345678"); save();
    await screen.findByText("No pudimos confirmar si se guardó");
    expect(screen.getByRole("button", { name: "Guardar perfil" })).toBeDisabled();
    mocks.load.mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} });
    fireEvent.click(screen.getByRole("button", { name: "Comprobar" }));
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Guardar perfil" })).toBeDisabled();
    mocks.load.mockResolvedValueOnce({ ok: true, data: { ...loaded.data, profile: { ...wire, phone: "12345678" } } });
    fireEvent.click(screen.getByRole("button", { name: "Comprobar" }));
    await screen.findByText("Perfil comprobado.");
    expect(screen.getByLabelText("Teléfono")).toHaveValue("12345678");
    expect(screen.getByRole("button", { name: "Guardar perfil" })).toBeDisabled();
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
});
