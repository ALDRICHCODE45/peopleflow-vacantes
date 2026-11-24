import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { notifyActionResult } from "@/components/feedback/notify";
import { StartReplacementDialog } from "./start-replacement-dialog";
import { loadStartContextAction, startReplacementAction } from "./actions";
import { context, etag, ids, lifecycleWire, sourceStages } from "./test-fixtures";

vi.mock("./actions", () => ({ loadStartContextAction: vi.fn(), startReplacementAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
// jsdom cannot model Base UI Select positioning/focus restoration (same boundary as manual-intake): keep the
// labels, the option lists and the controlled changes, and replace only the popup.
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const Context = React.createContext({ value: "", items: [] as { value: string; label: string }[], change: (value: string) => { void value; } });
  return {
    Select: ({ value, items, onValueChange, children }: { value: string | null; items: { value: string; label: string }[]; onValueChange: (value: string) => void; children: ReactNode }) =>
      <Context.Provider value={{ value: value ?? "", items, change: onValueChange }}>{children}</Context.Provider>,
    SelectTrigger: ({ children, ...props }: ComponentProps<"select">) => { void children; const state = React.useContext(Context); return <select {...props} value={state.value} onChange={event => state.change(event.target.value)}>{state.items.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>; },
    SelectValue: () => null, SelectContent: () => null, SelectGroup: () => null, SelectItem: () => null,
  };
});
// The popover calendar is covered by date-field's own tests; here only the value/error contract matters.
vi.mock("@/features/employer-vacancies/delivery-config/date-field", () => ({
  BusinessDateField: ({ id, label, description, value, errorMessage, disabled, onChange }: { id: string; label: string; description: string; value: string | null; errorMessage?: string; disabled: boolean; onChange: (value: string | null) => void }) =>
    <div><label htmlFor={id}>{label}</label><input id={id} value={value ?? ""} disabled={disabled} aria-invalid={!!errorMessage} aria-describedby={`${id}-error`} onChange={event => onChange(event.target.value || null)} /><p>{description}</p>{errorMessage && <p id={`${id}-error`}>{errorMessage}</p>}</div>,
}));

const created = { ok: true as const, data: { id: ids.newDraft, kind: "replacement" as const, lifecycle: lifecycleWire(ids.newDraft) as never }, etag: `"vl-${ids.newDraft}-v1"`, idempotencyReplayed: "false" as const };
const failure = (extra: Record<string, unknown>) => ({ ok: false as const, reason: "server_error", message: "mensaje", reference: {}, ...extra }) as never;
const unavailable = [{ id: uuidOf(99), name: "Daniela Ibarra Soto", reason: "still_placed" as const }];
function uuidOf(n: number) { return `${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`; }

function mount(props: Partial<ComponentProps<typeof StartReplacementDialog>> = {}, ctx = context()) {
  vi.mocked(loadStartContextAction).mockResolvedValue({ ok: true, data: ctx });
  const onStarted = vi.fn(); const onOpenChange = vi.fn();
  render(<StartReplacementDialog draftId={ids.draft} title="Supervisor(a) de Almacén" stages={sourceStages} unavailableHires={unavailable} open onOpenChange={onOpenChange} onStarted={onStarted} {...props} />);
  return { onStarted, onOpenChange };
}
const step1 = () => screen.findByRole("heading", { name: "¿A quién reemplaza?" });
const next = () => fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
const check = (name: string | RegExp) => fireEvent.click(screen.getByRole("checkbox", { name }));
async function toStep2(preselect: string | null = ids.creditRicardo, ctx = context()) {
  const handlers = mount(preselect ? { preselectedCreditId: preselect } : {}, ctx);
  await step1();
  return handlers;
}
async function fillStep2() {
  fireEvent.change(screen.getByLabelText("Fecha compromiso"), { target: { value: "2026-12-15" } });
  next();
  return screen.findByRole("heading", { name: "Candidatos que retomas" });
}
const options = (select: HTMLElement) => within(select).getAllByRole("option").map(option => option.textContent);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("PointerEvent", MouseEvent); // jsdom has no PointerEvent; Base UI's checkbox/switch read it on click.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.mocked(startReplacementAction).mockResolvedValue(created);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("dialog shell and accessibility", () => {
  it("is a labelled dialog that names the vacancy and announces the step", async () => {
    await toStep2();
    const dialog = screen.getByRole("dialog", { name: "Iniciar reemplazo" });
    expect(within(dialog).getByText("Supervisor(a) de Almacén")).toBeVisible();
    expect(within(dialog).getByRole("list", { name: "Paso 1 de 3" })).toBeVisible();
    expect(screen.getByText("Paso 1: Bajas").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Paso 2: Condiciones").closest("li")).not.toHaveAttribute("aria-current");
    expect(within(dialog).getByRole("status")).toHaveTextContent("Paso 1 de 3: Bajas");
  });
  it("moves focus to each step heading, announces it and keeps selections when going back", async () => {
    await toStep2();
    await waitFor(() => expect(screen.getByRole("heading", { name: "¿A quién reemplaza?" })).toHaveFocus());
    next();
    const second = await screen.findByRole("heading", { name: "Condiciones del reemplazo" });
    await waitFor(() => expect(second).toHaveFocus());
    expect(screen.getByRole("list", { name: "Paso 2 de 3" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Paso 2 de 3: Condiciones");
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }));
    expect(await step1()).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /Ricardo Morales García/ })).toBeChecked();
  });
  it("is full screen on mobile and capped on desktop", async () => {
    await toStep2();
    expect(screen.getByRole("dialog")).toHaveClass("max-sm:h-dvh", "max-sm:rounded-none", "max-sm:max-w-none");
  });
  it("shows «<vacante> · <empresa>» under the title, with a decorative icon tile before the title block", async () => {
    mount({ companyName: "Grupo Altavista" });
    await step1();
    const dialog = screen.getByRole("dialog", { name: "Iniciar reemplazo" });
    expect(within(dialog).getByText("Supervisor(a) de Almacén · Grupo Altavista")).toBeVisible();
    const tile = dialog.querySelector("svg.lucide-repeat")?.parentElement;
    expect(tile).toHaveAttribute("aria-hidden", "true");
    expect(tile).toHaveClass("size-10", "bg-primary/10", "text-primary");
    expect(within(dialog).getByRole("heading", { name: "Iniciar reemplazo" }).closest("[data-slot=dialog-header]")).toContainElement(tile as HTMLElement);
  });
  it("shows the vacancy alone when the company is unknown, and the company alone without a title", async () => {
    mount();
    await step1();
    expect(screen.getByText("Supervisor(a) de Almacén")).toBeVisible();
    expect(screen.queryByText(/·/, { selector: "[data-slot=dialog-description]" })).not.toBeInTheDocument();
    cleanup();
    mount({ title: undefined, companyName: "Grupo Altavista" });
    await step1();
    expect(screen.getByText("Grupo Altavista")).toBeVisible();
  });
  it("keeps the tile and the meta while loading and when the chain cannot be read", async () => {
    vi.mocked(loadStartContextAction).mockResolvedValueOnce({ ok: false, reason: "unavailable", message: "No pudimos cargar las bajas. Vuelve a intentarlo." });
    render(<StartReplacementDialog draftId={ids.draft} title="Supervisor(a) de Almacén" companyName="Grupo Altavista" stages={sourceStages} open onOpenChange={vi.fn()} onStarted={vi.fn()} />);
    expect(screen.getByText("Supervisor(a) de Almacén · Grupo Altavista")).toBeVisible();
    expect(screen.getByRole("dialog").querySelector("svg.lucide-repeat")?.parentElement).toHaveAttribute("aria-hidden", "true");
    expect(await screen.findByText("No pudimos cargar las bajas. Vuelve a intentarlo.")).toBeVisible();
    expect(screen.getByText("Supervisor(a) de Almacén · Grupo Altavista")).toBeVisible();
  });
  it("shows a loading state while the chain loads", async () => {
    vi.mocked(loadStartContextAction).mockReturnValue(new Promise(() => {}));
    render(<StartReplacementDialog draftId={ids.draft} title="X" stages={sourceStages} open onOpenChange={vi.fn()} onStarted={vi.fn()} />);
    expect(await screen.findByRole("status", { name: "Cargando bajas" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Siguiente" })).not.toBeInTheDocument();
  });
  it("offers a retry when the chain cannot be read", async () => {
    vi.mocked(loadStartContextAction).mockResolvedValueOnce({ ok: false, reason: "unavailable", message: "No pudimos cargar las bajas. Vuelve a intentarlo." });
    render(<StartReplacementDialog draftId={ids.draft} title="X" stages={sourceStages} open onOpenChange={vi.fn()} onStarted={vi.fn()} />);
    expect(await screen.findByText("No pudimos cargar las bajas. Vuelve a intentarlo.")).toBeVisible();
    vi.mocked(loadStartContextAction).mockResolvedValueOnce({ ok: true, data: context() });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await step1()).toBeVisible();
    expect(loadStartContextAction).toHaveBeenCalledTimes(2);
  });
  it.each([
    ["source_not_closed", "Esta vacante aún no está cerrada. Ciérrala para iniciar un reemplazo."],
    ["not_latest", "Esta vacante ya tiene un proceso más reciente. Trabaja en ese proceso."],
    ["replacement_active", "Ya hay un reemplazo activo para esta vacante."],
    ["no_startable_credits", "No hay bajas pendientes de reemplazo. Marca «No se sostuvo» a quien se fue para iniciarlo."],
  ] as const)("explains the %s blocker instead of the steps", async (blocker, copy) => {
    mount({}, context({ allowed: false, blocker, startable_credits: [], publish_ready: null, missing: [] }, { carry_candidates: [] }));
    expect(await screen.findByText(copy)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Siguiente" })).not.toBeInTheDocument();
  });
});

describe("step 1 · Bajas", () => {
  it("checks the preselected fallen hire and lists the others unchecked", async () => {
    await toStep2();
    expect(screen.getByRole("checkbox", { name: /Ricardo Morales García/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Luis Pérez/ })).not.toBeChecked();
    expect(screen.getAllByText(/Placement el 22 oct/)).toHaveLength(2);
    expect(screen.getAllByText(/se fue el 17 nov/)).toHaveLength(2);
  });
  it("disables a hire that is not startable and says why in text", async () => {
    await toStep2();
    expect(screen.getByRole("checkbox", { name: /Daniela Ibarra Soto/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Sigue en Placement. Solo se reemplaza a quien no se sostuvo.")).toBeVisible();
  });
  it("is a labelled group of rows (no bare checkbox): name, dates and badge on the row, the reason on the disabled one", async () => {
    await toStep2();
    const group = screen.getByRole("group", { name: "Bajas" });
    expect(within(group).getAllByRole("checkbox")).toHaveLength(3);
    expect(group.querySelector("input[type='checkbox']:not([aria-hidden])")).toBeNull();
    const ricardo = screen.getByRole("checkbox", { name: "Ricardo Morales García" });
    expect(ricardo).toHaveAccessibleDescription(expect.stringContaining("No se sostuvo"));
    expect(within(ricardo).getByText("No se sostuvo")).toBeVisible();
    const daniela = screen.getByRole("checkbox", { name: "Daniela Ibarra Soto" });
    expect(daniela).toHaveAccessibleDescription(expect.stringContaining("Sigue en Placement. Solo se reemplaza a quien no se sostuvo."));
    // «Sigue en Placement» is said once (the reason), not again as a badge.
    expect(within(daniela).getAllByText(/Sigue en Placement/)).toHaveLength(1);
    expect(within(daniela).getByText("Sigue en Placement. Solo se reemplaza a quien no se sostuvo.")).toBeVisible();
    fireEvent.click(daniela);
    expect(daniela).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeEnabled();
  });
  it("keeps «Siguiente» disabled with a written reason until one baja is checked", async () => {
    await toStep2(null);
    const nextButton = screen.getByRole("button", { name: "Siguiente" });
    expect(nextButton).toBeDisabled();
    const reason = screen.getByText("Elige al menos una baja para continuar.");
    expect(reason).toBeVisible();
    expect(nextButton).toHaveAccessibleDescription("Elige al menos una baja para continuar.");
    check(/Luis Pérez/);
    expect(nextButton).toBeEnabled();
    expect(screen.queryByText("Elige al menos una baja para continuar.")).not.toBeInTheDocument();
    expect(screen.getByText("1 baja elegida")).toBeVisible();
    check(/Ricardo Morales García/);
    expect(screen.getByText("2 bajas elegidas")).toBeVisible();
    check(/Ricardo Morales García/); check(/Luis Pérez/);
    expect(nextButton).toBeDisabled();
  });
  it("cancels without calling the backend", async () => {
    const { onOpenChange } = await toStep2();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(startReplacementAction).not.toHaveBeenCalled();
  });
  it("ignores a preselection that is no longer startable", async () => {
    await toStep2(uuidOf(777));
    expect(screen.getByRole("checkbox", { name: /Ricardo Morales García/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
  });
});

describe("step 2 · Condiciones", () => {
  it("defaults the objetivo to the number of bajas and follows the selection", async () => {
    await toStep2();
    next();
    expect(await screen.findByLabelText("Objetivo")).toHaveValue(1);
    fireEvent.click(screen.getByRole("button", { name: "Atrás" }));
    await step1(); check(/Luis Pérez/); next();
    expect(await screen.findByLabelText("Objetivo")).toHaveValue(2);
  });
  it("never lets the objetivo go below the bajas", async () => {
    await toStep2();
    check(/Luis Pérez/); next();
    const objective = await screen.findByLabelText("Objetivo");
    expect(screen.getByRole("button", { name: "Quitar un candidato" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Agregar un candidato" }));
    expect(objective).toHaveValue(3);
    fireEvent.click(screen.getByRole("button", { name: "Quitar un candidato" }));
    expect(objective).toHaveValue(2);
    fireEvent.change(objective, { target: { value: "1" } });
    expect(screen.getByText("El objetivo no puede ser menor que el número de bajas (2).")).toBeVisible();
    expect(objective).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(screen.getByLabelText("Fecha compromiso"), { target: { value: "2026-12-15" } });
    next();
    expect(screen.queryByRole("heading", { name: "Candidatos que retomas" })).not.toBeInTheDocument();
    await waitFor(() => expect(objective).toHaveFocus());
  });
  it("requires the fecha compromiso and focuses it", async () => {
    await toStep2(); next();
    await screen.findByLabelText("Objetivo");
    next();
    expect(screen.getByText("Elige la fecha compromiso para continuar.")).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText("Fecha compromiso")).toHaveFocus());
    expect(screen.queryByRole("heading", { name: "Candidatos que retomas" })).not.toBeInTheDocument();
  });
  it("lists the company members, with the person who starts as the default responsible", async () => {
    await toStep2(); next();
    const responsible = await screen.findByLabelText("Responsable");
    expect(options(responsible)).toEqual(["Yo, quien inicia el reemplazo", "Ana López", "Sofía Ramírez"]);
    expect(responsible).toHaveValue("me");
  });
  it("counts the business days from today to the chosen fecha compromiso", async () => {
    await toStep2(); next();
    fireEvent.change(await screen.findByLabelText("Fecha compromiso"), { target: { value: "2026-12-15" } });
    expect(screen.getByText("Plazo desde hoy: 18 días hábiles.")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Fecha compromiso"), { target: { value: "2026-11-20" } });
    expect(screen.getByText("Plazo desde hoy: 1 día hábil.")).toBeVisible();
  });
  it("is private by default, explains that publishing later does not restart the clock and allows publishing when ready", async () => {
    await toStep2(); next();
    const publish = await screen.findByRole("switch", { name: /Publicar al iniciar/ });
    expect(publish).not.toBeChecked();
    expect(publish).toBeEnabled();
    expect(screen.getByText(/nadie fuera de tu equipo lo ve/i)).toBeVisible();
    expect(screen.getByText(/publicar después no reinicia el plazo/i)).toBeVisible();
    fireEvent.click(publish);
    expect(publish).toBeChecked();
  });
  it("disables «Publicar al iniciar» and explains every missing requirement when the vacancy is not publish ready", async () => {
    await toStep2(ids.creditRicardo, context({ publish_ready: false, missing: ["title_missing", "description_missing", "work_mode_missing"] }));
    next();
    const publish = await screen.findByRole("switch", { name: /Publicar al iniciar/ });
    expect(publish).toBeDisabled();
    const reasons = screen.getByText(/Para publicar al iniciar falta/);
    expect(reasons).toHaveTextContent("Título");
    expect(reasons).toHaveTextContent("Descripción");
    expect(reasons).toHaveTextContent("Modalidad");
    expect(publish).toHaveAccessibleDescription(expect.stringContaining("Título"));
    expect(screen.getByText(/publicar después no reinicia el plazo/i)).toBeVisible();
  });
  it("folds the readiness reasons into one compact line of short field labels, not a list mixing labels and sentences", async () => {
    await toStep2(ids.creditRicardo, context({ publish_ready: false, missing: ["description_missing", "location_missing", "requester_missing"] }));
    next();
    const reasons = await screen.findByText(/Para publicar al iniciar falta/);
    expect(reasons).toHaveTextContent("Descripción, Ubicación y Solicitante");
    expect(reasons).not.toHaveTextContent(/Agrega la ubicación/);
    expect(within(reasons.parentElement!).queryByRole("list")).not.toBeInTheDocument();
  });
  it("uses the short label for every location-like requirement", async () => {
    await toStep2(ids.creditRicardo, context({ publish_ready: false, missing: ["location_incomplete", "remote_scope_missing"] }));
    next();
    const reasons = await screen.findByText(/Para publicar al iniciar falta/);
    expect(reasons).toHaveTextContent("Estado y municipio");
    expect(reasons).toHaveTextContent("Países desde donde pueden postular");
    expect(reasons).not.toHaveTextContent(/Completa estado|Indica desde dónde/);
  });
  it("keeps the privacy note short", async () => {
    await toStep2(); next();
    const note = (await screen.findByText(/nadie fuera de tu equipo lo ve/i)).textContent ?? "";
    expect(note.length).toBeLessThan(150);
    expect(note).not.toMatch(/el reloj corre desde que inicias/i);
  });
});

describe("step 3 · Candidatos", () => {
  async function toStep3(preselect: string | null = ids.creditRicardo, ctx = context()) {
    await toStep2(preselect, ctx); next(); await screen.findByLabelText("Objetivo");
    return fillStep2();
  }
  it("is optional: zero candidates can start the replacement", async () => {
    await toStep3();
    expect(screen.getByText(/Opcional/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Iniciar reemplazo" })).toBeEnabled();
    expect(screen.getByText("0 candidatos")).toBeVisible();
  });
  it("shows the previous stage as reference and offers the stage selector only once the candidate is checked", async () => {
    await toStep3();
    expect(screen.getByText("Activo · antes: Entrevista")).toBeVisible();
    expect(screen.getByText("Activo · antes: En revisión")).toBeVisible();
    expect(screen.getByText("Descartado · antes: Oferta")).toBeVisible();
    expect(screen.queryByLabelText(/Empieza en Mauricio Peña Gil/)).not.toBeInTheDocument();
    check(/Mauricio Peña Gil/);
    expect(screen.getByLabelText(/Empieza en Mauricio Peña Gil/)).toBeEnabled();
    expect(screen.getByText("1 candidato")).toBeVisible();
  });
  it("lists the candidates as a labelled group of rows, and without «Seleccionar todo» (it would skip the MAX_CARRIED cap)", async () => {
    await toStep3();
    const group = screen.getByRole("group", { name: "Candidatos del proceso original" });
    expect(within(group).getAllByRole("checkbox")).toHaveLength(3);
    expect(within(group).queryByRole("checkbox", { name: "Seleccionar todo" })).not.toBeInTheDocument();
    expect(group.querySelector("input[type='checkbox']:not([aria-hidden])")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Mauricio Peña Gil" })).toHaveAccessibleDescription("Activo · antes: Entrevista");
  });
  it("names the discard reason of a discarded row when the backend sends it, and keeps the plain row without it", async () => {
    const base = context();
    const [mauricio, alma, karen] = base.replacements.carry_candidates;
    const withReason = { ...base, replacements: { ...base.replacements, carry_candidates: [
      { ...karen, discard_reason: { group: "candidate", key: "accepted_other_offer" } },
      { ...alma, discarded: true },
      mauricio,
    ] } } as never;
    await toStep3(ids.creditRicardo, withReason);
    expect(screen.getByText("Descartado · Aceptó otra oferta · antes: Oferta")).toBeVisible();
    expect(screen.getByText("Descartado · antes: En revisión")).toBeVisible();
    expect(screen.getByText("Activo · antes: Entrevista")).toBeVisible();
  });
  it("offers the SOURCE stages and never Placement; the default is the previous stage", async () => {
    await toStep3();
    check(/Mauricio Peña Gil/); check(/Karen Ortiz Lara/);
    const mauricio = screen.getByLabelText(/Empieza en Mauricio Peña Gil/);
    expect(options(mauricio)).toEqual(["Nuevos", "En revisión", "Entrevista", "Oferta"]);
    expect(options(mauricio)).not.toContain("Contratación");
    expect(mauricio).toHaveValue(ids.stageInterview);
    expect(screen.getByLabelText(/Empieza en Karen Ortiz Lara/)).toHaveValue(ids.stageOffer);
  });
  it("starts a candidate whose previous stage was Placement in the last stage before it, never in Placement", async () => {
    const placed = { candidate: { kind: "manual", id: ids.luis, full_name: "Luis Pérez" }, process_id: ids.draft, participation_id: ids.luis, stage: { kind: "placement", name: "Contratación" }, discarded: false, eligible: true };
    await toStep3(ids.creditRicardo, context({}, { carry_candidates: [placed] }));
    check(/Luis Pérez/);
    expect(screen.getByLabelText(/Empieza en Luis Pérez/)).toHaveValue(ids.stageOffer);
  });
  it("records that the choice is audited and that Placement only comes from a later move", async () => {
    await toStep3();
    expect(screen.getByText(/queda en el historial/i)).toBeVisible();
    expect(screen.getByText(/Ninguno entra directo a Placement/)).toBeVisible();
  });
  it("filters by status", async () => {
    await toStep3();
    fireEvent.click(screen.getByRole("button", { name: "Descartados 1" }));
    expect(screen.getByRole("checkbox", { name: /Karen Ortiz Lara/ })).toBeVisible();
    expect(screen.queryByRole("checkbox", { name: /Mauricio Peña Gil/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Activos 2" }));
    expect(screen.queryByRole("checkbox", { name: /Karen Ortiz Lara/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });
  it("shows an empty state when the original has nobody to carry", async () => {
    await toStep3(ids.creditRicardo, context({}, { carry_candidates: [] }));
    expect(screen.getByText("No hay candidatos del proceso original para retomar.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Iniciar reemplazo" })).toBeEnabled();
  });
  it("tells when the list is truncated", async () => {
    await toStep3(ids.creditRicardo, context({}, { carry_candidates_truncated: true }));
    expect(screen.getByText(/Mostramos los primeros 1,?000 candidatos/)).toBeVisible();
  });
});

describe("submit", () => {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  async function fillEverything() {
    const handlers = await toStep2();
    check(/Luis Pérez/); next();
    await screen.findByLabelText("Objetivo");
    fireEvent.change(screen.getByLabelText("Responsable"), { target: { value: ids.ana } });
    fireEvent.change(screen.getByLabelText("Objetivo"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("switch", { name: /Publicar al iniciar/ }));
    await fillStep2();
    check(/Mauricio Peña Gil/); check(/Karen Ortiz Lara/);
    fireEvent.change(screen.getByLabelText(/Empieza en Karen Ortiz Lara/), { target: { value: ids.stageReview } });
    return handlers;
  }
  it("sends exactly the contract body with the source ETag and one idempotency key", async () => {
    await fillEverything();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar reemplazo" }));
    await waitFor(() => expect(startReplacementAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(startReplacementAction).mock.calls[0][0]).toEqual({
      draftId: ids.draft, ifMatch: etag, idempotencyKey: expect.stringMatching(uuidPattern),
      body: {
        placement_credit_ids: [ids.creditRicardo, ids.creditLuis], responsible: { user_id: ids.ana }, target_quantity: 3,
        commitment_date: "2026-12-15", publish: true,
        carried_candidates: [
          { candidate: { kind: "manual", id: ids.mauricio }, stage_id: ids.stageInterview },
          { candidate: { kind: "organic", id: ids.karen }, stage_id: ids.stageReview },
        ],
      },
    });
  });
  it("omits responsible when the person who starts stays responsible and sends no carried candidates when none is chosen", async () => {
    await toStep2(); next(); await screen.findByLabelText("Objetivo");
    await fillStep2();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar reemplazo" }));
    await waitFor(() => expect(startReplacementAction).toHaveBeenCalled());
    expect(vi.mocked(startReplacementAction).mock.calls[0][0].body).toEqual({
      placement_credit_ids: [ids.creditRicardo], target_quantity: 1, commitment_date: "2026-12-15", publish: false, carried_candidates: [],
    });
  });
  it("on success shows the toast and hands the new draft to the caller", async () => {
    const { onStarted, onOpenChange } = await fillEverything();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar reemplazo" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(ids.newDraft));
    expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({ type: "success", title: "Reemplazo iniciado" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it("locks the actions while the request is pending", async () => {
    vi.mocked(startReplacementAction).mockReturnValue(new Promise(() => {}));
    await fillEverything();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar reemplazo" }));
    expect(await screen.findByRole("button", { name: "Iniciando…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Atrás" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Iniciando…" }));
    expect(startReplacementAction).toHaveBeenCalledTimes(1);
  });
});

describe("failures", () => {
  async function toSubmit() {
    await toStep2(); check(/Luis Pérez/); next(); await screen.findByLabelText("Objetivo"); await fillStep2();
    check(/Mauricio Peña Gil/); check(/Karen Ortiz Lara/);
  }
  const submit = () => fireEvent.click(screen.getByRole("button", { name: "Iniciar reemplazo" }));
  it("returns to step 2 and shows the server objetivo error inline", async () => {
    vi.mocked(startReplacementAction).mockResolvedValue(failure({ reason: "validation_error", message: "revisa", fields: { target_quantity: "El objetivo no puede ser menor que el número de bajas elegidas." } }));
    await toSubmit(); submit();
    const message = await screen.findByText("El objetivo no puede ser menor que el número de bajas elegidas.");
    expect(message).toBeVisible();
    expect(screen.getByLabelText("Objetivo")).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(screen.getByLabelText("Objetivo")).toHaveFocus());
    expect(notifyActionResult).not.toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
  });
  it("shows the commitment date and responsible errors inline on step 2", async () => {
    vi.mocked(startReplacementAction).mockResolvedValue(failure({ reason: "non_business_date", fields: { commitment_date: "Ese día no es hábil. Elige otro día para la fecha compromiso.", responsible: "Esa persona ya no forma parte de tu empresa. Elige otro responsable." } }));
    await toSubmit(); submit();
    expect(await screen.findByText("Ese día no es hábil. Elige otro día para la fecha compromiso.")).toBeVisible();
    expect(screen.getByText("Esa persona ya no forma parte de tu empresa. Elige otro responsable.")).toBeVisible();
  });
  it("shows rejected bajas on step 1 and refreshes the chain", async () => {
    vi.mocked(startReplacementAction).mockResolvedValue(failure({
      reason: "replacement_credits_invalid", reload: true, message: "Alguna baja ya no se puede reemplazar. Revisa la lista.",
      credits: [{ credit_id: ids.creditLuis, message: "Esta baja ya tiene un reemplazo." }],
    }));
    await toSubmit(); submit();
    expect(await step1()).toBeVisible();
    expect(screen.getByText("Esta baja ya tiene un reemplazo.")).toBeVisible();
    expect(screen.getByText("Alguna baja ya no se puede reemplazar. Revisa la lista.")).toBeVisible();
    await waitFor(() => expect(loadStartContextAction).toHaveBeenCalledTimes(2));
  });
  it("maps rejected carried candidates back to their rows by request index", async () => {
    vi.mocked(startReplacementAction).mockResolvedValue(failure({
      reason: "carried_candidate_invalid", message: "Algún candidato ya no se puede retomar. Revisa la lista.",
      candidates: [{ index: 1, message: "Esta persona sigue en Placement; no se puede retomar." }],
    }));
    await toSubmit(); submit();
    const karen = await screen.findByRole("checkbox", { name: /Karen Ortiz Lara/ });
    expect(within(karen).getByText("Esta persona sigue en Placement; no se puede retomar.")).toBeVisible();
    const mauricio = screen.getByRole("checkbox", { name: /Mauricio Peña Gil/ });
    expect(within(mauricio).queryByText(/Placement; no se puede/)).not.toBeInTheDocument();
  });
  it("shows a rejected stage next to its candidate", async () => {
    vi.mocked(startReplacementAction).mockResolvedValue(failure({
      reason: "carried_stage_invalid", message: "Alguna etapa inicial ya no es válida. Elige otra.",
      candidates: [{ index: 0, message: "Esa etapa ya no existe en la vacante original. Elige otra." }],
    }));
    await toSubmit(); submit();
    const row = await screen.findByRole("checkbox", { name: /Mauricio Peña Gil/ });
    expect(within(row).getByText("Esa etapa ya no existe en la vacante original. Elige otra.")).toBeVisible();
  });
  it("explains a publication that is not ready, turns the switch off and keeps the form", async () => {
    vi.mocked(startReplacementAction).mockResolvedValue(failure({ reason: "publication_incomplete", message: "No se puede publicar al iniciar: falta completar la vacante original.", missing: ["title_missing"] }));
    await toStep2(); next(); await screen.findByLabelText("Objetivo");
    fireEvent.click(screen.getByRole("switch", { name: /Publicar al iniciar/ }));
    await fillStep2(); submit();
    expect(await screen.findByText(/Para publicar al iniciar falta/)).toHaveTextContent("Título");
    expect(screen.getByRole("switch", { name: /Publicar al iniciar/ })).toBeDisabled();
    expect(screen.getByRole("switch", { name: /Publicar al iniciar/ })).not.toBeChecked();
    expect(screen.getByLabelText("Fecha compromiso")).toHaveValue("2026-12-15");
  });
  it("reloads the chain and the ETag after a stale precondition and asks to confirm again", async () => {
    vi.mocked(startReplacementAction).mockResolvedValueOnce(failure({ reason: "version_conflict", reload: true, message: "La vacante cambió. Actualizamos su estado; revisa los datos y vuelve a confirmar." }));
    await toSubmit();
    vi.mocked(loadStartContextAction).mockResolvedValue({ ok: true, data: { ...context(), etag: `"vl-${ids.draft}-v8"` } });
    submit();
    expect(await screen.findByText("La vacante cambió. Actualizamos su estado; revisa los datos y vuelve a confirmar.")).toBeVisible();
    await waitFor(() => expect(loadStartContextAction).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Iniciar reemplazo" })).toBeEnabled());
    submit();
    await waitFor(() => expect(startReplacementAction).toHaveBeenCalledTimes(2));
    expect(vi.mocked(startReplacementAction).mock.calls[1][0].ifMatch).toBe(`"vl-${ids.draft}-v8"`);
  });
  it("shows an unconfirmed result without success and retries with the SAME idempotency key", async () => {
    vi.mocked(startReplacementAction).mockResolvedValueOnce(failure({ reason: "no_response", uncertain: true, message: "No pudimos confirmar si se inició el reemplazo. Vuelve a intentarlo: si ya se creó, no se duplicará." }));
    await toSubmit(); submit();
    expect(await screen.findByText("No pudimos confirmar si se inició el reemplazo. Vuelve a intentarlo: si ya se creó, no se duplicará.")).toBeVisible();
    expect(notifyActionResult).not.toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
    submit();
    await waitFor(() => expect(startReplacementAction).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(startReplacementAction).mock.calls.map(call => call[0]);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.body).toEqual(first.body);
  });
  it("uses a new idempotency key when the body changed after a failure", async () => {
    vi.mocked(startReplacementAction).mockResolvedValueOnce(failure({ reason: "carried_stage_invalid", message: "x", candidates: [{ index: 0, message: "Esa etapa ya no existe en la vacante original. Elige otra." }] }));
    await toSubmit(); submit();
    const select = await screen.findByLabelText(/Empieza en Mauricio Peña Gil/);
    fireEvent.change(select, { target: { value: ids.stageReview } });
    submit();
    await waitFor(() => expect(startReplacementAction).toHaveBeenCalledTimes(2));
    const [first, second] = vi.mocked(startReplacementAction).mock.calls.map(call => call[0]);
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  });
});
