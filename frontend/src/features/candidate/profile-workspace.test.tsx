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
// Base UI's positioner keeps jsdom busy while a popover is open; a light stand-in keeps the same parts and roles.
vi.mock("@/components/ui/popover", async () => {
  const React = await import("react");
  const Open = React.createContext<{ open: boolean; toggle: () => void; titleId: string }>({ open: false, toggle: () => {}, titleId: "" });
  return {
    Popover: ({ children }: { children: ReactNode }) => {
      const [open, setOpen] = React.useState(false);
      const titleId = React.useId();
      return <Open.Provider value={{ open, toggle: () => setOpen(value => !value), titleId }}>{children}</Open.Provider>;
    },
    PopoverTrigger: ({ render: element, children }: { render: React.ReactElement<Record<string, unknown>>; children: ReactNode }) => {
      const { open, toggle } = React.useContext(Open);
      return React.cloneElement(element, { "aria-expanded": open, "aria-haspopup": "dialog", onClick: toggle }, children);
    },
    PopoverContent: ({ children }: { children: ReactNode }) => {
      const { open, titleId } = React.useContext(Open);
      return open ? <div role="dialog" data-open="" aria-labelledby={titleId}>{children}</div> : null;
    },
    PopoverTitle: ({ children }: { children: ReactNode }) => <h2 id={React.useContext(Open).titleId}>{children}</h2>,
    PopoverDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});
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
const COMPANY_LINE = "Nombre, correo, teléfono, ubicación, título profesional, años de experiencia, seniority, tu nivel de estudios más alto, habilidades e idiomas.";
const COPY_LINE = "Recibe una copia de estos datos al momento de postularte; si después editas tu perfil, esa copia no cambia (salvo tu teléfono).";

const header = () => screen.getByRole("heading", { level: 2, name: "Tu perfil" }).closest("header") as HTMLElement;
const identity = () => screen.getByRole("article", { name: "Ximena Barrera" });
const tab = (name: string) => screen.getByRole("tab", { name: new RegExp(`^${name}`) });
const panel = () => screen.getByRole("tabpanel");
const bar = () => screen.queryByRole("region", { name: /^(Cambios sin guardar|Crear tu perfil)$/ });
const show = (name: string) => fireEvent.click(tab(name));
/** Opens a tab and, unless it is already in edit mode, presses its «Editar». */
function edit(name: string) {
  show(name);
  const button = within(panel()).queryByRole("button", { name: `Editar ${name}` });
  if (button) fireEvent.click(button);
}
const change = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
async function selectDial(dial: string) {
  const name = dial === "+52" ? "México" : "Estados Unidos";
  change("Lada de país", name);
  fireEvent.click(await screen.findByRole("option", { name: `${name} ${dial}` }));
}
const saveButton = () => within(bar()!).getByRole("button", { name: /^(Guardar perfil|Guardando…)$/ });
const save = () => fireEvent.click(within(bar()!).getByRole("button", { name: "Guardar perfil" }));
const restore = () => fireEvent.click(within(bar()!).getByRole("button", { name: "Restaurar copia original" }));
/** Closes «¿Qué ve una empresa?» through its trigger. */
function closeWho() {
  fireEvent.click(within(identity()).getByRole("button", { name: "¿Qué ve una empresa?" }));
  expect(document.querySelector('[role="dialog"][data-open]')).toBeNull();
}
const locks = () => Array.from(panel().querySelectorAll("[data-pf-profile-lock]")).map(node => node.getAttribute("data-pf-profile-lock"));
async function ready() { const view = render(<ProfileWorkspace />); await screen.findByRole("heading", { level: 2, name: "Tu perfil" }); return view; }
beforeEach(() => { vi.resetAllMocks(); mocks.load.mockResolvedValue(loaded); mocks.save.mockResolvedValue({ kind: "saved", profile: { ...wire, phone: "+525512345678" } }); });
afterEach(cleanup);

describe("S3 profile phone saves", () => {
  it.each([["+52", "5512345678", "+525512345678"], ["+1", "2125551234", "+12125551234"]])("sends %s with ten national digits as E.164", async (dial, phone, expected) => {
    await ready(); edit("Personal"); await selectDial(dial); change("Teléfono", phone); save();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][0].profile.phone).toBe(expected);
  });
  it.each([["+52", "123", "Escribe los 10 dígitos del teléfono en México."], ["+1", "abc", "Escribe una lada y un número válidos, de 8 a 15 dígitos en total."]])("rejects invalid %s and jumps back to Personal to focus the phone from another tab", async (dial, phone, message) => {
    await ready(); edit("Personal"); await selectDial(dial); change("Teléfono", phone); edit("Educación");
    expect(screen.queryByLabelText("Teléfono")).not.toBeInTheDocument();
    save();
    await waitFor(() => expect(screen.getByLabelText("Teléfono")).toHaveFocus());
    expect(tab("Personal")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Teléfono")).toHaveAccessibleDescription(expect.stringContaining(message));
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("clears legacy text to null even though the original baseline is invalid", async () => {
    mocks.load.mockResolvedValue({ ...loaded, data: { ...loaded.data, profile: { ...wire, phone: "texto heredado" } } });
    await ready(); edit("Personal"); change("Teléfono", ""); save();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][0].profile.phone).toBeNull();
  });
  it("loads an unreadable legacy phone verbatim, rejects it, and lets the user correct it", async () => {
    mocks.load.mockResolvedValue({ ...loaded, data: { ...loaded.data, profile: { ...wire, phone: "llamar por la tarde" } } });
    await ready();
    expect(within(panel()).getByText("llamar por la tarde")).toBeVisible();
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
    await ready(); edit("Personal");
    expect(screen.getByLabelText("Lada de país")).toHaveValue("México +52");
    expect(screen.getByLabelText("Teléfono")).toHaveValue("5512345678");
    edit("Experiencia"); change("Título profesional", "Nuevo título"); save();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][0].profile.phone).toBe("+525512345678");
  });
  it.each([["+52", "Escribe los 10 dígitos del teléfono en México."], ["+1", "Escribe una lada y un número válidos, de 8 a 15 dígitos en total."]])("maps backend phone invalid with the %s message and focus", async (dial, message) => {
    mocks.save.mockResolvedValue({ kind: "failed", part: "profile", failure: { ok: false, reason: "invalid_request", reference: { status: 400 }, fields: [{ field: "phone", code: "invalid" }] } });
    await ready(); edit("Personal"); await selectDial(dial); change("Teléfono", "2125551234"); edit("Educación"); save();
    await waitFor(() => expect(screen.getByLabelText("Teléfono")).toHaveFocus());
    expect(screen.getByLabelText("Teléfono")).toHaveAccessibleDescription(expect.stringContaining(message));
  });
});

