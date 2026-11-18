import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
vi.mock("@/components/ui/combobox", async importOriginal => ({
  ...await importOriginal<typeof import("@/components/ui/combobox")>(),
  ComboboxContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProfileWorkspace } from "./profile-workspace";
import { CANDIDATE_IDENTITY, CANDIDATE_PROFILE } from "./prototype-candidate";
import { profileToDraft, parseProfileDraft } from "./profile-draft";
import { profileToWrite } from "./profile-adapter";
import { PROFILE_VISIBILITY } from "./profile/visibility";
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
const wire = { ...profileToWrite(valid.profile), user_id: CANDIDATE_IDENTITY.userId, location: CANDIDATE_PROFILE.location, created_at: CANDIDATE_PROFILE.createdAt, updated_at: "2026-11-12T12:00:00Z" };
const loaded = { ok: true, data: { profile: wire, languages: { languages: CANDIDATE_PROFILE.languages } } };
const emptyWire = Object.fromEntries(Object.keys(profileToWrite(valid.profile)).map(key => [key, key === "skills" || key === "education" ? [] : key === "salary_currency" ? "MXN" : null]));

const header = () => screen.getByRole("heading", { level: 2, name: "Tu perfil" }).closest("header") as HTMLElement;
const section = (name: string) => screen.getByRole("region", { name });
const ficha = () => screen.getByRole("article", { name: "Así te ve una empresa al recibir tu postulación" });
const bar = () => screen.queryByRole("region", { name: "Cambios sin guardar" });
const edit = (name: string) => fireEvent.click(screen.getByRole("button", { name: `Editar ${name}` }));
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
async function selectDial(dial: string) {
  const name = dial === "+52" ? "México" : "Estados Unidos";
  change("Lada de país", name);
  fireEvent.click(await screen.findByRole("option", { name: `${name} ${dial}` }));
}
const saveButton = () => within(header()).getByRole("button", { name: /^(Guardar perfil|Guardando…)$/ });
const save = () => fireEvent.click(within(header()).getByRole("button", { name: "Guardar perfil" }));
const restore = () => fireEvent.click(within(header()).getByRole("button", { name: "Restaurar copia original" }));
async function ready() { const view = render(<ProfileWorkspace />); await screen.findByRole("heading", { level: 2, name: "Tu perfil" }); return view; }
beforeEach(() => { vi.resetAllMocks(); mocks.load.mockResolvedValue(loaded); mocks.save.mockResolvedValue({ kind: "saved", profile: { ...wire, phone: "+525512345678" } }); });
afterEach(cleanup);

describe("S3 profile phone saves", () => {
  it.each([["+52", "5512345678", "+525512345678"], ["+1", "2125551234", "+12125551234"]])("sends %s with ten national digits as E.164", async (dial, phone, expected) => {
    await ready(); edit("Contacto y ubicación"); await selectDial(dial); change("Teléfono", phone); save();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][0].profile.phone).toBe(expected);
  });
  it.each([["+52", "123", "Escribe los 10 dígitos del teléfono en México."], ["+1", "abc", "Escribe una lada y un número válidos, de 8 a 15 dígitos en total."]])("rejects invalid %s and opens Contacto to focus the phone from another section", async (dial, phone, message) => {
    await ready(); edit("Contacto y ubicación"); await selectDial(dial); change("Teléfono", phone); edit("Educación y habilidades");
    expect(screen.queryByLabelText("Teléfono")).not.toBeInTheDocument();
    save();
    await waitFor(() => expect(screen.getByLabelText("Teléfono")).toHaveFocus());
    expect(screen.getByLabelText("Teléfono")).toHaveAccessibleDescription(expect.stringContaining(message));
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("clears legacy text to null even though the original baseline is invalid", async () => {
    mocks.load.mockResolvedValue({ ...loaded, data: { ...loaded.data, profile: { ...wire, phone: "texto heredado" } } });
    await ready(); edit("Contacto y ubicación"); change("Teléfono", ""); save();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][0].profile.phone).toBeNull();
  });
  it("loads an unreadable legacy phone verbatim, rejects it, and lets the user correct it", async () => {
    mocks.load.mockResolvedValue({ ...loaded, data: { ...loaded.data, profile: { ...wire, phone: "llamar por la tarde" } } });
    await ready();
    expect(within(section("Contacto y ubicación")).getByText("llamar por la tarde")).toBeVisible();
    edit("Experiencia"); change("Título profesional", "Nuevo título"); save();
    await waitFor(() => expect(screen.getByLabelText("Teléfono")).toHaveFocus());
    expect(screen.getByLabelText("Teléfono")).toHaveValue("llamar por la tarde");
    expect(mocks.save).not.toHaveBeenCalled();
    await selectDial("+52"); change("Teléfono", "55 1234 5678"); save();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][0].profile.phone).toBe("+525512345678");
  });
  it("loads a legacy ten-digit phone under the visible +52 dial so other edits still save", async () => {
    mocks.load.mockResolvedValue({ ...loaded, data: { ...loaded.data, profile: { ...wire, phone: "55 1234 5678" } } });
    await ready(); edit("Contacto y ubicación");
    expect(screen.getByLabelText("Lada de país")).toHaveValue("México +52");
    expect(screen.getByLabelText("Teléfono")).toHaveValue("5512345678");
    edit("Experiencia"); change("Título profesional", "Nuevo título"); save();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][0].profile.phone).toBe("+525512345678");
  });
  it.each([["+52", "Escribe los 10 dígitos del teléfono en México."], ["+1", "Escribe una lada y un número válidos, de 8 a 15 dígitos en total."]])("maps backend phone invalid with the %s message and focus", async (dial, message) => {
    mocks.save.mockResolvedValue({ kind: "failed", part: "profile", failure: { ok: false, reason: "invalid_request", reference: { status: 400 }, fields: [{ field: "phone", code: "invalid" }] } });
    await ready(); edit("Contacto y ubicación"); await selectDial(dial); change("Teléfono", "2125551234"); edit("Educación y habilidades"); save();
    await waitFor(() => expect(screen.getByLabelText("Teléfono")).toHaveFocus());
    expect(screen.getByLabelText("Teléfono")).toHaveAccessibleDescription(expect.stringContaining(message));
  });
});

