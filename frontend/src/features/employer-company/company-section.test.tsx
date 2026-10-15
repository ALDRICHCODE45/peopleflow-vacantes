import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps, ReactNode } from "react";
// Same controlled adapter as settings-workspace.test: jsdom cannot position Base UI's portaled Select.
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
vi.mock("./actions", () => ({ loadCompanyStateAction: vi.fn(), createCompanyAction: vi.fn() }));
vi.mock("sileo", () => ({ sileo: { success: vi.fn(() => "company-success"), error: vi.fn(() => "company-error"), dismiss: vi.fn() } }));
import { sileo } from "sileo";
import { createCompanyAction, loadCompanyStateAction } from "./actions";
import type { CompanyState, CreateCompanyState } from "./actions";
import { CompanySection } from "./company-section";

// Exercise the feature boundary while keeping upstream transport mocked.
const company = { id: "c", name: "Empresa confirmada", rfc: "ABC123456789", industry_id: "i", status: "pending_verification" as const };
const none: CompanyState = { kind: "none", industries: [{ id: "i", label_es: "Tecnología", label_en: "Technology", sort_order: 2 }, { id: "j", label_es: "Agricultura", label_en: "Agriculture", sort_order: 1 }] };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => { vi.resetAllMocks(); vi.mocked(loadCompanyStateAction).mockResolvedValue(none); });
afterEach(cleanup);
async function fill() {
  const user = userEvent.setup();
  await screen.findByLabelText("Nombre de la empresa");
  await user.type(screen.getByLabelText("Nombre de la empresa"), "Empresa nueva");
  await user.type(screen.getByLabelText("RFC"), "abc123456789");
  const options = screen.getAllByRole("option"); expect(options.slice(1).map(o => o.textContent)).toEqual(["Tecnología", "Agricultura"]);
  await user.selectOptions(screen.getByRole("combobox", { name: "Industria" }), "i");
  return user;
}
it.each(["server_error", "no_response", "unrecognized_response"] as const)("shows structured %s create error and only allows reload", async kind => {
  vi.mocked(createCompanyAction).mockResolvedValue({kind, reference:{status:500,code:"internal_error"}} as CreateCompanyState);
  render(<CompanySection />); const user = await fill(); await user.click(screen.getByRole("button", {name:"Crear empresa"}));
  const status = await screen.findByRole("status");
  expect(status).toHaveTextContent("Resultado sin confirmar · ver aviso");
  expect(sileo.error).toHaveBeenLastCalledWith(expect.objectContaining({title:kind === "server_error" ? "El servidor tuvo un problema" : kind === "no_response" ? "No hubo respuesta del servidor" : "No pudimos confirmar el resultado", duration:null}));
  const {container} = render(<>{vi.mocked(sileo.error).mock.calls[0][0].description}</>);
  expect(container).toHaveTextContent("podría haberse creado");
  expect(container).toHaveTextContent("HTTP 500 · internal_error");
  expect(screen.queryByRole("button", {name:"Crear empresa"})).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", {name:"Reintentar"}));
  expect(await screen.findByRole("button", {name:"Crear empresa"})).toBeVisible();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
it("keeps context and accessible skeleton while initial load waits", async () => {
  const pending = deferred<CompanyState>(); vi.mocked(loadCompanyStateAction).mockReturnValue(pending.promise);
  const { container } = render(<CompanySection />);
  expect(screen.getByRole("heading", { level: 2, name: "Tu empresa" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Cargando empresa");
  expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(2);
  expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  await act(async () => pending.resolve(none)); expect(await screen.findByLabelText("RFC")).toBeInTheDocument(); expect(sileo.success).not.toHaveBeenCalled();
});
it("shows persistent local field validation without calling create", async () => {
  render(<CompanySection />); await screen.findByLabelText("RFC");
  fireEvent.click(screen.getByRole("button", { name: "Crear empresa" }));
  expect(await screen.findByText("Selecciona una industria.")).toBeInTheDocument();
  expect(screen.getByLabelText("RFC")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Nombre de la empresa")).toHaveAttribute("aria-invalid", "true");
  expect(createCompanyAction).not.toHaveBeenCalled();
});
it("disables pending submit, prevents duplicates, toasts only confirmation and shows summary", async () => {
  const pending = deferred<CreateCompanyState>(); vi.mocked(createCompanyAction).mockReturnValue(pending.promise);
  render(<CompanySection />); const user = await fill(); await user.click(screen.getByRole("button", { name: "Crear empresa" }));
  const button = screen.getByRole("button", { name: "Creando empresa…" }); expect(button).toBeDisabled(); expect(button).toHaveAttribute("aria-busy", "true");
  expect(button.querySelector('[data-slot="spinner"]')).toBeInTheDocument();
  fireEvent.click(button); expect(createCompanyAction).toHaveBeenCalledTimes(1); expect(sileo.success).not.toHaveBeenCalled();
  await act(async () => pending.resolve({ kind: "created", company }));
  expect(await screen.findByText("Empresa confirmada")).toBeInTheDocument(); expect(screen.getByText("En verificación")).toBeInTheDocument();
  expect(screen.getByText("Propietario")).toBeInTheDocument(); expect(screen.queryByLabelText("RFC")).not.toBeInTheDocument(); expect(sileo.success).toHaveBeenCalledTimes(1);
});
it.each([
  [{ kind: "forbidden", reference: {} }, "Necesitas una cuenta de reclutador para crear una empresa."],
  [{ kind: "already_exists", reference: {} }, "Ya tienes una empresa o el RFC ya está registrado."],
  [{ kind: "industry_unavailable", reference: {} }, "Esta industria ya no está disponible. Selecciona otra."],
  [{ kind: "invalid", message: "El RFC no es válido.", reference: {} }, "El RFC no es válido."],
] as const)("toasts %j error and retains form status", async (result, message) => {
  vi.mocked(createCompanyAction).mockResolvedValue(result); render(<CompanySection />); const user = await fill(); await user.click(screen.getByRole("button", { name: "Crear empresa" }));
  expect(await screen.findByRole("status")).toHaveTextContent("No se creó · ver aviso");
  const {container} = render(<>{vi.mocked(sileo.error).mock.calls[0][0].description}</>);
  expect(container).toHaveTextContent(message);
  if (result.kind === "invalid") expect(sileo.error).toHaveBeenLastCalledWith(expect.objectContaining({title:"Revisa los datos de la empresa"}));
  expect(screen.getByLabelText("RFC")).toHaveValue("abc123456789"); expect(sileo.success).not.toHaveBeenCalled();
});
it("renders unauthenticated login link on load", async () => {
  vi.mocked(loadCompanyStateAction).mockResolvedValue({ kind: "unauthenticated", reference: {} }); render(<CompanySection />);
  expect(await screen.findByRole("link", { name: "Iniciar sesión" })).toHaveAttribute("href", "/empresa/login");
});
it("renders unauthenticated login link after create", async () => {
  vi.mocked(createCompanyAction).mockResolvedValue({ kind: "unauthenticated", reference: {} }); render(<CompanySection />); const user = await fill(); await user.click(screen.getByRole("button", { name: "Crear empresa" }));
  expect(await screen.findByRole("link", { name: "Iniciar sesión" })).toHaveAttribute("href", "/empresa/login");
  expect(screen.getByRole("link", {name:"Iniciar sesión"})).toHaveAttribute("target", "_blank");
  expect(screen.getByLabelText("RFC")).toHaveValue("abc123456789");
  expect(screen.getByRole("status")).toHaveTextContent("No se creó · ver aviso");
  expect(sileo.error).toHaveBeenLastCalledWith(expect.objectContaining({title:"Tu sesión expiró"}));
});
it("explicit retry only reloads after uncertain create, retaining useful form input", async () => {
  vi.mocked(createCompanyAction).mockResolvedValue({ kind: "no_response", reference: {} }); render(<CompanySection />); const user = await fill(); await user.click(screen.getByRole("button", { name: "Crear empresa" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Resultado sin confirmar · ver aviso");
  expect(screen.queryByRole("button", { name: "Crear empresa" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("RFC")).toHaveValue("abc123456789");
  await user.click(screen.getByRole("button", { name: "Reintentar" })); await waitFor(() => expect(loadCompanyStateAction).toHaveBeenCalledTimes(2));
  expect(createCompanyAction).toHaveBeenCalledTimes(1); expect(sileo.success).not.toHaveBeenCalled();
});
it.each(["server_error", "no_response", "unrecognized_response"] as const)("shows %s load reference with one safe retry", async kind => {
  vi.mocked(loadCompanyStateAction).mockResolvedValueOnce({kind,reference:{status:502,code:"internal_error"}});
  render(<CompanySection />);
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No se cargó · ver aviso"));
  expect(screen.getByRole("button", {name:"Reintentar"})).toHaveAttribute("aria-describedby", "company-action-status");
  expect(sileo.error).toHaveBeenCalledTimes(1);
  const {container} = render(<>{vi.mocked(sileo.error).mock.calls[0][0].description}</>);
  expect(container).toHaveTextContent("HTTP 502 · internal_error");
  await userEvent.click(screen.getByRole("button", {name:"Reintentar"}));
  expect(await screen.findByLabelText("RFC")).toBeVisible();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(createCompanyAction).not.toHaveBeenCalled();
});
it("keeps the form and blocks a second create when reconciliation fails", async () => {
  vi.mocked(createCompanyAction).mockResolvedValue({kind:"server_error",reference:{status:500}});
  render(<CompanySection />); const user = await fill(); await user.click(screen.getByRole("button", {name:"Crear empresa"}));
  await screen.findByRole("status");
  vi.mocked(loadCompanyStateAction).mockResolvedValueOnce({kind:"no_response",reference:{}});
  await user.click(screen.getByRole("button", {name:"Reintentar"}));
  await waitFor(() => expect(sileo.error).toHaveBeenCalledTimes(2));
  expect(sileo.error).toHaveBeenLastCalledWith(expect.objectContaining({title:"No hubo respuesta del servidor"}));
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByLabelText("RFC")).toHaveValue("abc123456789");
  expect(screen.queryByRole("button", {name:"Crear empresa"})).not.toBeInTheDocument();
  expect(createCompanyAction).toHaveBeenCalledTimes(1);
});
it("retries unavailable load explicitly and handles rejected actions", async () => {
  vi.mocked(loadCompanyStateAction).mockRejectedValueOnce(new Error("secret")); render(<CompanySection />);
  await userEvent.click(await screen.findByRole("button", { name: "Reintentar" })); expect(await screen.findByLabelText("RFC")).toBeInTheDocument();
  expect(loadCompanyStateAction).toHaveBeenCalledTimes(2);
});
it.each([["active", "Activa", "success"], ["pending_verification", "En verificación", "review"], ["suspended", "Suspendida", "danger"]] as const)("uses semantic status %s", async (status, label, variant) => {
  vi.mocked(loadCompanyStateAction).mockResolvedValue({ kind: "exists", company: { ...company, status }, role: "recruiter", industryLabel: "Tecnología" });
  render(<CompanySection />); const badge = await screen.findByText(label); expect(badge).toHaveAttribute("data-variant", variant);
  expect(screen.getByText("Reclutador")).toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Crear empresa" })).not.toBeInTheDocument();
});
it("reserves the result line below the create button instead of pushing it", async () => {
  vi.mocked(createCompanyAction).mockResolvedValue({ kind: "already_exists", reference: { status: 409, code: "already_exists" } });
  render(<CompanySection />); const user = await fill();
  const button = screen.getByRole("button", { name: "Crear empresa" });
  const slot = document.querySelector("[data-pf-action-status-slot]");
  expect(slot).toBeEmptyDOMElement();
  expect(button.compareDocumentPosition(slot!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await user.click(button);
  expect(await screen.findByText("No se creó · ver aviso")).toBeInTheDocument();
  expect(screen.getByText("No se creó · ver aviso").closest("[data-pf-action-status-slot]")).toBe(slot);
});
