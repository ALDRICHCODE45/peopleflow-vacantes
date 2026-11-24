import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ComponentProps, ReactNode } from "react";

vi.mock("@/components/ui/combobox", async importOriginal => ({
  ...await importOriginal<typeof import("@/components/ui/combobox")>(),
  ComboboxContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ComboboxEmpty: () => null,
}));
// jsdom cannot position Base UI's portaled Select: a controlled native adapter (only the company-creation industry uses it).
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  type Value = { items: { value: string; label: string }[]; value: string | null; onValueChange: (value: string) => void; disabled?: boolean };
  const Context = React.createContext<Value | null>(null);
  function Select(props: Value & { children?: ReactNode }) { return <Context.Provider value={props}>{props.children}</Context.Provider>; }
  function SelectTrigger(props: ComponentProps<"select">) {
    const context = React.useContext(Context)!;
    return <select {...props} disabled={context.disabled} value={context.value ?? ""} onChange={event => context.onValueChange(event.target.value)}><option value="">Selecciona una industria</option>{context.items.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>;
  }
  const Empty = () => null;
  return { Select, SelectTrigger, SelectValue: Empty, SelectContent: Empty, SelectGroup: Empty, SelectItem: Empty };
});
vi.mock("@/features/employer-company/actions", () => ({ loadCompanyStateAction: vi.fn(), createCompanyAction: vi.fn(), updateCompanyLocationAction: vi.fn() }));
vi.mock("@/features/talent-base-visibility/actions", () => ({ loadTalentBaseVisibilityAction: vi.fn(), saveTalentBaseVisibilityAction: vi.fn() }));
vi.mock("@/features/employer-team/actions", () => ({ listTeamMembersAction: vi.fn() }));
vi.mock("@/features/geo/use-geo-catalog", () => ({
  useGeoCatalog: () => ({ countries: { status: "ready", data: { items: [{ id: "MX", name: "México" }] }, retry: vi.fn() }, states: { status: "ready", data: { items: [] }, retry: vi.fn() }, municipalities: { status: "ready", data: { items: [] }, retry: vi.fn() } }),
  useGeoPostalCode: () => ({ status: "idle" }),
}));
vi.mock("sileo", () => ({ sileo: { success: vi.fn(() => "t"), error: vi.fn(() => "t"), dismiss: vi.fn() } }));
import { sileo } from "sileo";
import { createCompanyAction, loadCompanyStateAction, updateCompanyLocationAction } from "@/features/employer-company/actions";
import type { CompanyState } from "@/features/employer-company/actions";
import { loadTalentBaseVisibilityAction } from "@/features/talent-base-visibility/actions";
import { listTeamMembersAction } from "@/features/employer-team/actions";
import { companyMembers, selectedByAna, visibility } from "@/features/talent-base-visibility/test-fixtures";
import { EmployerSettingsWorkspace } from "./settings-workspace";

const location = { country: { id: "MX", name: "México" }, state: { id: "19", name: "Nuevo León" }, municipality: { id: "19019", name: "San Pedro Garza García" }, postal_code: "66220", label: "San Pedro Garza García, Nuevo León, México" };
type Company = Extract<CompanyState, { kind: "exists" }>["company"];
const company: Company = { id: "c", name: "Grupo Altavista", rfc: "GAL140612QX4", industry_id: "i", status: "active", location, updated_at: "2026-10-20T12:00:00.123456789Z" };
const exists = (role: "owner" | "recruiter" | "stakeholder", overrides: Partial<Company> = {}): CompanyState => ({ kind: "exists", company: { ...company, ...overrides }, role, industryLabel: "Servicios empresariales y centros de contacto", canViewTalentBase: true });
const none: CompanyState = { kind: "none", industries: [{ id: "i", label_es: "Tecnología", label_en: "Technology", sort_order: 1 }] };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.removeAttribute("data-theme");
  vi.mocked(loadCompanyStateAction).mockResolvedValue(exists("owner"));
  vi.mocked(loadTalentBaseVisibilityAction).mockResolvedValue({ ok: true, document: selectedByAna });
  vi.mocked(listTeamMembersAction).mockResolvedValue({ ok: true, members: companyMembers });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

async function renderOwner() {
  const view = render(<EmployerSettingsWorkspace />);
  await screen.findByRole("region", { name: "Tu empresa" });
  return view;
}
const strip = () => screen.getByRole("region", { name: "Tu empresa" });
const group = (name: string) => screen.getByRole("region", { name });

