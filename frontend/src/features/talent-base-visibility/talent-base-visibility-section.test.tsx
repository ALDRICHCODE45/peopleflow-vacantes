import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./actions", () => ({ loadTalentBaseVisibilityAction: vi.fn(), saveTalentBaseVisibilityAction: vi.fn() }));
vi.mock("@/features/employer-company/actions", () => ({ loadCompanyStateAction: vi.fn() }));
vi.mock("@/features/employer-team/actions", () => ({ listTeamMembersAction: vi.fn() }));
import { loadCompanyStateAction } from "@/features/employer-company/actions";
import type { CompanyState } from "@/features/employer-company/actions";
import { listTeamMembersAction } from "@/features/employer-team/actions";
import { loadTalentBaseVisibilityAction, saveTalentBaseVisibilityAction } from "./actions";
import { TalentBaseVisibilitySection } from "./talent-base-visibility-section";
import type { TalentBaseFailure } from "./model";
import { anaId, companyMembers, luisId, martaId, ownerId, selectedByAna, visibility } from "./test-fixtures";

const company = { id: "c", name: "Empresa", rfc: "ABC123456789", industry_id: "i", status: "active" as const, location: null, updated_at: "2026-10-20T12:00:00Z" };
const asRole = (role: "owner" | "recruiter"): CompanyState => ({ kind: "exists", company, role, industryLabel: "Tecnología", canViewTalentBase: true });
const failure = (reason: TalentBaseFailure["reason"], extra: Partial<TalentBaseFailure> = {}): TalentBaseFailure => ({ ok: false, reason, reference: {}, ...extra });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