describe("artboard 04 «Así te ven las empresas»", () => {
  it("heads the page with «Tu perfil», the pending chip, the update date and both page actions", async () => {
    await ready();
    expect(within(header()).getByText("Sin cambios pendientes")).toBeVisible();
    expect(within(header()).getByText("Actualizado el 12 de noviembre de 2026")).toBeVisible();
    expect(within(header()).getAllByRole("button").map(button => button.textContent)).toEqual(["Restaurar copia original", "Guardar perfil"]);
    expect(saveButton()).toBeDisabled();
    expect(bar()).toBeNull();
    edit("Experiencia"); change("Título profesional", "Nuevo título");
    expect(within(header()).getByText("Cambios pendientes")).toBeVisible();
    expect(saveButton()).toBeEnabled();
  });

  it("shows on the ficha only what a company receives", async () => {
    await ready();
    const card = ficha();
    expect(within(card).getByText("Así te ve una empresa al recibir tu postulación")).toBeVisible();
    expect(within(card).getByText("XB")).toBeInTheDocument();
    expect(within(card).getByRole("heading", { name: "Ximena Barrera" })).toBeVisible();
    expect(within(card).getByText("Desarrolladora Frontend Senior")).toBeVisible();
    expect(within(card).getByText("Ciudad de México")).toBeVisible();
    expect(within(card).getByText("9 años de experiencia · Senior · Licenciatura o Ingeniería")).toBeVisible();
    const contact = within(card).getByRole("list", { name: "Contacto que recibe la empresa" });
    expect(within(contact).getAllByRole("listitem").map(item => item.textContent)).toEqual(["ximena.barrera@correo.mx", "+52 55 4821 7790"]);
    // Private facts never appear on the ficha as if a company saw them.
    for (const secret of ["Ámbar Studio", "Trabaja en", "LinkedIn", "linkedin.com", "ximenabarrera.dev", "18 de junio de 1994", "nueve años construyendo", "Ingeniería en Sistemas Computacionales", "62,000", "48,000", "75,000", "MXN"]) {
      expect(card).not.toHaveTextContent(secret);
    }
  });

  it("moves the professional title in or out of the ficha when its single map entry flips", async () => {
    const original = PROFILE_VISIBILITY.professionalTitle;
    try {
      PROFILE_VISIBILITY.professionalTitle = "private";
      await ready();
      expect(ficha()).not.toHaveTextContent("Desarrolladora Frontend Senior");
      const title = within(section("Experiencia")).getByText("Título profesional").closest("dt")!;
      expect(title).toHaveTextContent("Solo tú");
      expect(screen.getByRole("region", { name: "Qué recibe la empresa" })).toHaveTextContent(/Solo tú ves título profesional/);
      cleanup();
      PROFILE_VISIBILITY.professionalTitle = "company";
      await ready();
      expect(within(ficha()).getByText("Desarrolladora Frontend Senior")).toBeVisible();
      expect(within(section("Experiencia")).getByText("Título profesional").closest("dt")).not.toHaveTextContent("Solo tú");
    } finally { PROFILE_VISIBILITY.professionalTitle = original; }
  });

  it("tags every section from the visibility map and marks each private fact «Solo tú»", async () => {
    await ready();
    expect(Array.from(document.querySelectorAll("[data-pf-profile-section]")).map(node => node.querySelector("h3")?.textContent)).toEqual(["Experiencia", "Educación y habilidades", "Idiomas", "Contacto y ubicación", "Compensación"]);
    for (const name of ["Experiencia", "Educación y habilidades", "Contacto y ubicación"]) expect(within(section(name)).getByText("Las empresas lo ven, salvo lo marcado «Solo tú»")).toBeVisible();
    expect(within(section("Idiomas")).getByText("Lo ven las empresas")).toBeVisible();
    expect(within(section("Compensación")).getByText("Solo tú · no aparece en tu ficha")).toBeVisible();
    for (const name of ["Experiencia", "Educación y habilidades", "Idiomas", "Contacto y ubicación", "Compensación"]) expect(within(section(name)).getByRole("button", { name: `Editar ${name}` })).toHaveTextContent("Editar");
    const privateOf = (name: string) => Array.from(section(name).querySelectorAll("[data-pf-profile-private]")).map(node => node.getAttribute("data-pf-profile-private"));
    expect(privateOf("Experiencia")).toEqual(["currentCompany", "summary"]);
    expect(privateOf("Contacto y ubicación")).toEqual(["birthDate", "linkedinUrl", "portfolioUrl"]);
    expect(privateOf("Educación y habilidades")).toEqual(["educationDetails"]);
    expect(within(section("Educación y habilidades")).getByText("Licenciatura o Ingeniería", { selector: "[data-pf-profile-highest] b" })).toBeVisible();
    expect(within(section("Educación y habilidades")).getByText("Ingeniería en Sistemas Computacionales · Concluido")).toBeVisible();
  });

  it("reads each section like the artboard: experience, skills, languages with level dots, contact and compensation", async () => {
    await ready();
    const experience = section("Experiencia");
    for (const text of ["Desarrolladora Frontend Senior", "Ámbar Studio", "9 años", "Senior", CANDIDATE_PROFILE.summary!]) expect(within(experience).getByText(text)).toBeVisible();
    expect(within(section("Educación y habilidades")).getAllByRole("listitem").map(item => item.textContent)).toEqual(expect.arrayContaining(["react", "typescript", "node.js", "design systems"]));
    const languages = within(section("Idiomas")).getAllByRole("listitem");
    expect(languages.map(item => item.textContent)).toEqual(["EspañolC2 · Dominio", "InglésB2 · Intermedio alto"]);
    expect(languages.map(item => item.querySelector("[data-pf-profile-level-dots]")!.getAttribute("data-pf-profile-level-dots"))).toEqual(["6", "4"]);
    const contact = section("Contacto y ubicación");
    for (const text of ["+52 55 4821 7790", "18 de junio de 1994", "Ciudad de México", "ximena.barrera@correo.mx", "linkedin.com/in/ximena-barrera", "ximenabarrera.dev"]) expect(within(contact).getByText(text)).toBeVisible();
    const pay = section("Compensación");
    for (const text of ["$62,000 MXN", "$48,000 MXN", "$75,000 MXN · mensual", "MXN"]) expect(within(pay).getByText(text)).toBeVisible();
  });

  it("edits a section in place, then «Listo» closes it and returns focus to «Editar»", async () => {
    await ready();
    expect(screen.queryByLabelText("Título profesional")).not.toBeInTheDocument();
    edit("Experiencia");
    const experience = section("Experiencia");
    expect(experience).toHaveAttribute("data-editing", "true");
    await waitFor(() => expect(within(experience).getByLabelText("Título profesional")).toHaveFocus());
    expect(within(experience).getByText("Los cambios se guardan al pulsar «Guardar perfil».")).toBeVisible();
    expect(within(experience).getByRole("button", { name: "Descartar cambios de experiencia" })).toBeDisabled();
    edit("Compensación");
    expect(screen.queryByLabelText("Título profesional")).not.toBeInTheDocument();
    fireEvent.click(within(section("Compensación")).getByRole("button", { name: "Listo" }));
    expect(screen.queryByLabelText("Moneda")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Editar Compensación" })).toHaveFocus());
  });

  it("discards only that section's changes", async () => {
    await ready();
    edit("Contacto y ubicación"); change("Teléfono", "5512345678");
    edit("Experiencia"); change("Título profesional", "Nuevo título");
    expect(within(section("Experiencia")).getByText("Sin guardar")).toBeVisible();
    fireEvent.click(within(section("Experiencia")).getByRole("button", { name: "Descartar cambios de experiencia" }));
    expect(screen.getByLabelText("Título profesional")).toHaveValue(CANDIDATE_PROFILE.professionalTitle);
    expect(within(section("Experiencia")).queryByText("Sin guardar")).toBeNull();
    expect(within(section("Contacto y ubicación")).getByText("Sin guardar")).toBeVisible();
    expect(within(section("Contacto y ubicación")).getByText("+52 55 1234 5678")).toBeVisible();
  });

  it("keeps a fixed «Cambios sin guardar» bar that names the changed sections and holds Restaurar and Guardar perfil", async () => {
    await ready();
    edit("Experiencia"); change("Título profesional", "Nuevo título");
    edit("Compensación"); change("Salario esperado", "80000");
    const region = bar()!;
    expect(region).toHaveClass("sticky", "bottom-2");
    expect(within(region).getByText("Cambios sin guardar")).toBeVisible();
    expect(within(within(region).getByRole("list", { name: "Secciones con cambios" })).getAllByRole("listitem").map(item => item.textContent)).toEqual(["Experiencia", "Compensación"]);
    expect(within(region).getByText("Se guardan juntos; puedes volver a la copia original.")).toBeVisible();
    fireEvent.click(within(region).getByRole("button", { name: "Restaurar copia original" }));
    expect(screen.getByText("Restauramos la copia original en esta vista.")).toBeInTheDocument();
    expect(bar()).toBeNull();
  });

  it("rings «n de 10 datos clave» and opens and focuses the field of each missing item", async () => {
    mocks.load.mockResolvedValue({ ...loaded, data: { profile: { ...wire, phone: null, current_company: null, location: null }, languages: { languages: [] } } });
    await ready();
    const progress = screen.getByRole("region", { name: "Te falta poco" });
    expect(within(progress).getByRole("img", { name: "Perfil completo al 60 %" })).toHaveTextContent("60%");
    expect(within(progress).getByText("6 de 10 datos clave")).toBeVisible();
    expect(within(progress).getAllByRole("button").map(button => button.textContent)).toEqual(["Agregar Empresa actual", "Agregar Teléfono", "Agregar Ubicación", "Agregar Idiomas"]);
    fireEvent.click(within(progress).getByRole("button", { name: "Agregar Teléfono" }));
    await waitFor(() => expect(screen.getByLabelText("Teléfono")).toHaveFocus());
    fireEvent.click(within(progress).getByRole("button", { name: "Agregar Empresa actual" }));
    await waitFor(() => expect(screen.getByLabelText("Empresa actual o última")).toHaveFocus());
    fireEvent.click(within(progress).getByRole("button", { name: "Agregar Idiomas" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Agregar idioma" })).toHaveFocus());
    fireEvent.click(within(progress).getByRole("button", { name: "Agregar Ubicación" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "País" })).toHaveFocus());
    // The live draft counts: filling a field updates the ring before saving.
    edit("Experiencia"); change("Empresa actual o última", "Ámbar Studio");
    expect(await within(screen.getByRole("region", { name: "Te falta poco" })).findByText("7 de 10 datos clave")).toBeVisible();
  });

  it("lifts the progress card above the ficha at 390 px only while the profile is incomplete", async () => {
    await ready();
    expect(screen.getByRole("region", { name: "Perfil completo" })).not.toHaveClass("max-sm:order-first");
    expect(screen.getByRole("img", { name: "Perfil completo al 100 %" })).not.toHaveTextContent("100");
    cleanup();
    mocks.load.mockResolvedValue({ ...loaded, data: { ...loaded.data, profile: { ...wire, phone: null } } });
    const { container } = await ready();
    expect(screen.getByRole("region", { name: "Te falta poco" })).toHaveClass("max-sm:order-first");
    expect(container.querySelector("[data-pf-profile-rail]")).toHaveClass("max-sm:contents");
  });

  it("writes «Qué recibe la empresa» from the visibility map, with the copy-at-application note", async () => {
    await ready();
    const card = screen.getByRole("region", { name: "Qué recibe la empresa" });
    expect(within(card).getByText("Nombre, correo, teléfono, ubicación, título profesional, años de experiencia, seniority, tu nivel de estudios más alto, habilidades e idiomas.")).toBeVisible();
    expect(within(card).getByText("Solo tú ves tu fecha de nacimiento, LinkedIn, portafolio, empresa actual, resumen profesional, los detalles de tus estudios y tu compensación.")).toBeVisible();
    expect(within(card).getByText("Recibe una copia de estos datos al momento de postularte; si después editas tu perfil, esa copia no cambia (salvo tu teléfono).")).toBeVisible();
    expect(within(card).getByRole("link", { name: "Ver mis CVs" })).toHaveAttribute("href", "/candidato/cvs");
  });

  it("keeps one form, novalidate, every field in its section and the optional location helper", async () => {
    const { container } = await ready();
    expect(container.querySelectorAll("form")).toHaveLength(1);
    expect(container.querySelector("form")).toHaveAttribute("novalidate");
    const expected = [
      ["Contacto y ubicación", ["dial", "phone", "birthDate", "linkedinUrl", "portfolioUrl", "location"]],
      ["Experiencia", ["professionalTitle", "currentCompany", "yearsOfExperience", "seniority", "summary"]],
      ["Educación y habilidades", ["education.0.level", "education.0.institution", "education.0.field", "education.0.status", "education.0.start_year", "education.0.end_year", "skills"]],
      ["Compensación", ["currentSalaryGross", "currentSalaryNet", "salaryCurrency", "expectedSalary", "expectedSalaryPeriod"]],
      ["Idiomas", ["languages.0.code", "languages.0.level", "languages.1.code", "languages.1.level"]],
    ] as const;
    for (const [name, fields] of expected) {
      edit(name);
      expect(Array.from(section(name).querySelectorAll("[data-pf-profile-field]")).map(node => node.getAttribute("data-pf-profile-field"))).toEqual(fields);
    }
    edit("Contacto y ubicación");
    const country = screen.getByRole("combobox", { name: "País" });
    const help = screen.getByText("Opcional. Algunas vacantes solo aceptan postulantes de ciertos países.");
    expect(country).toHaveAccessibleDescription(help.textContent!);
    expect(screen.queryByLabelText("Código postal")).not.toBeInTheDocument();
    expect(within(section("Contacto y ubicación")).getByRole("group", { name: "Contacto" })).toContainElement(screen.getByLabelText("Fecha de nacimiento"));
  });

  it("offers «Quitar» for the location inside the Ubicación group", async () => {
    await ready(); edit("Contacto y ubicación");
    const remove = screen.getByRole("button", { name: "Quitar ubicación" });
    expect(remove).toHaveTextContent(/^Quitar$/);
    expect(remove).toHaveClass("text-destructive");
    expect(screen.getAllByRole("group", { name: "Ubicación" })[0]).toContainElement(remove);
  });

  it("loads a page-shaped skeleton without fixture data, then the server profile", async () => {
    let resolve!: (value: unknown) => void; mocks.load.mockReturnValue(new Promise(r => { resolve = r; }));
    render(<ProfileWorkspace />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando perfil");
    expect(screen.queryByText(CANDIDATE_IDENTITY.fullName)).not.toBeInTheDocument();
    await act(async () => resolve(loaded));
    expect(within(section("Contacto y ubicación")).getByText("+52 55 4821 7790")).toBeVisible();
    edit("Contacto y ubicación");
    expect(screen.getByLabelText("Teléfono")).toHaveValue("5548217790");
    expect(screen.getByLabelText("Lada de país")).toHaveValue("México +52");
    expect(saveButton()).toBeDisabled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("opens an empty profile with «Agregar …» placeholders, creates it on save and then saves normally", async () => {
    mocks.load.mockResolvedValue({ ok: true, data: { profile: null, languages: { languages: [{ code: "en", level: "B2" }] } } });
    const created = { ...wire, ...emptyWire };
    mocks.save.mockResolvedValueOnce({ kind: "saved", profile: created, languages: { languages: [] } });
    await ready();
    expect(within(header()).getByText("Se crea al guardar por primera vez")).toBeVisible();
    expect(screen.getByText("Completa tu perfil para postularte más rápido.")).toBeVisible();
    expect(within(ficha()).getByRole("button", { name: "Agrega tu título profesional" })).toBeVisible();
    expect(within(ficha()).getByRole("button", { name: "Agregar contacto" })).toBeVisible();
    for (const [name, action] of [["Experiencia", "Agregar experiencia"], ["Educación y habilidades", "Agregar estudio"], ["Compensación", "Agregar compensación"]]) expect(within(section(name)).getByRole("button", { name: action })).toBeVisible();
    const create = screen.getByRole("region", { name: "Crear tu perfil" });
    expect(within(create).getByText("Tu perfil todavía no existe")).toBeVisible();
    expect(within(create).getByText("Tu perfil se crea al guardar por primera vez, aunque falten datos.")).toBeVisible();
    expect(saveButton()).toBeEnabled();
    fireEvent.click(within(section("Educación y habilidades")).getByRole("button", { name: "Agregar estudio" }));
    await waitFor(() => expect(within(section("Educación y habilidades")).getByRole("button", { name: "Agregar estudio" })).toHaveFocus());
    edit("Compensación"); expect(screen.getByLabelText("Moneda")).toHaveValue("MXN");
    edit("Idiomas"); fireEvent.click(screen.getByRole("button", { name: "Quitar idioma 1" }));
    expect(within(screen.getByRole("region", { name: "Cambios sin guardar" })).getByText("Tu perfil se crea al guardar por primera vez, aunque falten datos.")).toBeVisible();
    save();
    await screen.findByText("Perfil creado.");
    expect(mocks.save).toHaveBeenCalledWith({ profile: emptyWire, languages: { languages: [] } });
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Perfil creado." }));
    expect(screen.queryByText(/se crea al guardar por primera vez/i)).not.toBeInTheDocument();
    expect(bar()).toBeNull();
    expect(saveButton()).toBeDisabled();
    mocks.save.mockResolvedValueOnce({ kind: "saved", profile: { ...created, phone: "+525512345678" } });
    edit("Contacto y ubicación"); change("Teléfono", "5512345678"); save();
    await screen.findByText("Perfil guardado.");
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Perfil guardado." }));
    expect(mocks.save.mock.calls[1][0]).toEqual({ profile: { ...emptyWire, phone: "+525512345678" } });
  });

  it.each(["unauthenticated", "no_response", "forbidden"])("keeps the load error for %s", async reason => {
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
    await screen.findByRole("heading", { level: 2, name: "Tu perfil" });
    expect(mocks.load).toHaveBeenCalledTimes(2); expect(mocks.save).not.toHaveBeenCalled();
  });
});

describe("save flows", () => {
  it("sends a complete replacement for one changed field, not a patch, and confirms the new baseline", async () => {
    await ready(); edit("Contacto y ubicación"); change("Teléfono", "5512345678"); save();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][0]).toEqual({ profile: { ...profileToWrite(valid.profile), phone: "+525512345678" } });
    await screen.findByText("Perfil guardado.");
    expect(saveButton()).toBeDisabled();
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Perfil guardado." }));
  });
  it("saves from the fixed bar too", async () => {
    await ready(); edit("Contacto y ubicación"); change("Teléfono", "5512345678");
    fireEvent.click(within(bar()!).getByRole("button", { name: "Guardar perfil" }));
    await screen.findByText("Perfil guardado.");
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it("clears optional location with null and does not silently reinstate MX", async () => {
    await ready(); edit("Contacto y ubicación"); fireEvent.click(screen.getByRole("button", { name: "Quitar ubicación" })); save();
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0][0].profile.location).toBeNull();
  });
  it("retains edits across sections and Restaurar restores the confirmed baseline", async () => {
    await ready(); edit("Contacto y ubicación"); change("Teléfono", "5512345678"); edit("Experiencia"); change("Título profesional", "Nuevo título"); edit("Contacto y ubicación");
    expect(screen.getByLabelText("Teléfono")).toHaveValue("5512345678");
    restore();
    expect(screen.getByText("Restauramos la copia original en esta vista.")).toBeInTheDocument();
    expect(screen.getByLabelText("Teléfono")).toHaveValue("5548217790");
    edit("Experiencia"); expect(screen.getByLabelText("Título profesional")).toHaveValue(CANDIDATE_PROFILE.professionalTitle);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("validates every section and focuses the first error without a write", async () => {
    await ready(); edit("Contacto y ubicación"); change("Perfil de LinkedIn", "not-url"); edit("Compensación"); change("Moneda", ""); save();
    expect(await screen.findByLabelText("Perfil de LinkedIn")).toHaveFocus();
    expect(screen.getByLabelText("Perfil de LinkedIn")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Revisa los datos marcados")).toBeInTheDocument();
    expect(within(section("Compensación")).getByText("Revisa los datos")).toBeVisible();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("focuses birth date before LinkedIn errors in the visual order", async () => {
    mocks.save.mockResolvedValue({ kind: "failed", part: "profile", failure: { ok: false, reason: "invalid_request", reference: {}, fields: [{ field: "linkedin_url", code: "invalid" }, { field: "birth_date", code: "invalid" }] } });
    await ready(); edit("Contacto y ubicación"); change("Teléfono", "5512345678"); save();
    await waitFor(() => expect(screen.getByLabelText("Fecha de nacimiento")).toHaveFocus());
  });
  it("rejects a language with empty code and level before writing either block", async () => {
    await ready(); edit("Contacto y ubicación"); change("Teléfono", "5512345678"); edit("Idiomas"); fireEvent.click(screen.getByRole("button", { name: "Agregar idioma" })); save();
    await waitFor(() => expect(screen.getByLabelText("Idioma 3")).toHaveFocus());
    expect(screen.getByLabelText("Nivel del idioma 3")).toHaveAttribute("aria-invalid", "true");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("locks controls and double submissions during a write", async () => {
    let resolve!: (value: unknown) => void; mocks.save.mockReturnValue(new Promise(r => { resolve = r; }));
    await ready(); edit("Contacto y ubicación"); change("Teléfono", "5512345678"); save();
    expect(within(header()).getByRole("button", { name: "Guardando…" })).toBeDisabled();
    expect(within(bar()!).getByText("Guardando tu perfil…")).toBeVisible();
    expect(screen.getByLabelText("Teléfono")).toBeDisabled();
    expect(screen.getByLabelText("Lada de país")).toBeDisabled();
    await act(async () => resolve({ kind: "saved", profile: { ...wire, phone: "+525512345678" } }));
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it("keeps only language edits dirty after partial success and retries only that block", async () => {
    const languages = { languages: [CANDIDATE_PROFILE.languages[0]] };
    mocks.save.mockResolvedValueOnce({ kind: "partial", profile: { ...wire, phone: "+525512345678" }, failure: { ok: false, reason: "invalid_request", reference: { status: 400 } } }).mockResolvedValueOnce({ kind: "saved", languages });
    await ready(); edit("Contacto y ubicación"); change("Teléfono", "5512345678"); edit("Idiomas"); fireEvent.click(screen.getByRole("button", { name: "Quitar idioma 2" })); save();
    await screen.findByText("Guardamos tu perfil, pero no los idiomas. Revisa y vuelve a guardar.");
    expect(screen.queryByLabelText("Idioma 2")).not.toBeInTheDocument();
    expect(within(within(bar()!).getByRole("list", { name: "Secciones con cambios" })).getAllByRole("listitem").map(item => item.textContent)).toEqual(["Idiomas"]);
    expect(saveButton()).toBeEnabled();
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "warning" }));
    save(); await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1][0]).toEqual({ languages });
    await screen.findByText("Perfil guardado.");
  });
  it("saves language-only changes without sending a profile replacement", async () => {
    const languages = { languages: [CANDIDATE_PROFILE.languages[0]] };
    mocks.save.mockResolvedValue({ kind: "saved", languages });
    await ready(); edit("Idiomas"); fireEvent.click(screen.getByRole("button", { name: "Quitar idioma 2" })); save();
    await screen.findByText("Perfil guardado.");
    expect(mocks.save.mock.calls[0][0]).toEqual({ languages });
    expect(screen.queryByLabelText("Idioma 2")).not.toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });
  it("preserves both edited blocks after a definite profile failure", async () => {
    mocks.save.mockResolvedValue({ kind: "failed", part: "profile", failure: { ok: false, reason: "invalid_request", reference: { status: 400 } } });
    await ready(); edit("Contacto y ubicación"); change("Teléfono", "5512345678"); edit("Idiomas"); fireEvent.click(screen.getByRole("button", { name: "Quitar idioma 2" })); save();
    await screen.findByText("No se guardó el perfil");
    expect(screen.queryByLabelText("Idioma 2")).not.toBeInTheDocument();
    edit("Contacto y ubicación"); expect(screen.getByLabelText("Teléfono")).toHaveValue("5512345678");
    restore();
    expect(screen.getByLabelText("Teléfono")).toHaveValue("5548217790");
    edit("Idiomas"); expect(screen.getByLabelText("Idioma 2")).toHaveValue("Inglés");
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it("says the session expired when the save is unauthenticated", async () => {
    mocks.save.mockResolvedValue({ kind: "failed", part: "profile", failure: { ok: false, reason: "unauthenticated", reference: {} } });
    await ready(); edit("Contacto y ubicación"); change("Teléfono", "5512345678"); save();
    await screen.findByText("Tu sesión expiró");
    expect(screen.getByLabelText("Teléfono")).toHaveValue("5512345678");
  });
  it("reconciles uncertain language writes without discarding rows that were not saved", async () => {
    mocks.save.mockResolvedValue({ kind: "uncertain", part: "languages", profile: { ...wire, phone: "+525512345678" }, failure: { ok: false, reason: "no_response", reference: {} } });
    await ready(); edit("Contacto y ubicación"); change("Teléfono", "5512345678"); edit("Idiomas"); fireEvent.click(screen.getByRole("button", { name: "Quitar idioma 2" })); save();
    await screen.findByText("No pudimos confirmar si se guardó");
    mocks.load.mockResolvedValue({ ok: true, data: { ...loaded.data, profile: { ...wire, phone: "+525512345678" } } });
    fireEvent.click(within(header()).getByRole("button", { name: "Comprobar" }));
    await screen.findByText("Perfil comprobado.");
    expect(screen.queryByLabelText("Idioma 2")).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
    mocks.save.mockResolvedValue({ kind: "saved", languages: { languages: [CANDIDATE_PROFILE.languages[0]] } });
    save(); await screen.findByText("Perfil guardado.");
    expect(mocks.save.mock.calls[1][0]).not.toHaveProperty("profile");
  });
  it("renders shared location errors, preserves dirty fields and never marks a failed profile saved", async () => {
    mocks.save.mockResolvedValue({ kind: "failed", part: "profile", failure: { ok: false, reason: "invalid_location", reference: { status: 422 }, locationIssues: [{ field: "state", reason: "unknown" }] } });
    await ready(); edit("Contacto y ubicación"); change("Teléfono", "5512345678"); save();
    await screen.findByText("Elige una opción de la lista.");
    expect(screen.getByLabelText("Estado")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Teléfono")).toHaveValue("5512345678");
    expect(saveButton()).toBeEnabled();
  });
  it("uncertain writes require read-only Comprobar, preserving edits and keeping the write lock on read failure", async () => {
    mocks.save.mockResolvedValue({ kind: "uncertain", part: "profile", failure: { ok: false, reason: "no_response", reference: {} } });
    await ready(); edit("Contacto y ubicación"); change("Teléfono", "5512345678"); save();
    await screen.findByText("No pudimos confirmar si se guardó");
    expect(saveButton()).toBeDisabled();
    expect(within(bar()!).getByRole("button", { name: "Comprobar" })).toBeEnabled();
    mocks.load.mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} });
    fireEvent.click(within(header()).getByRole("button", { name: "Comprobar" }));
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
    expect(saveButton()).toBeDisabled();
    mocks.load.mockResolvedValueOnce({ ok: true, data: { ...loaded.data, profile: { ...wire, phone: "+525512345678" } } });
    fireEvent.click(within(header()).getByRole("button", { name: "Comprobar" }));
    await screen.findByText("Perfil comprobado.");
    expect(screen.getByLabelText("Teléfono")).toHaveValue("5512345678");
    expect(saveButton()).toBeDisabled();
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it("maps bracketed server paths and focuses the first invalid field in visual order", async () => {
    mocks.save.mockResolvedValue({ kind: "failed", part: "profile", failure: { ok: false, reason: "invalid_request", reference: { status: 400, code: "validation_error" }, fields: [{ field: "education[0].status", code: "invalid" }, { field: "years_of_experience", code: "invalid" }] } });
    await ready(); edit("Contacto y ubicación"); change("Teléfono", "5512345678"); save();
    expect(await screen.findByLabelText("Años de experiencia")).toHaveFocus();
    expect(screen.getByLabelText("Años de experiencia")).toHaveAttribute("aria-invalid", "true");
    expect(within(section("Educación y habilidades")).getByText("Revisa los datos")).toBeVisible();
    edit("Educación y habilidades"); expect(screen.getByLabelText("Estatus")).toHaveAttribute("aria-invalid", "true");
  });
});