describe("identity strip (S1, S5)", () => {
  it("shows the company's initials, name, RFC, industry, location, role and «Activa» state in one slim strip", async () => {
    await renderOwner();
    const bar = strip();
    expect(within(bar).getByText("GA")).toBeInTheDocument();
    expect(within(bar).getByRole("heading", { level: 2, name: "Grupo Altavista" })).toBeInTheDocument();
    expect(within(bar).getByText("GAL140612QX4")).toBeInTheDocument();
    expect(within(bar).getByText("Servicios empresariales y centros de contacto")).toBeInTheDocument();
    expect(within(bar).getByText("San Pedro Garza García, Nuevo León, México")).toBeInTheDocument();
    expect(within(bar).getByText("Dueño")).toBeInTheDocument();
    expect(within(bar).getByText("Activa")).toHaveAttribute("data-variant", "success");
    expect(within(bar).getByText("RFC").tagName).toBe("DT");
    // Slim: facts only, no form controls, no card header or footer.
    expect(bar.querySelector("[data-slot='card-header'], [data-slot='card-footer']")).toBeNull();
    expect(within(bar).getAllByRole("button").map(button => button.textContent)).toEqual(["Editar ubicación"]);
  });

  it("removes the two big cards: no «Datos de tu empresa» and no «Base de talento visible para» heading or card", async () => {
    await renderOwner();
    expect(screen.queryByRole("heading", { name: "Datos de tu empresa" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Datos de tu empresa" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Base de talento visible para" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Base de talento visible para" })).toBeNull();
    expect(screen.queryByText("Así está registrada tu empresa en PeopleFlow.")).toBeNull();
    expect(document.querySelector("#empresa-base-talento, #empresa-identidad")).toBeNull();
    // The only section headings are the three row groups; the company name is the strip's own title.
    expect(screen.getAllByRole("heading", { level: 2 }).map(heading => heading.textContent)).toEqual(["Grupo Altavista", "Organización", "Preferencias", "Próximamente"]);
    expect(screen.queryByRole("navigation", { name: "Secciones de configuración de empresa" })).toBeNull();
  });

  it.each([["pending_verification", "En verificación", "review"], ["suspended", "Suspendida", "danger"]] as const)("uses the semantic state %s", async (status, label, variant) => {
    vi.mocked(loadCompanyStateAction).mockResolvedValue(exists("owner", { status }));
    await renderOwner();
    expect(within(strip()).getByText(label)).toHaveAttribute("data-variant", variant);
  });

  it("derives initials from the first two words and says «Sin ubicación» without one", async () => {
    vi.mocked(loadCompanyStateAction).mockResolvedValue(exists("owner", { name: "acme", location: null }));
    await renderOwner();
    expect(within(strip()).getByText("A")).toBeInTheDocument();
    expect(within(strip()).getByText("Sin ubicación")).toHaveClass("text-muted-foreground");
  });
});

describe("rows (S5)", () => {
  it("groups Organización, Preferencias and Próximamente as rows inside three cards", async () => {
    const { container } = await renderOwner();
    expect(container.querySelectorAll("[data-slot='card']")).toHaveLength(4);
    expect(within(group("Organización")).getAllByRole("listitem")).toHaveLength(3);
    expect(within(group("Preferencias")).getAllByRole("listitem")).toHaveLength(1);
    expect(within(group("Próximamente")).getAllByRole("listitem")).toHaveLength(3);
    expect(container.querySelector("[data-pf-employer-settings-workspace]")).not.toBeNull();
  });

  it("shows the current Base de talento mode as the row's value and opens its sheet from «Cambiar»", async () => {
    await renderOwner();
    const org = group("Organización");
    const row = (await within(org).findByText("Base de talento visible para")).closest("li")!;
    expect(await within(row).findByText("1 reclutador")).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "Cambiar" }));
    const sheet = await screen.findByRole("dialog", { name: "Base de talento visible para" });
    expect(within(sheet).getByRole("radio", { name: /^Usuarios seleccionados/ })).toBeChecked();
  });

  it("shows «Todos los reclutadores» and «Solo el dueño» as the value of the other modes", async () => {
    vi.mocked(loadTalentBaseVisibilityAction).mockResolvedValue({ ok: true, document: visibility() });
    const { unmount } = await renderOwner();
    expect(await within(group("Organización")).findByText("Todos los reclutadores")).toBeInTheDocument();
    unmount();
    vi.mocked(loadTalentBaseVisibilityAction).mockResolvedValue({ ok: true, document: visibility({ mode: "selected_users", version: 2 }) });
    await renderOwner();
    expect(await within(group("Organización")).findByText("Solo el dueño")).toBeInTheDocument();
  });

  it("links the team and careers-site rows to the existing pages", async () => {
    await renderOwner();
    expect(screen.getByRole("link", { name: "Administrar equipo" })).toHaveAttribute("href", "/empresa/equipo");
    expect(screen.getByRole("link", { name: "Editar sitio" })).toHaveAttribute("href", "/empresa/sitio");
    expect(document.querySelector("a[href='#']")).toBeNull();
    expect(screen.queryByText("Plan y facturación")).toBeNull();
  });

  it("offers no exemption from the CV: every application requires one (INT-17)", async () => {
    await renderOwner();
    expect(screen.queryByText("Permitir postulaciones sin CV")).toBeNull();
    expect(screen.queryByText(/sin un CV/)).toBeNull();
  });

  it("uses the shared persistent theme preference as a segmented control, without adding a company theme", async () => {
    localStorage.setItem("pf-theme", "dark");
    await renderOwner();
    const theme = within(group("Preferencias")).getByRole("group", { name: "Tema de la interfaz" });
    expect(within(theme).getByRole("button", { name: "Oscuro" })).toHaveAttribute("aria-pressed", "true");
    expect(within(theme).getByRole("button", { name: "Claro" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(within(theme).getByRole("button", { name: "Claro" }));
    expect(localStorage.getItem("pf-theme")).toBe("light");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(within(theme).getByRole("button", { name: "Claro" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(theme).getByRole("button", { name: "Sistema" }));
    expect(localStorage.getItem("pf-theme")).toBeNull();
  });
});

describe("Próximamente card (S5)", () => {
  it("groups recruitment, notifications and security in one card with the reason visible and no switches", async () => {
    const persist = vi.spyOn(Storage.prototype, "setItem");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await renderOwner();
    const soon = group("Próximamente");
    expect(soon.querySelectorAll("[data-slot='card']")).toHaveLength(1);
    const rows = within(soon).getAllByRole("listitem");
    expect(rows.map(row => within(row).getByText(/^(Reclutamiento|Notificaciones|Seguridad)$/).textContent)).toEqual(["Reclutamiento", "Notificaciones", "Seguridad"]);
    for (const row of rows) expect(within(row).getByText("Próximamente")).toBeVisible();
    expect(within(rows[0]).getByText("Incluir preguntas de filtro al preparar una vacante.")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Nuevas postulaciones, cambios en entrevistas, actividad del equipo y resumen semanal.")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Autenticación en dos pasos y cambio de contraseña.")).toBeInTheDocument();
    // No fake controls: text only.
    expect(within(soon).queryByRole("switch")).toBeNull();
    expect(within(soon).queryByRole("button")).toBeNull();
    expect(persist).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("recruiter variant (S5)", () => {
  it.each(["recruiter", "stakeholder"] as const)("%s: no Base de talento row, no location edit, and a note says why", async role => {
    vi.mocked(loadCompanyStateAction).mockResolvedValue(exists(role));
    await renderOwner();
    expect(within(strip()).getByText(role === "recruiter" ? "Reclutador" : "Stakeholder")).toBeInTheDocument();
    expect(within(strip()).getByText("San Pedro Garza García, Nuevo León, México")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar ubicación" })).toBeNull();
    expect(screen.queryByText("Base de talento visible para")).toBeNull();
    expect(within(group("Organización")).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Solo el dueño puede editar la ubicación de la empresa y elegir quién ve la Base de talento.")).toBeInTheDocument();
    // The talent base is never read for them, and the rest of the page still works.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(loadTalentBaseVisibilityAction).not.toHaveBeenCalled();
    expect(listTeamMembersAction).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Administrar equipo" })).toBeInTheDocument();
    expect(within(group("Próximamente")).getAllByRole("listitem")).toHaveLength(3);
  });

  it("the owner sees no such note", async () => {
    await renderOwner();
    expect(screen.queryByText(/Solo el dueño puede editar la ubicación/)).toBeNull();
  });
});

describe("location dialog from the strip (owner only)", () => {
  it("opens from «Editar ubicación», saves with the loaded token and updates the strip", async () => {
    const next = { id: company.id, name: company.name, location: null, updated_at: "2026-10-20T13:00:00.987654321Z" };
    vi.mocked(updateCompanyLocationAction).mockResolvedValue({ kind: "updated", company: next });
    await renderOwner();
    await userEvent.click(within(strip()).getByRole("button", { name: "Editar ubicación" }));
    expect(screen.getByRole("dialog", { name: "Ubicación de la empresa" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Quitar ubicación" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar ubicación" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(updateCompanyLocationAction).toHaveBeenCalledWith({ location: null, updatedAt: company.updated_at });
    expect(within(strip()).getByText("Sin ubicación")).toBeInTheDocument();
    expect(sileo.success).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Ubicación actualizada." }));
  });

  it("cancels without saving and keeps the location", async () => {
    await renderOwner();
    await userEvent.click(within(strip()).getByRole("button", { name: "Editar ubicación" }));
    await userEvent.click(screen.getByRole("button", { name: "Quitar ubicación" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(updateCompanyLocationAction).not.toHaveBeenCalled();
    expect(within(strip()).getByText("San Pedro Garza García, Nuevo León, México")).toBeInTheDocument();
  });
});

describe("states", () => {
  it("shows a skeleton with the shape of the strip and the rows while the company loads", async () => {
    const pending = deferred<CompanyState>();
    vi.mocked(loadCompanyStateAction).mockReturnValue(pending.promise);
    const { container } = render(<EmployerSettingsWorkspace />);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando empresa");
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(container.querySelectorAll("[data-slot='skeleton']").length).toBeGreaterThan(6);
    expect(screen.queryByRole("region", { name: "Tu empresa" })).toBeNull();
    pending.resolve(exists("owner"));
    expect(await screen.findByRole("region", { name: "Tu empresa" })).toBeInTheDocument();
  });

  it("without a company the create form replaces the strip and the rows", async () => {
    vi.mocked(loadCompanyStateAction).mockResolvedValue(none);
    render(<EmployerSettingsWorkspace />);
    expect(await screen.findByLabelText("Nombre de la empresa")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Tu empresa" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear empresa" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Organización" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Próximamente" })).toBeNull();
    expect(screen.queryByText("Administrar equipo")).toBeNull();
    expect(loadTalentBaseVisibilityAction).not.toHaveBeenCalled();
  });

  it("creating the company swaps the form for the strip and the rows", async () => {
    vi.mocked(loadCompanyStateAction).mockResolvedValue(none);
    vi.mocked(createCompanyAction).mockResolvedValue({ kind: "created", company: { ...company, location: null } });
    const user = userEvent.setup();
    render(<EmployerSettingsWorkspace />);
    await user.type(await screen.findByLabelText("Nombre de la empresa"), "Grupo Altavista");
    await user.type(screen.getByLabelText("RFC"), "GAL140612QX4");
    await user.selectOptions(screen.getByRole("combobox", { name: "Industria" }), "i");
    await user.click(screen.getByRole("button", { name: "Crear empresa" }));
    const bar = await screen.findByRole("region", { name: "Tu empresa" });
    expect(within(bar).getByText("Dueño")).toBeInTheDocument();
    expect(screen.queryByLabelText("RFC")).toBeNull();
    expect(screen.getByRole("region", { name: "Organización" })).toBeInTheDocument();
    expect(await within(group("Organización")).findByText("Base de talento visible para")).toBeInTheDocument();
  });

  it.each(["server_error", "no_response", "unrecognized_response"] as const)("shows %s as an error StateCard with one safe retry and no rows", async kind => {
    vi.mocked(loadCompanyStateAction).mockResolvedValueOnce({ kind, reference: { status: 502, code: "internal_error" } });
    const { container } = render(<EmployerSettingsWorkspace />);
    expect(await screen.findByRole("heading", { level: 2, name: "No pudimos cargar tu empresa" })).toBeInTheDocument();
    expect(container.querySelector("[data-slot='card']")).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("No se cargó · ver aviso");
    expect(screen.queryByRole("region", { name: "Organización" })).toBeNull();
    expect(sileo.error).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("region", { name: "Tu empresa" })).toBeInTheDocument();
    expect(loadCompanyStateAction).toHaveBeenCalledTimes(2);
    expect(createCompanyAction).not.toHaveBeenCalled();
  });

  it("shows an expired session as a StateCard with a login link that opens in a new tab", async () => {
    vi.mocked(loadCompanyStateAction).mockResolvedValue({ kind: "unauthenticated", reference: {} });
    render(<EmployerSettingsWorkspace />);
    expect(await screen.findByRole("heading", { level: 2, name: "Tu sesión expiró" })).toBeInTheDocument();
    const login = screen.getByRole("link", { name: "Iniciar sesión" });
    expect(login).toHaveAttribute("href", "/empresa/login");
    expect(login).toHaveAttribute("target", "_blank");
    expect(screen.queryByRole("region", { name: "Organización" })).toBeNull();
    expect(sileo.error).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Tu sesión expiró" }));
  });

  it("does not render the talent sheet or any dialog at rest", async () => {
    await renderOwner();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
