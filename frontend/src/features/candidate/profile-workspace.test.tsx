import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
vi.mock("@/features/languages/use-language-catalog", () => ({ useLanguageCatalog: () => ({ status: "success", data: { items: [{ code: "es", name: "Español" }, { code: "en", name: "Inglés" }, { code: "fr", name: "Francés" }] }, retry: vi.fn() }) }));
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
  it("groups identity before icon metadata and leaves only progress in the right column", async () => {
    const { container } = await ready();
    const hero = container.querySelector('[data-pf-profile-identity]')!;
    const title = hero.querySelector('[data-slot="card-title"]')!;
    expect(within(title as HTMLElement).getByRole("heading", { name: CANDIDATE_IDENTITY.fullName })).toHaveAttribute("id", "pf-profile-identity-heading");
    expect(title).toHaveTextContent(CANDIDATE_PROFILE.professionalTitle!);
    const meta = hero.querySelector('[data-slot="card-description"]')!;
    expect(meta).toHaveTextContent(`Trabaja en ${CANDIDATE_PROFILE.currentCompany}`);
    expect(meta.querySelectorAll("svg")).toHaveLength(3);
    expect(hero.textContent!.indexOf(CANDIDATE_PROFILE.professionalTitle!)).toBeLessThan(hero.textContent!.indexOf(CANDIDATE_IDENTITY.email));
    const progress = hero.querySelector('[data-slot="card-action"]')!;
    expect(progress).toHaveTextContent("Avance del perfil");
    expect(progress).not.toHaveTextContent(CANDIDATE_PROFILE.professionalTitle!);
    expect(hero.querySelector('[data-slot="avatar"]')).toHaveClass("size-14", "md:size-20");
    expect(title).toHaveClass("min-w-0", "grid-cols-[auto_minmax(0,1fr)]");
    expect(meta).toHaveClass("flex-wrap", "md:pl-25");
  });
  it("omits missing metadata and offers a title shortcut that switches and focuses", async () => {
    mocks.load.mockResolvedValue({ ...loaded, data: { ...loaded.data, profile: { ...wire, professional_title: null, current_company: null, location: null } } });
    const { container } = await ready();
    expect(container).not.toHaveTextContent(/sin definir/i);
    expect(screen.queryByText(/Trabaja en/)).not.toBeInTheDocument();
    const addTitle = screen.getByRole("button", { name: "Agrega tu título profesional" });
    // Aligned with the name column at every width, with no link padding pushing it inward.
    expect(addTitle).toHaveClass("col-start-2", "px-0", "has-data-[icon=inline-start]:pl-0");
    expect(addTitle).not.toHaveClass("col-span-2");
    fireEvent.click(addTitle);
    expect(screen.getByRole("tab", { name: "Experiencia" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByLabelText("Título profesional")).toHaveFocus());
    change("Título profesional", "Diseñadora");
    expect(container.querySelector('[data-pf-profile-headline]')).toHaveTextContent("Diseñadora");
  });
  it("keeps personal data together outside the location card", async () => {
    await ready();
    const contact = screen.getByRole("group", { name: "Contacto" });
    for (const label of ["Teléfono", "Fecha de nacimiento", "Perfil de LinkedIn", "Portafolio o sitio web"]) expect(within(contact).getByLabelText(label)).toBeInTheDocument();
  });
  it("focuses birth date before LinkedIn errors in the new visual order", async () => {
    mocks.save.mockResolvedValue({ kind: "failed", part: "profile", failure: { ok: false, reason: "invalid_request", reference: {}, fields: [{ field: "linkedin_url", code: "invalid" }, { field: "birth_date", code: "invalid" }] } });
    await ready(); change("Teléfono", "12345678"); save();
    await waitFor(() => expect(screen.getByLabelText("Fecha de nacimiento")).toHaveFocus());
  });
  it("associates eligibility help with País", async () => {
    await ready();
    const country = screen.getByRole("combobox", { name: "País" });
    const help = screen.getByText("Opcional. Algunas vacantes solo aceptan postulantes de ciertos países.");
    expect(country.closest('[data-slot="field"]')).toContainElement(help);
    expect(country).toHaveAccessibleDescription(help.textContent!);
  });
  it("offers a right-aligned destructive remove action", async () => {
    await ready();
    const remove = screen.getByRole("button", { name: "Quitar ubicación" });
    expect(remove).toHaveTextContent(/^Quitar$/);
    expect(remove).toHaveClass("text-destructive");
    expect(remove.querySelector("svg.lucide-trash-2")).not.toBeNull();
    // The remove action sits in the «Ubicación» card header, not on its own row above País.
    expect(remove.closest('[data-slot="card-header"]')).toHaveTextContent("Ubicación");
    // The 40px target does not make this header taller than «Contacto».
    expect(remove.closest('[data-slot="card-action"]')).toHaveClass("row-span-1", "-my-2");
  });
  it("signals mobile tab overflow with an edge fade, without a native scrollbar or hint text", async () => {
    await ready();
    const tabs = screen.getByRole("tablist");
    expect(tabs).toHaveClass("[scrollbar-width:none]");
    expect(tabs.className).toMatch(/mask-image/);
    // Room past the last tab so «Idiomas» leaves the fade once scrolled to the end.
    expect(tabs).toHaveClass("max-md:pr-12");
    expect(screen.queryByText(/Desliza para ver más secciones/)).not.toBeInTheDocument();
  });

  it("loads a form-shaped skeleton without fixture data, then the server profile", async () => {
    let resolve!: (value: unknown) => void; mocks.load.mockReturnValue(new Promise(r => { resolve = r; }));
    const { container } = render(<ProfileWorkspace />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando perfil");
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(3);
    const cardSlots = () => Array.from(container.querySelectorAll('[data-slot^="card"]')).map(node => node.getAttribute("data-slot"));
    const loadingSlots = cardSlots();
    const loadingHero = container.querySelector('[data-pf-profile-identity]')!.className;
    expect(screen.queryByText(CANDIDATE_IDENTITY.fullName)).not.toBeInTheDocument();
    await act(async () => resolve(loaded));
    expect(cardSlots()).toEqual(loadingSlots);
    expect(container.querySelector('[data-pf-profile-identity]')).toHaveClass(loadingHero);
    expect(screen.getByLabelText("Teléfono")).toHaveValue(CANDIDATE_PROFILE.phone);
    expect(screen.getByRole("button", { name: "Guardar perfil" })).toBeDisabled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it("opens an empty editor for a missing profile and creates it even with only language changes", async () => {
    mocks.load.mockResolvedValue({ ok: true, data: { profile: null, languages: { languages: [{ code: "en", level: "B2" }] } } });
    const empty = Object.fromEntries(Object.keys(profileToWrite(valid.profile)).map(key => [key, key === "skills" || key === "education" ? [] : key === "salary_currency" ? "MXN" : null]));
    const created = { ...wire, ...empty };
    mocks.save.mockResolvedValueOnce({ kind: "saved", profile: created, languages: { languages: [] } });
    await ready();
    expect(screen.getByText("Completa tu perfil para postularte más rápido. Se crea al guardar por primera vez.")).toBeInTheDocument();
    expect(screen.queryByText("Todavía no tienes perfil")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Teléfono")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Guardar perfil" })).toBeEnabled();
    tab("Compensación"); expect(screen.getByLabelText("Moneda")).toHaveValue("MXN");
    tab("Idiomas"); fireEvent.click(screen.getByRole("button", { name: "Quitar idioma 1" })); save();
    await screen.findByText("Perfil creado.");
    expect(mocks.save).toHaveBeenCalledWith({ profile: empty, languages: { languages: [] } });
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
    expect(container.querySelector('[data-slot="card"] [data-slot="empty-header"] [data-slot="empty-icon"]')).not.toBeNull();
    expect(screen.getByText("Tus datos no cambiaron.")).toBeVisible();
    if (reason !== "unauthenticated") expect(screen.getByRole("link", { name: "Ir al panel" })).toHaveAttribute("href", "/candidato");
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
  it("preserves main's toolbar, hero tokens and line tabs", async () => {
    const { container } = await ready();
    const toolbar = container.querySelector('[data-pf-profile-toolbar]')!;
    expect(toolbar).toHaveClass("sm:flex-row", "sm:justify-between", "px-1");
    expect(Array.from(toolbar.querySelectorAll("button")).map(node => node.textContent)).toEqual(["Guardar perfil", "Restaurar copia original"]);
    expect(container.querySelector('[data-pf-profile-status]')).toHaveTextContent("Sin cambios pendientes");
    expect(container.querySelector('[data-pf-profile-card]')).toHaveClass("border-border/70", "ring-border/60");
    expect(container.querySelector('[data-pf-profile-identity]')).toHaveClass("border-border/60");
    expect(container.querySelector('[data-slot="avatar"]')).toHaveClass("ring-primary/25", "ring-offset-2");
    expect(screen.getByRole("heading", { name: CANDIDATE_IDENTITY.fullName })).toHaveClass("font-heading", "text-foreground");
    expect(container.querySelector('[data-slot="tabs-list"]')).toHaveAttribute("data-variant", "line");
    expect(container.querySelector('[data-pf-profile-completeness-value]')).toHaveTextContent("10 de 10 datos clave");
    const expected = [
      ["Personal", ["phone", "birthDate", "linkedinUrl", "portfolioUrl", "location"]],
      ["Experiencia", ["professionalTitle", "currentCompany", "yearsOfExperience", "seniority", "summary"]],
      ["Educación", ["education.0.level", "education.0.institution", "education.0.field", "education.0.status", "education.0.start_year", "education.0.end_year", "skills"]],
      ["Compensación", ["currentSalaryGross", "currentSalaryNet", "salaryCurrency", "expectedSalary", "expectedSalaryPeriod"]],
      ["Idiomas", ["languages.0.code", "languages.0.level", "languages.1.code", "languages.1.level"]],
    ] as const;
    for (const [name, fields] of expected) {
      tab(name);
      expect(Array.from(container.querySelectorAll('[data-pf-profile-field]')).map(node => node.getAttribute("data-pf-profile-field"))).toEqual(fields);
      expect(container.querySelectorAll('[data-pf-profile-section-card]')).toHaveLength(name === "Idiomas" ? 1 : 2);
    }
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
    fireEvent.click(screen.getByRole("button", { name: "Restaurar copia original" }));
    expect(screen.getByText("Restauramos la copia original en esta vista.")).toBeInTheDocument();
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
  it("rejects a language with empty code and level before writing either block", async () => {
    await ready(); change("Teléfono", "12345678"); tab("Idiomas"); fireEvent.click(screen.getByRole("button", { name: "Agregar idioma" })); save();
    expect(screen.getByLabelText("Nivel del idioma 3")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Idioma 3")).toHaveFocus(); expect(mocks.save).not.toHaveBeenCalled();
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
    const languages = { languages: [CANDIDATE_PROFILE.languages[0]] };
    mocks.save.mockResolvedValueOnce({ kind: "partial", profile: { ...wire, phone: "12345678" }, failure: { ok: false, reason: "invalid_request", reference: { status: 400 } } }).mockResolvedValueOnce({ kind: "saved", languages });
    await ready(); change("Teléfono", "12345678"); tab("Idiomas"); fireEvent.click(screen.getByRole("button", { name: "Quitar idioma 2" })); save();
    await screen.findByText("Guardamos tu perfil, pero no los idiomas. Revisa y vuelve a guardar.");
    expect(screen.queryByLabelText("Idioma 2")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar perfil" })).toBeEnabled();
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "warning" }));
    save(); await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1][0]).toEqual({ languages });
    await screen.findByText("Perfil guardado.");
  });
  it("saves language-only changes without sending a profile replacement", async () => {
    const languages = { languages: [CANDIDATE_PROFILE.languages[0]] };
    mocks.save.mockResolvedValue({ kind: "saved", languages });
    await ready(); tab("Idiomas"); fireEvent.click(screen.getByRole("button", { name: "Quitar idioma 2" })); save();
    await screen.findByText("Perfil guardado.");
    expect(mocks.save.mock.calls[0][0]).toEqual({ languages });
    expect(screen.queryByLabelText("Idioma 2")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar perfil" })).toBeDisabled();
  });
  it("preserves both edited blocks after a definite profile failure", async () => {
    mocks.save.mockResolvedValue({ kind: "failed", part: "profile", failure: { ok: false, reason: "invalid_request", reference: { status: 400 } } });
    await ready(); change("Teléfono", "12345678"); tab("Idiomas"); fireEvent.click(screen.getByRole("button", { name: "Quitar idioma 2" })); save();
    await screen.findByText("No se guardó el perfil");
    expect(screen.queryByLabelText("Idioma 2")).not.toBeInTheDocument();
    tab("Personal"); expect(screen.getByLabelText("Teléfono")).toHaveValue("12345678");
    fireEvent.click(screen.getByRole("button", { name: "Restaurar copia original" }));
    expect(screen.getByLabelText("Teléfono")).toHaveValue(CANDIDATE_PROFILE.phone);
    tab("Idiomas"); expect(screen.getByLabelText("Idioma 2")).toHaveValue("Inglés");
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it("reconciles uncertain language writes without discarding rows that were not saved", async () => {
    mocks.save.mockResolvedValue({ kind: "uncertain", part: "languages", profile: { ...wire, phone: "12345678" }, failure: { ok: false, reason: "no_response", reference: {} } });
    await ready(); change("Teléfono", "12345678"); tab("Idiomas"); fireEvent.click(screen.getByRole("button", { name: "Quitar idioma 2" })); save();
    await screen.findByText("No pudimos confirmar si se guardó");
    mocks.load.mockResolvedValue({ ok: true, data: { ...loaded.data, profile: { ...wire, phone: "12345678" } } });
    fireEvent.click(screen.getByRole("button", { name: "Comprobar" }));
    await screen.findByText("Perfil comprobado.");
    expect(screen.queryByLabelText("Idioma 2")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar perfil" })).toBeEnabled();
    mocks.save.mockResolvedValue({ kind: "saved", languages: { languages: [CANDIDATE_PROFILE.languages[0]] } });
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

it("maps bracketed server paths and focuses the first invalid field in visual order", async () => {
  mocks.save.mockResolvedValue({ kind: "failed", part: "profile", failure: { ok: false, reason: "invalid_request", reference: { status: 400, code: "validation_error" }, fields: [{ field: "education[0].status", code: "invalid" }, { field: "years_of_experience", code: "invalid" }] } });
  await ready(); change("Teléfono", "12345678"); save();
  expect(await screen.findByLabelText("Años de experiencia")).toHaveFocus();
  expect(screen.getByLabelText("Años de experiencia")).toHaveAttribute("aria-invalid", "true");
  tab("Educación"); expect(screen.getByLabelText("Estatus")).toHaveAttribute("aria-invalid", "true");
});

it("lets the section tabs scroll sideways only (no 1px vertical scrollbar next to «Idiomas»)", async () => {
  // Seen in Chromium: overflow-auto plus a 33px row in a 32px list drew a vertical scroll control.
  await ready();
  const list = screen.getByRole("tablist");
  expect(list).toHaveClass("overflow-x-auto", "overflow-y-hidden");
  expect(list).not.toHaveClass("overflow-auto");
});

it("does not repeat the «Ubicación» card title as a visible location legend", async () => {
  // Seen in Chromium: the card «Ubicación» showed a second visible «Ubicación» heading inside.
  await ready();
  const legends = screen.getAllByRole("group", { name: "Ubicación" }).map(group => group.querySelector(":scope > legend"));
  expect(legends.length).toBeGreaterThan(1);
  for (const legend of legends) expect(legend).toHaveClass("sr-only");
});