beforeEach(() => {
  vi.resetAllMocks();
  // Base UI forwards clicks to its native inputs using PointerEvent (absent in jsdom).
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.mocked(loadCompanyStateAction).mockResolvedValue(asRole("owner"));
  vi.mocked(loadTalentBaseVisibilityAction).mockResolvedValue({ ok: true, document: visibility() });
  vi.mocked(listTeamMembersAction).mockResolvedValue({ ok: true, members: companyMembers });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const radio = (name: string) => screen.getByRole("radio", { name: new RegExp(`^${name}`) });
const box = (name: string) => screen.getByRole("checkbox", { name: new RegExp(name) });
const save = () => screen.getByRole("button", { name: /Guardar/ });
async function renderOwner() {
  const user = userEvent.setup();
  render(<TalentBaseVisibilitySection />);
  await screen.findByRole("heading", { name: "Base de talento visible para" });
  return user;
}
async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(radio("Usuarios seleccionados"));
  await screen.findByRole("group", { name: "Reclutadores con acceso" });
}

// S1: the owner configures the setting.
it("shows the owner the default «Todos los reclutadores» with no picker, nothing to save and the audit note", async () => {
  await renderOwner();
  expect(radio("Todos los reclutadores")).toBeChecked();
  expect(radio("Usuarios seleccionados")).not.toBeChecked();
  expect(screen.queryByRole("group", { name: "Reclutadores con acceso" })).not.toBeInTheDocument();
  expect(save()).toBeDisabled();
  expect(screen.getByText("Cada cambio queda registrado en la auditoría de la empresa.")).toBeInTheDocument();
  expect(screen.getByText("El owner siempre tiene acceso a la Base de talento.")).toBeInTheDocument();
  expect(saveTalentBaseVisibilityAction).not.toHaveBeenCalled();
});

it("lists only current recruiters in the picker: the owner and offboarded memberships are not selectable", async () => {
  const user = await renderOwner();
  await openPicker(user);
  const group = screen.getByRole("group", { name: "Reclutadores con acceso" });
  expect(within(group).getAllByRole("checkbox").map(item => item.getAttribute("aria-label") ?? item.id)).toHaveLength(3);
  for (const name of ["Ana Pérez", "Luis Soto", "Marta Ruiz"]) expect(box(name)).not.toBeChecked();
  expect(screen.queryByText(/Olga Dueña/)).not.toBeInTheDocument();
  expect(screen.getByText("ana@empresa.mx")).toBeInTheDocument();
});

it("starts from the saved setting: selected_users with its viewers checked", async () => {
  vi.mocked(loadTalentBaseVisibilityAction).mockResolvedValue({ ok: true, document: selectedByAna });
  await renderOwner();
  expect(radio("Usuarios seleccionados")).toBeChecked();
  expect(box("Ana Pérez")).toBeChecked();
  expect(box("Luis Soto")).not.toBeChecked();
  expect(save()).toBeDisabled();
});

it("saves the chosen users with the loaded version, then adopts the returned document", async () => {
  const user = await renderOwner();
  const next = visibility({ mode: "selected_users", version: 2, viewers: selectedByAna.viewers, updated_by: { user_id: ownerId, full_name: "Olga Dueña" } });
  vi.mocked(saveTalentBaseVisibilityAction).mockResolvedValue({ ok: true, document: next });
  await openPicker(user);
  await user.click(box("Ana Pérez"));
  await user.click(save());
  expect(saveTalentBaseVisibilityAction).toHaveBeenCalledTimes(1);
  expect(saveTalentBaseVisibilityAction).toHaveBeenCalledWith({ mode: "selected_users", userIds: [anaId], version: 1 });
  expect(await screen.findByText("Cambio guardado · queda registrado en la auditoría")).toBeInTheDocument();
  expect(save()).toBeDisabled();
  // The next change is made against the version the backend just returned.
  vi.mocked(saveTalentBaseVisibilityAction).mockResolvedValue({ ok: true, document: { ...next, version: 3 } });
  await user.click(box("Luis Soto"));
  await user.click(save());
  expect(saveTalentBaseVisibilityAction).toHaveBeenLastCalledWith({ mode: "selected_users", userIds: [anaId, luisId], version: 2 });
});

it("warns before saving that only the owner will see the base when no user is selected, and still allows saving (D1)", async () => {
  const user = await renderOwner();
  vi.mocked(saveTalentBaseVisibilityAction).mockResolvedValue({ ok: true, document: visibility({ mode: "selected_users", version: 2 }) });
  await openPicker(user);
  expect(screen.getByText("Solo el owner verá la Base de talento. Ningún reclutador tendrá acceso hasta que elijas a alguien.")).toBeInTheDocument();
  await user.click(box("Ana Pérez"));
  expect(screen.queryByText(/Solo el owner verá la Base de talento/)).not.toBeInTheDocument();
  await user.click(box("Ana Pérez"));
  expect(screen.getByText(/Solo el owner verá la Base de talento/)).toBeInTheDocument();
  expect(save()).toBeEnabled();
  expect(saveTalentBaseVisibilityAction).not.toHaveBeenCalled();
  await user.click(save());
  expect(saveTalentBaseVisibilityAction).toHaveBeenCalledWith({ mode: "selected_users", userIds: [], version: 1 });
  expect(await screen.findByText("Cambio guardado · queda registrado en la auditoría")).toBeInTheDocument();
});

it("returns to «Todos los reclutadores» without carrying the selection, and the warning disappears", async () => {
  vi.mocked(loadTalentBaseVisibilityAction).mockResolvedValue({ ok: true, document: selectedByAna });
  const user = await renderOwner();
  vi.mocked(saveTalentBaseVisibilityAction).mockResolvedValue({ ok: true, document: visibility({ version: 4 }) });
  await user.click(radio("Todos los reclutadores"));
  expect(screen.queryByRole("group", { name: "Reclutadores con acceso" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Solo el owner verá la Base de talento/)).not.toBeInTheDocument();
  await user.click(save());
  expect(saveTalentBaseVisibilityAction).toHaveBeenCalledWith({ mode: "all_recruiters", userIds: [], version: 3 });
});

it("treats reverting a change as no change and keeps a single submit in flight", async () => {
  const user = await renderOwner();
  await user.click(radio("Usuarios seleccionados"));
  expect(save()).toBeEnabled();
  await user.click(radio("Todos los reclutadores"));
  expect(save()).toBeDisabled();
  const pending = deferred<Awaited<ReturnType<typeof saveTalentBaseVisibilityAction>>>();
  vi.mocked(saveTalentBaseVisibilityAction).mockReturnValue(pending.promise);
  await user.click(radio("Usuarios seleccionados"));
  await user.click(save());
  expect(screen.getByRole("button", { name: /Guardando/ })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: /Guardando/ }));
  pending.resolve({ ok: true, document: visibility({ mode: "selected_users", version: 2 }) });
  await screen.findByText("Cambio guardado · queda registrado en la auditoría");
  expect(saveTalentBaseVisibilityAction).toHaveBeenCalledTimes(1);
});

// Error codes of the contract: each shows clear copy and changes nothing the owner chose or the saved state.
async function failingSave(result: TalentBaseFailure) {
  const user = await renderOwner();
  vi.mocked(saveTalentBaseVisibilityAction).mockResolvedValue(result);
  await openPicker(user);
  await user.click(box("Ana Pérez"));
  await user.click(box("Luis Soto"));
  await user.click(save());
  await waitFor(() => expect(saveTalentBaseVisibilityAction).toHaveBeenCalled());
  return user;
}
function expectDraftKept() {
  expect(radio("Usuarios seleccionados")).toBeChecked();
  expect(box("Ana Pérez")).toBeChecked();
  expect(box("Luis Soto")).toBeChecked();
  expect(box("Marta Ruiz")).not.toBeChecked();
  expect(screen.queryByText("Cambio guardado · queda registrado en la auditoría")).not.toBeInTheDocument();
}