describe("artboard 01 «Identidad a la izquierda y pestañas»", () => {
  it("heads the page with «Tu perfil» and the update date only: no page buttons and no save bar without changes", async () => {
    await ready();
    expect(within(header()).getByText("Actualizado el 12 de noviembre de 2026")).toBeVisible();
    expect(within(header()).queryAllByRole("button")).toHaveLength(0);
    expect(bar()).toBeNull();
    expect(screen.queryByRole("button", { name: "Guardar perfil" })).not.toBeInTheDocument();
  });

  it("shows the identity card: initials, name, title badge, Ubicación and Experiencia tiles, skills and the completeness meter", async () => {
    await ready();
    const card = identity();
    expect(within(card).getByText("XB")).toBeInTheDocument();
    expect(within(card).getByRole("heading", { level: 3, name: "Ximena Barrera" })).toBeVisible();
    expect(within(card).getByText("Desarrolladora Frontend Senior")).toHaveAttribute("data-slot", "badge");
    const tiles = within(card).getByRole("list", { name: "Datos principales" });
    expect(within(tiles).getAllByRole("listitem").map(item => item.textContent)).toEqual(["UbicaciónCiudad de México", "Experiencia9 años · Senior"]);
    expect(within(within(card).getByRole("list", { name: "Habilidades" })).getAllByRole("listitem").map(item => item.textContent)).toEqual(["react", "typescript", "node.js", "design systems"]);
    expect(within(card).queryByRole("button", { name: /más$/ })).not.toBeInTheDocument();
    expect(within(card).getByRole("img", { name: "Perfil completo al 100 %" })).toBeInTheDocument();
    expect(within(card).getByText("10 de 10")).toBeVisible();
    expect(within(card).getByText("Perfil completo")).toBeVisible();
    // Private facts never sit on the identity card.
    for (const secret of ["Ámbar Studio", "linkedin", "ximenabarrera.dev", "1994", "62,000", "75,000"]) expect(card).not.toHaveTextContent(secret);
  });

  it("shows six skills, expands «+N más» in place, and hides the skills in the compact 390 px card", async () => {
    const skills = ["react", "typescript", "node.js", "design systems", "css", "testing", "a11y", "graphql", "figma"];
    mocks.load.mockResolvedValue({ ...loaded, data: { ...loaded.data, profile: { ...wire, skills } } });
    await ready();
    const list = () => within(identity()).getByRole("list", { name: "Habilidades" });
    expect(within(list()).getAllByRole("listitem").filter(item => !item.querySelector("button")).map(item => item.textContent)).toEqual(skills.slice(0, 6));
    const more = within(list()).getByRole("button", { name: "+3 más" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(within(list()).getAllByRole("listitem").filter(item => !item.querySelector("button")).map(item => item.textContent)).toEqual(skills);
    expect(within(list()).getByRole("button", { name: "Ver menos" })).toHaveAttribute("aria-expanded", "true");
    expect(within(list()).getByRole("button", { name: "Ver menos" })).toHaveFocus();
    expect(identity().querySelector("[data-pf-profile-skills]")).toHaveClass("max-sm:hidden");
  });

  it("offers five tabs with one tab stop, Left/Right with wrap and Home/End", async () => {
    await ready();
    const list = screen.getByRole("tablist", { name: "Secciones del perfil" });
    expect(within(list).getAllByRole("tab").map(node => node.textContent)).toEqual(["Personal", "Experiencia", "Educación", "Compensación (solo tú)", "Idiomas"]);
    const stops = () => within(list).getAllByRole("tab").map(node => node.tabIndex);
    expect(stops()).toEqual([0, -1, -1, -1, -1]);
    expect(tab("Personal")).toHaveAttribute("aria-selected", "true");
    expect(panel()).toHaveAttribute("aria-labelledby", tab("Personal").id);
    fireEvent.keyDown(tab("Personal"), { key: "ArrowRight" });
    expect(tab("Experiencia")).toHaveAttribute("aria-selected", "true");
    expect(tab("Experiencia")).toHaveFocus();
    expect(stops()).toEqual([-1, 0, -1, -1, -1]);
    expect(panel()).toHaveAttribute("aria-labelledby", tab("Experiencia").id);
    fireEvent.keyDown(tab("Experiencia"), { key: "ArrowLeft" });
    fireEvent.keyDown(tab("Personal"), { key: "ArrowLeft" });
    expect(tab("Idiomas")).toHaveFocus();
    expect(tab("Idiomas")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tab("Idiomas"), { key: "ArrowRight" });
    expect(tab("Personal")).toHaveFocus();
    fireEvent.keyDown(tab("Personal"), { key: "End" });
    expect(tab("Idiomas")).toHaveFocus();
    fireEvent.keyDown(tab("Idiomas"), { key: "Home" });
    expect(tab("Personal")).toHaveFocus();
    expect(tab("Personal")).toHaveAttribute("aria-selected", "true");
  });

  it("reads each tab like the artboard, with no level dots", async () => {
    await ready();
    for (const text of ["+52 55 4821 7790", "Ciudad de México", "ximena.barrera@correo.mx", "linkedin.com/in/ximena-barrera", "ximenabarrera.dev"]) expect(within(panel()).getByText(text)).toBeVisible();
    expect(within(panel()).queryByText(/nacimiento/iu)).not.toBeInTheDocument();
    show("Experiencia");
    for (const text of ["Desarrolladora Frontend Senior", "Ámbar Studio", "9 años", "Senior", CANDIDATE_PROFILE.summary!]) expect(within(panel()).getByText(text)).toBeVisible();
    show("Educación");
    expect(within(panel()).getByText("Licenciatura o Ingeniería")).toBeVisible();
    expect(within(panel()).getByText("Ingeniería en Sistemas Computacionales · Concluido")).toBeVisible();
    expect(within(within(panel()).getByRole("list", { name: "Tus habilidades" })).getAllByRole("listitem").map(item => item.textContent)).toEqual(["react", "typescript", "node.js", "design systems"]);
    show("Compensación");
    for (const text of ["$62,000 MXN", "$48,000 MXN", "$75,000 MXN", "MXN", "Mensual"]) expect(within(panel()).getByText(text)).toBeVisible();
    show("Idiomas");
    expect(within(within(panel()).getByRole("list", { name: "Tus idiomas" })).getAllByRole("listitem").map(item => item.textContent)).toEqual(["EspañolC2 · Dominio", "InglésB2 · Intermedio alto"]);
    expect(document.querySelector("[data-pf-profile-level-dots]")).toBeNull();
  });

  it("is read-only until «Editar»; edit mode tints the panel and shows «Listo», plus «Descartar cambios» only with changes", async () => {
    await ready();
    expect(screen.queryByLabelText("Teléfono")).not.toBeInTheDocument();
    expect(panel()).not.toHaveAttribute("data-editing");
    fireEvent.click(within(panel()).getByRole("button", { name: "Editar Personal" }));
    expect(panel()).toHaveAttribute("data-editing", "true");
    await waitFor(() => expect(screen.getByLabelText("Teléfono")).toHaveFocus());
    expect(within(panel()).getByRole("button", { name: "Listo" })).toBeVisible();
    expect(within(panel()).queryByRole("button", { name: /^Descartar cambios/ })).not.toBeInTheDocument();
    change("Teléfono", "5512345678");
    expect(within(panel()).getByRole("button", { name: "Descartar cambios de personal" })).toHaveTextContent("Descartar cambios");
    fireEvent.click(within(panel()).getByRole("button", { name: "Listo" }));
    expect(screen.queryByLabelText("Teléfono")).not.toBeInTheDocument();
    expect(within(panel()).getByText("+52 55 1234 5678")).toBeVisible();
    await waitFor(() => expect(within(panel()).getByRole("button", { name: "Editar Personal" })).toHaveFocus());
    // Switching tabs leaves edit mode; the draft is kept.
    edit("Experiencia");
    show("Compensación");
    expect(screen.queryByLabelText("Título profesional")).not.toBeInTheDocument();
    expect(within(panel()).getByRole("button", { name: "Editar Compensación" })).toBeVisible();
  });

  it("marks changed tabs with a dot and shows the save bar only while something changed", async () => {
    await ready();
    expect(bar()).toBeNull();
    edit("Experiencia"); change("Título profesional", "Nuevo título");
    expect(tab("Experiencia")).toHaveAccessibleName("Experiencia (cambios sin guardar)");
    expect(tab("Personal")).toHaveAccessibleName("Personal");
    const region = bar()!;
    expect(region).toHaveAccessibleName("Cambios sin guardar");
    expect(within(region).getByText("Cambios sin guardar")).toBeVisible();
    expect(within(region).getByText("En Experiencia")).toBeVisible();
    expect(within(region).getAllByRole("button").map(button => button.textContent)).toEqual(["Restaurar copia original", "Guardar perfil"]);
    edit("Compensación"); change("Salario esperado", "80000");
    expect(within(bar()!).getByText("En Experiencia y Compensación")).toBeVisible();
    restore();
    expect(screen.getByText("Restauramos la copia original en esta vista.")).toBeInTheDocument();
    expect(bar()).toBeNull();
    expect(tab("Experiencia")).toHaveAccessibleName("Experiencia");
  });

  it("discards only the current tab's changes", async () => {
    await ready();
    edit("Personal"); change("Teléfono", "5512345678");
    edit("Experiencia"); change("Título profesional", "Nuevo título");
    fireEvent.click(within(panel()).getByRole("button", { name: "Descartar cambios de experiencia" }));
    expect(screen.getByLabelText("Título profesional")).toHaveValue(CANDIDATE_PROFILE.professionalTitle);
    expect(within(panel()).queryByRole("button", { name: /^Descartar cambios/ })).not.toBeInTheDocument();
    expect(tab("Experiencia")).toHaveAccessibleName("Experiencia");
    expect(tab("Personal")).toHaveAccessibleName("Personal (cambios sin guardar)");
    show("Personal");
    expect(within(panel()).getByText("+52 55 1234 5678")).toBeVisible();
  });

  it("links only the NEXT missing item, opening its tab in edit mode and focusing the field", async () => {
    mocks.load.mockResolvedValue({ ...loaded, data: { profile: { ...wire, phone: null, current_company: null, location: null }, languages: { languages: [] } } });
    await ready();
    const card = identity();
    expect(within(card).getByRole("img", { name: "Perfil completo al 60 %" })).toBeInTheDocument();
    expect(within(card).getByText("6 de 10")).toBeVisible();
    const meter = card.querySelector("[data-pf-profile-meter]") as HTMLElement;
    expect(within(meter).getAllByRole("button").map(button => button.textContent)).toEqual(["Agrega tu empresa actual"]);
    fireEvent.click(within(meter).getByRole("button", { name: "Agrega tu empresa actual" }));
    expect(tab("Experiencia")).toHaveAttribute("aria-selected", "true");
    expect(panel()).toHaveAttribute("data-editing", "true");
    await waitFor(() => expect(screen.getByLabelText(/^Empresa actual o última/)).toHaveFocus());
    // The live draft counts: the meter moves on before saving.
    change(/^Empresa actual o última/, "Ámbar Studio");
    expect(within(identity()).getByText("7 de 10")).toBeVisible();
    fireEvent.click(within(identity()).getByRole("button", { name: "Agrega tu teléfono" }));
    expect(tab("Personal")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByLabelText("Teléfono")).toHaveFocus());
    change("Teléfono", "5512345678");
    fireEvent.click(within(identity()).getByRole("button", { name: "Agrega tu ubicación" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "País" })).toHaveFocus());
  });

  it("lands on «Agregar idioma» when languages are the next missing item", async () => {
    mocks.load.mockResolvedValue({ ...loaded, data: { ...loaded.data, languages: { languages: [] } } });
    await ready();
    fireEvent.click(within(identity()).getByRole("button", { name: "Agrega tus idiomas" }));
    expect(tab("Idiomas")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(screen.getByRole("button", { name: "Agregar idioma" })).toHaveFocus());
  });

  it("jumps to the tab of a validation error on save, opens edit mode and focuses the field with its message", async () => {
    await ready();
    edit("Personal"); change(/^Perfil de LinkedIn/, "not-url");
    edit("Compensación"); change("Moneda", "");
    save();
    expect(tab("Personal")).toHaveAttribute("aria-selected", "true");
    expect(panel()).toHaveAttribute("data-editing", "true");
    await waitFor(() => expect(screen.getByLabelText(/^Perfil de LinkedIn/)).toHaveFocus());
    expect(screen.getByLabelText(/^Perfil de LinkedIn/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/^Perfil de LinkedIn/)).toHaveAccessibleDescription(expect.stringContaining("La URL de LinkedIn no es una URL válida."));
    expect(screen.getByText("Revisa los datos marcados")).toBeInTheDocument();
    expect(tab("Compensación")).toHaveAccessibleName("Compensación (solo tú) (revisa los datos)");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("builds «¿Qué ve una empresa?» from the visibility map, with the copy-at-application line", async () => {
    await ready();
    fireEvent.click(within(identity()).getByRole("button", { name: "¿Qué ve una empresa?" }));
    const pop = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(pop).toHaveAccessibleName("¿Qué ve una empresa?");
    expect(within(pop).getByText(COMPANY_LINE)).toBeInTheDocument();
    expect(within(pop).getByText("Y el CV que elijas al postularte.")).toBeInTheDocument();
    expect(within(pop).getByText(COPY_LINE)).toBeInTheDocument();
    closeWho();
  });

  it("drops the professional title from the popover and locks it when its single map entry flips to private", async () => {
    const original = PROFILE_VISIBILITY.professionalTitle;
    try {
      PROFILE_VISIBILITY.professionalTitle = "private";
      await ready();
      fireEvent.click(within(identity()).getByRole("button", { name: "¿Qué ve una empresa?" }));
      const pop = document.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(pop).toHaveAccessibleName("¿Qué ve una empresa?");
      expect(pop).not.toHaveTextContent("título profesional");
      expect(pop).toHaveTextContent("Nombre, correo, teléfono, ubicación, años de experiencia");
      closeWho();
      show("Experiencia");
      expect(locks()).toEqual(["professionalTitle", "currentCompany", "summary"]);
    } finally { PROFILE_VISIBILITY.professionalTitle = original; }
  });

  it("puts locks only on private labels, one line per tab with private data, and none on Idiomas", async () => {
    await ready();
    const line = "Solo tú · la empresa no lo recibe";
    expect(within(panel()).getByText(line, { exact: false }).closest("p")).toHaveTextContent(line);
    expect(locks()).toEqual(["linkedinUrl", "portfolioUrl"]);
    expect(within(panel()).queryByText(/nacimiento/iu)).not.toBeInTheDocument();
    expect(within(panel()).getByText("Teléfono").closest("dt")).toHaveTextContent(/^Teléfono$/);
    show("Experiencia");
    expect(within(panel()).getByText(line, { exact: false }).closest("p")).toHaveTextContent(line);
    expect(locks()).toEqual(["currentCompany", "summary"]);
    show("Educación");
    expect(within(panel()).getByText(line, { exact: false }).closest("p")).toHaveTextContent(line);
    expect(locks()).toEqual(["educationDetails"]);
    show("Compensación");
    expect(within(panel()).getByText("Solo tú ves esta pestaña")).toBeVisible();
    expect(within(panel()).queryByText(line, { exact: false })).not.toBeInTheDocument();
    expect(locks()).toEqual([]);
    show("Idiomas");
    expect(within(panel()).queryByText(/Solo tú/)).not.toBeInTheDocument();
    expect(locks()).toEqual([]);
    // Edit mode keeps the locks on the private labels only.
    edit("Personal");
    expect(screen.getByLabelText("Perfil de LinkedIn (solo tú)")).toBeInTheDocument();
    expect(screen.getByLabelText("Teléfono")).toBeInTheDocument();
    expect(locks()).toEqual(["linkedinUrl", "portfolioUrl"]);
    edit("Educación");
    expect(locks()).toEqual(["educationDetails"]);
  });

  it("keeps one form, novalidate, and every field in its tab", async () => {
    const { container } = await ready();
    expect(container.querySelectorAll("form")).toHaveLength(1);
    expect(container.querySelector("form")).toHaveAttribute("novalidate");
    const expected = [
      ["Personal", ["dial", "phone", "linkedinUrl", "portfolioUrl", "location"]],
      ["Experiencia", ["professionalTitle", "currentCompany", "yearsOfExperience", "seniority", "summary"]],
      ["Educación", ["education.0.level", "education.0.institution", "education.0.field", "education.0.status", "education.0.start_year", "education.0.end_year", "skills"]],
      ["Compensación", ["currentSalaryGross", "currentSalaryNet", "salaryCurrency", "expectedSalary", "expectedSalaryPeriod"]],
      ["Idiomas", ["languages.0.code", "languages.0.level", "languages.1.code", "languages.1.level"]],
    ] as const;
    for (const [name, fields] of expected) {
      edit(name);
      expect(Array.from(panel().querySelectorAll("[data-pf-profile-field]")).map(node => node.getAttribute("data-pf-profile-field"))).toEqual(fields);
    }
    edit("Personal");
    const country = screen.getByRole("combobox", { name: "País" });
    const help = screen.getByText("Opcional. Algunas vacantes solo aceptan postulantes de ciertos países.");
    expect(country).toHaveAccessibleDescription(help.textContent!);
    expect(screen.queryByLabelText("Código postal")).not.toBeInTheDocument();
    expect(within(panel()).getByRole("group", { name: "Contacto" })).toContainElement(screen.getByLabelText("Teléfono"));
    expect(screen.queryByLabelText(/nacimiento/iu)).not.toBeInTheDocument();
  });

  it("offers «Quitar» for the location inside the Ubicación group", async () => {
    await ready(); edit("Personal");
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
    expect(within(panel()).getByText("+52 55 4821 7790")).toBeVisible();
    edit("Personal");
    expect(screen.getByLabelText("Teléfono")).toHaveValue("5548217790");
    expect(screen.getByLabelText("Lada de país")).toHaveValue("México +52");
    expect(bar()).toBeNull();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("opens a new profile with «Agregar …» placeholders and the «se crea al guardar» bar, creates it on save and then saves normally", async () => {
    mocks.load.mockResolvedValue({ ok: true, data: { profile: null, languages: { languages: [{ code: "en", level: "B2" }] } } });
    const created = { ...wire, ...emptyWire };
    mocks.save.mockResolvedValueOnce({ kind: "saved", profile: created, languages: { languages: [] } });
    await ready();
    expect(within(header()).getByText("Se crea al guardar por primera vez")).toBeVisible();
    expect(within(identity()).getByText("1 de 10")).toBeVisible();
    expect(within(identity()).getByRole("button", { name: "Agrega tu título profesional" })).toBeVisible();
    expect(within(identity()).getAllByText("Sin dato")).toHaveLength(2);
    for (const [name, action] of [["Experiencia", "Agregar experiencia"], ["Educación", "Agregar estudio"], ["Compensación", "Agregar compensación"]]) {
      show(name); expect(within(panel()).getByRole("button", { name: action })).toBeVisible();
    }
    const create = screen.getByRole("region", { name: "Crear tu perfil" });
    expect(within(create).getByText("Tu perfil todavía no existe")).toBeVisible();
    expect(within(create).getByText("Se crea al guardar, aunque falten datos.")).toBeVisible();
    expect(saveButton()).toBeEnabled();
    show("Educación");
    fireEvent.click(within(panel()).getByRole("button", { name: "Agregar estudio" }));
    expect(panel()).toHaveAttribute("data-editing", "true");
    await waitFor(() => expect(within(panel()).getByRole("button", { name: "Agregar estudio" })).toHaveFocus());
    edit("Compensación"); expect(screen.getByLabelText("Moneda")).toHaveValue("MXN");
    edit("Idiomas"); fireEvent.click(screen.getByRole("button", { name: "Quitar idioma 1" }));
    expect(within(screen.getByRole("region", { name: "Cambios sin guardar" })).getByText("Se crea al guardar, aunque falten datos.")).toBeVisible();
    save();
    await screen.findByText("Perfil creado.");
    expect(mocks.save).toHaveBeenCalledWith({ profile: emptyWire, languages: { languages: [] } });
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Perfil creado." }));
    expect(screen.queryByText(/se crea al guardar/i)).not.toBeInTheDocument();
    expect(bar()).toBeNull();
    mocks.save.mockResolvedValueOnce({ kind: "saved", profile: { ...created, phone: "+525512345678" } });
    edit("Personal"); change("Teléfono", "5512345678"); save();
    await screen.findByText("Perfil guardado.");
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Perfil guardado." }));
    expect(mocks.save.mock.calls[1][0]).toEqual({ profile: { ...emptyWire, phone: "+525512345678" } });
  });

  it("raises toasts above the save bar", async () => {
    await ready(); edit("Personal"); change("Teléfono", "5512345678");
    expect(bar()).toHaveAttribute("data-pf-draft-save-bar");
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
    await ready(); edit("Personal"); change("Teléfono", "5512345678"); save();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][0]).toEqual({ profile: { ...profileToWrite(valid.profile), phone: "+525512345678" } });
    await screen.findByText("Perfil guardado.");
    expect(bar()).toBeNull();
    expect(panel()).not.toHaveAttribute("data-editing");
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Perfil guardado." }));
  });
  it("clears optional location with null and does not silently reinstate MX", async () => {
    await ready(); edit("Personal"); fireEvent.click(screen.getByRole("button", { name: "Quitar ubicación" })); save();
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0][0].profile.location).toBeNull();
  });
  it("retains edits across tabs and Restaurar restores the confirmed baseline", async () => {
    await ready(); edit("Personal"); change("Teléfono", "5512345678"); edit("Experiencia"); change("Título profesional", "Nuevo título"); edit("Personal");
    expect(screen.getByLabelText("Teléfono")).toHaveValue("5512345678");
    restore();
    expect(screen.getByText("Restauramos la copia original en esta vista.")).toBeInTheDocument();
    expect(screen.getByLabelText("Teléfono")).toHaveValue("5548217790");
    edit("Experiencia"); expect(screen.getByLabelText("Título profesional")).toHaveValue(CANDIDATE_PROFILE.professionalTitle);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("focuses the phone before LinkedIn errors in the visual order", async () => {
    mocks.save.mockResolvedValue({ kind: "failed", part: "profile", failure: { ok: false, reason: "invalid_request", reference: {}, fields: [{ field: "linkedin_url", code: "invalid" }, { field: "phone", code: "invalid" }] } });
    await ready(); edit("Personal"); change("Teléfono", "5512345678"); save();
    await waitFor(() => expect(screen.getByLabelText("Teléfono")).toHaveFocus());
  });
  it("rejects a language with empty code and level before writing either block", async () => {
    await ready(); edit("Personal"); change("Teléfono", "5512345678"); edit("Idiomas"); fireEvent.click(screen.getByRole("button", { name: "Agregar idioma" })); save();
    await waitFor(() => expect(screen.getByLabelText("Idioma 3")).toHaveFocus());
    expect(screen.getByLabelText("Nivel del idioma 3")).toHaveAttribute("aria-invalid", "true");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("locks controls and double submissions during a write", async () => {
    let resolve!: (value: unknown) => void; mocks.save.mockReturnValue(new Promise(r => { resolve = r; }));
    await ready(); edit("Personal"); change("Teléfono", "5512345678"); save();
    expect(within(bar()!).getByRole("button", { name: "Guardando…" })).toBeDisabled();
    expect(within(bar()!).getByText("Guardando tu perfil…")).toBeVisible();
    expect(screen.getByLabelText("Teléfono")).toBeDisabled();
    expect(screen.getByLabelText("Lada de país")).toBeDisabled();
    await act(async () => resolve({ kind: "saved", profile: { ...wire, phone: "+525512345678" } }));
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it("keeps only language edits dirty after partial success and retries only that block", async () => {
    const languages = { languages: [CANDIDATE_PROFILE.languages[0]] };
    mocks.save.mockResolvedValueOnce({ kind: "partial", profile: { ...wire, phone: "+525512345678" }, failure: { ok: false, reason: "invalid_request", reference: { status: 400 } } }).mockResolvedValueOnce({ kind: "saved", languages });
    await ready(); edit("Personal"); change("Teléfono", "5512345678"); edit("Idiomas"); fireEvent.click(screen.getByRole("button", { name: "Quitar idioma 2" })); save();
    await screen.findByText("Guardamos tu perfil, pero no los idiomas. Revisa y vuelve a guardar.");
    expect(screen.queryByLabelText("Idioma 2")).not.toBeInTheDocument();
    expect(within(bar()!).getByText("En Idiomas")).toBeVisible();
    expect(tab("Personal")).toHaveAccessibleName("Personal");
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
    expect(within(within(panel()).getByRole("list", { name: "Tus idiomas" })).getAllByRole("listitem")).toHaveLength(1);
    expect(bar()).toBeNull();
  });
  it("preserves both edited blocks after a definite profile failure", async () => {
    mocks.save.mockResolvedValue({ kind: "failed", part: "profile", failure: { ok: false, reason: "invalid_request", reference: { status: 400 } } });
    await ready(); edit("Personal"); change("Teléfono", "5512345678"); edit("Idiomas"); fireEvent.click(screen.getByRole("button", { name: "Quitar idioma 2" })); save();
    await screen.findByText("No se guardó el perfil");
    expect(screen.queryByLabelText("Idioma 2")).not.toBeInTheDocument();
    edit("Personal"); expect(screen.getByLabelText("Teléfono")).toHaveValue("5512345678");
    restore();
    expect(screen.getByLabelText("Teléfono")).toHaveValue("5548217790");
    edit("Idiomas"); expect(screen.getByLabelText("Idioma 2")).toHaveValue("Inglés");
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it("says the session expired when the save is unauthenticated", async () => {
    mocks.save.mockResolvedValue({ kind: "failed", part: "profile", failure: { ok: false, reason: "unauthenticated", reference: {} } });
    await ready(); edit("Personal"); change("Teléfono", "5512345678"); save();
    await screen.findByText("Tu sesión expiró");
    expect(screen.getByLabelText("Teléfono")).toHaveValue("5512345678");
  });
  it("reconciles uncertain language writes without discarding rows that were not saved", async () => {
    mocks.save.mockResolvedValue({ kind: "uncertain", part: "languages", profile: { ...wire, phone: "+525512345678" }, failure: { ok: false, reason: "no_response", reference: {} } });
    await ready(); edit("Personal"); change("Teléfono", "5512345678"); edit("Idiomas"); fireEvent.click(screen.getByRole("button", { name: "Quitar idioma 2" })); save();
    await screen.findByText("No pudimos confirmar si se guardó");
    mocks.load.mockResolvedValue({ ok: true, data: { ...loaded.data, profile: { ...wire, phone: "+525512345678" } } });
    fireEvent.click(within(bar()!).getByRole("button", { name: "Comprobar" }));
    await screen.findByText("Perfil comprobado.");
    expect(screen.queryByLabelText("Idioma 2")).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
    mocks.save.mockResolvedValue({ kind: "saved", languages: { languages: [CANDIDATE_PROFILE.languages[0]] } });
    save(); await screen.findByText("Perfil guardado.");
    expect(mocks.save.mock.calls[1][0]).not.toHaveProperty("profile");
  });
  it("renders shared location errors, preserves dirty fields and never marks a failed profile saved", async () => {
    mocks.save.mockResolvedValue({ kind: "failed", part: "profile", failure: { ok: false, reason: "invalid_location", reference: { status: 422 }, locationIssues: [{ field: "state", reason: "unknown" }] } });
    await ready(); edit("Personal"); change("Teléfono", "5512345678"); save();
    await screen.findByText("Elige una opción de la lista.");
    expect(screen.getByLabelText("Estado")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Teléfono")).toHaveValue("5512345678");
    expect(saveButton()).toBeEnabled();
  });
  it("uncertain writes require read-only Comprobar, preserving edits and keeping the write lock on read failure", async () => {
    mocks.save.mockResolvedValue({ kind: "uncertain", part: "profile", failure: { ok: false, reason: "no_response", reference: {} } });
    await ready(); edit("Personal"); change("Teléfono", "5512345678"); save();
    await screen.findByText("No pudimos confirmar si se guardó");
    expect(saveButton()).toBeDisabled();
    expect(within(bar()!).getByRole("button", { name: "Comprobar" })).toBeEnabled();
    mocks.load.mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} });
    fireEvent.click(within(bar()!).getByRole("button", { name: "Comprobar" }));
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
    expect(saveButton()).toBeDisabled();
    mocks.load.mockResolvedValueOnce({ ok: true, data: { ...loaded.data, profile: { ...wire, phone: "+525512345678" } } });
    fireEvent.click(within(bar()!).getByRole("button", { name: "Comprobar" }));
    await screen.findByText("Perfil comprobado.");
    expect(screen.getByLabelText("Teléfono")).toHaveValue("5512345678");
    expect(bar()).toBeNull();
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it("maps bracketed server paths and focuses the first invalid field in visual order", async () => {
    mocks.save.mockResolvedValue({ kind: "failed", part: "profile", failure: { ok: false, reason: "invalid_request", reference: { status: 400, code: "validation_error" }, fields: [{ field: "education[0].status", code: "invalid" }, { field: "years_of_experience", code: "invalid" }] } });
    await ready(); edit("Personal"); change("Teléfono", "5512345678"); save();
    expect(await screen.findByLabelText("Años de experiencia")).toHaveFocus();
    expect(tab("Experiencia")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Años de experiencia")).toHaveAttribute("aria-invalid", "true");
    expect(tab("Educación")).toHaveAccessibleName("Educación (revisa los datos)");
    edit("Educación"); expect(screen.getByLabelText("Estatus")).toHaveAttribute("aria-invalid", "true");
  });
});