it("on a version conflict keeps the owner's choice, shows the current setting and retries against the current version", async () => {
  const user = await failingSave(failure("version_conflict", { reference: { status: 412 }, document: { ...selectedByAna, version: 7, viewers: [{ ...selectedByAna.viewers[0], user_id: martaId, full_name: "Marta Ruiz", email: "marta@empresa.mx" }] } }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Alguien más cambió esta configuración mientras la editabas.");
  expect(alert).toHaveTextContent("Ahora mismo: Usuarios seleccionados (Marta Ruiz).");
  expect(alert).toHaveTextContent("Conservamos tu selección; revísala y vuelve a guardar.");
  expectDraftKept();
  expect(save()).toBeEnabled();
  vi.mocked(saveTalentBaseVisibilityAction).mockResolvedValue({ ok: true, document: visibility({ mode: "selected_users", version: 8 }) });
  await user.click(save());
  expect(saveTalentBaseVisibilityAction).toHaveBeenLastCalledWith({ mode: "selected_users", userIds: [anaId, luisId], version: 7 });
  expect(await screen.findByText("Cambio guardado · queda registrado en la auditoría")).toBeInTheDocument();
});

it("on a version conflict without a document asks to reload and does not guess a version", async () => {
  const user = await failingSave(failure("version_conflict", { reference: { status: 412, code: "talent_base_visibility_version_conflict" } }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Alguien más cambió esta configuración");
  expectDraftKept();
  vi.mocked(loadTalentBaseVisibilityAction).mockResolvedValue({ ok: true, document: { ...selectedByAna, version: 9 } });
  await user.click(screen.getByRole("button", { name: "Volver a cargar" }));
  await waitFor(() => expect(box("Ana Pérez")).toBeChecked());
  expect(box("Luis Soto")).not.toBeChecked();
  expect(save()).toBeDisabled();
});

it("flags selected users the backend says are not members, keeps the rest and lets the owner fix it", async () => {
  const user = await failingSave(failure("viewer_not_member", { reference: { status: 422, code: "talent_base_viewer_not_member" }, userIds: [luisId] }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Alguien de tu selección ya no pertenece a la empresa. Quítalo para guardar.");
  expect(within(box("Luis Soto").closest("[data-slot='field']") as HTMLElement).getByText("Ya no es parte de la empresa")).toBeInTheDocument();
  expectDraftKept();
  await user.click(box("Luis Soto"));
  expect(screen.queryByText("Ya no es parte de la empresa")).not.toBeInTheDocument();
  vi.mocked(saveTalentBaseVisibilityAction).mockResolvedValue({ ok: true, document: selectedByAna });
  await user.click(save());
  expect(saveTalentBaseVisibilityAction).toHaveBeenLastCalledWith({ mode: "selected_users", userIds: [anaId], version: 1 });
});

it("flags a user who became owner and explains the owner always sees the base", async () => {
  await failingSave(failure("viewer_is_owner", { reference: { status: 422, code: "talent_base_viewer_is_owner" }, userIds: [anaId] }));
  expect(await screen.findByRole("alert")).toHaveTextContent("El owner siempre ve la Base de talento y no se puede seleccionar. Quita a esa persona para guardar.");
  expect(within(box("Ana Pérez").closest("[data-slot='field']") as HTMLElement).getByText("Ahora es owner: ya tiene acceso")).toBeInTheDocument();
  expectDraftKept();
});

it("explains a validation_error per field and marks a repeated user", async () => {
  await failingSave(failure("validation_error", { reference: { status: 400, code: "validation_error" }, fields: ["mode", "user_ids"], userIds: [luisId] }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Elige quién puede ver la Base de talento.");
  expect(alert).toHaveTextContent("La selección de usuarios no es válida.");
  expect(within(box("Luis Soto").closest("[data-slot='field']") as HTMLElement).getByText("Aparece repetido en la selección")).toBeInTheDocument();
  expectDraftKept();
});

it("explains users_not_applicable without clearing what was chosen", async () => {
  await failingSave(failure("users_not_applicable", { reference: { status: 422, code: "talent_base_users_not_applicable" } }));
  expect(await screen.findByRole("alert")).toHaveTextContent("«Todos los reclutadores» no lleva usuarios elegidos. Recarga la configuración e inténtalo de nuevo.");
  expectDraftKept();
});

it("on 403 forbidden says only the owner can change it and locks the form", async () => {
  await failingSave(failure("forbidden", { reference: { status: 403, code: "forbidden" } }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Solo el owner puede cambiar quién ve la Base de talento. Tu rol pudo haber cambiado; recarga la página.");
  expect(save()).toBeDisabled();
  expect(radio("Todos los reclutadores")).toHaveAttribute("aria-disabled", "true");
  expect(box("Ana Pérez")).toHaveAttribute("aria-disabled", "true");
  expectDraftKept();
});

it.each([
  ["unauthenticated", "Tu sesión expiró. Inicia sesión en otra pestaña; tu selección sigue aquí."],
  ["invalid_request", "No pudimos enviar el cambio. Recarga la página e inténtalo de nuevo."],
  ["server_error", "No pudimos confirmar si el cambio se guardó. Inténtalo de nuevo; si ya estaba guardado te avisaremos."],
  ["no_response", "No pudimos confirmar si el cambio se guardó. Inténtalo de nuevo; si ya estaba guardado te avisaremos."],
  ["unrecognized_response", "No pudimos confirmar si el cambio se guardó. Inténtalo de nuevo; si ya estaba guardado te avisaremos."],
] as const)("shows clear copy for %s, keeps the choice and allows retrying against the same version", async (reason, copy) => {
  const user = await failingSave(failure(reason));
  expect(await screen.findByRole("alert")).toHaveTextContent(copy);
  expectDraftKept();
  expect(save()).toBeEnabled();
  vi.mocked(saveTalentBaseVisibilityAction).mockResolvedValue({ ok: true, document: visibility({ mode: "selected_users", version: 2 }) });
  await user.click(save());
  expect(saveTalentBaseVisibilityAction).toHaveBeenLastCalledWith({ mode: "selected_users", userIds: [anaId, luisId], version: 1 });
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});

it("offers a retry when the setting or the members cannot be loaded, and never shows the editor", async () => {
  vi.mocked(loadTalentBaseVisibilityAction).mockResolvedValueOnce(failure("server_error"));
  const user = userEvent.setup();
  render(<TalentBaseVisibilitySection />);
  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar quién ve la Base de talento.");
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Reintentar" }));
  expect(await screen.findByRole("radio", { name: /^Todos los reclutadores/ })).toBeChecked();
  cleanup();
  vi.mocked(listTeamMembersAction).mockResolvedValueOnce({ ok: false, reason: "server_error", reference: { status: 500 } });
  render(<TalentBaseVisibilitySection />);
  expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar quién ve la Base de talento.");
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
});

// S2: owner only. A recruiter sees nothing: the entry gating and the restricted message already tell them,
// and a settings card they cannot use would only be noise.
it.each(["recruiter"] as const)("renders nothing for a %s and never reads the setting or the members", async role => {
  vi.mocked(loadCompanyStateAction).mockResolvedValue(asRole(role));
  const { container } = render(<TalentBaseVisibilitySection />);
  await waitFor(() => expect(loadCompanyStateAction).toHaveBeenCalled());
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(container).toBeEmptyDOMElement();
  expect(loadTalentBaseVisibilityAction).not.toHaveBeenCalled();
  expect(listTeamMembersAction).not.toHaveBeenCalled();
});

it.each([
  [{ kind: "none", industries: [] }], [{ kind: "unauthenticated", reference: {} }], [{ kind: "server_error", reference: {} }],
] as const)("renders nothing while the company membership is unknown (%j)", async state => {
  vi.mocked(loadCompanyStateAction).mockResolvedValue(state as CompanyState);
  const { container } = render(<TalentBaseVisibilitySection />);
  await waitFor(() => expect(loadCompanyStateAction).toHaveBeenCalled());
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(container).toBeEmptyDOMElement();
  expect(loadTalentBaseVisibilityAction).not.toHaveBeenCalled();
});

it("shows a loading state for the owner without showing the form first", async () => {
  const pending = deferred<Awaited<ReturnType<typeof loadTalentBaseVisibilityAction>>>();
  vi.mocked(loadTalentBaseVisibilityAction).mockReturnValue(pending.promise);
  render(<TalentBaseVisibilitySection />);
  expect(await screen.findByRole("status")).toHaveTextContent("Cargando visibilidad de la Base de talento");
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  pending.resolve({ ok: true, document: visibility() });
  expect(await screen.findByRole("radio", { name: /^Todos los reclutadores/ })).toBeChecked();
});
