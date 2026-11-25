import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", async () => {
  const { forwardRef, createElement } = await import("react");
  return { default: forwardRef<HTMLAnchorElement, { href: string; replace?: boolean }>(({ href, replace, ...props }, ref) =>
    createElement("a", { ...props, ref, href, "data-replace": replace ? "true" : undefined })) };
});
vi.mock("./actions", () => ({ loadMetricsAccessAction: vi.fn(), loadRecruiterListAction: vi.fn() }));
// Same boundaries as the other metrics tests: the real Base UI popover and sheet cannot run under jsdom.
vi.mock("@/components/ui/popover", async () => {
  const Context = React.createContext<{ open: boolean; setOpen: (next: boolean) => void }>({ open: false, setOpen: () => {} });
  return {
    Popover: ({ open, onOpenChange, children }: { open?: boolean; onOpenChange?: (next: boolean) => void; children?: React.ReactNode }) => {
      const [inner, setInner] = React.useState(false);
      const state = open ?? inner;
      return <Context.Provider value={{ open: state, setOpen: next => { setInner(next); onOpenChange?.(next); } }}>{children}</Context.Provider>;
    },
    PopoverTrigger: ({ render, children }: { render: React.ReactElement<{ onClick?: () => void; children?: React.ReactNode }>; children?: React.ReactNode }) => {
      const { open, setOpen } = React.useContext(Context);
      return React.cloneElement(render, { onClick: () => setOpen(!open), ...(children ? { children } : {}) });
    },
    PopoverContent: ({ children }: { children?: React.ReactNode }) => React.useContext(Context).open ? <div role="dialog">{children}</div> : null,
    PopoverTitle: ({ children }: { children?: React.ReactNode }) => <h4>{children}</h4>,
    PopoverDescription: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  };
});
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, modal, onOpenChange, children }: { open?: boolean; modal?: boolean | "trap-focus"; onOpenChange?: (next: boolean) => void; children?: React.ReactNode }) =>
    open ? <div role="dialog" aria-label="Qué mide cada columna" data-modal={String(modal ?? true)} onKeyDown={event => { if (event.key === "Escape") onOpenChange?.(false); }}>{children}</div> : null,
  SheetContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
}));
import { loadMetricsAccessAction, loadRecruiterListAction } from "./actions";
import type { MetricsFailure, MetricsResult, RecruiterCard, RecruiterList } from "./model";
import { RecruitersPage } from "./recruiters-page";
import { andrea, andreaId, card, carlos, fernanda, marianaId } from "./test-fixtures";

const recruiters = vi.mocked(loadRecruiterListAction);
const access = vi.mocked(loadMetricsAccessAction);
const WINDOW = "from=2026-08-01&to=2026-10-31";
const at = (search = "") => window.history.replaceState(null, "", `/empresa/metricas/reclutadores${search}`);
const search = () => new URLSearchParams(window.location.search);
const people = () => [andrea(), carlos(), fernanda(), card()];
const AS_OF = "2026-11-07T17:42:00Z";
const answer = (items: RecruiterCard[], asOf: string | null = AS_OF, version = "v1"): MetricsResult<RecruiterList> => ({ ok: true, data: { items, definitions_version: version, ...(asOf && { as_of: asOf }) } });
const show = async (items: RecruiterCard[] = people(), asOf: string | null = AS_OF, version = "v1") => {
  recruiters.mockResolvedValue(answer(items, asOf, version));
  render(<RecruitersPage />);
  await screen.findByRole("table");
};
const table = () => screen.getByRole("table");
const order = () => within(table()).getAllByRole("rowheader").map(header => within(header).getAllByRole("link")[0].textContent);
const headers = () => within(table()).getAllByRole("columnheader").filter(header => header.getAttribute("scope") === "col").map(header => header.textContent);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("PointerEvent", MouseEvent); // Base UI choice rows read it; jsdom has none
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T18:00:00Z"));
  at(`?${WINDOW}`);
  access.mockResolvedValue({ kind: "allowed", role: "owner" });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("/empresa/metricas/reclutadores: the access gate (same as Métricas)", () => {
  it("shows the table to the owner and to a stakeholder, read-only data in both", async () => {
    await show();
    expect(screen.getByRole("heading", { name: "Desempeño por reclutador" })).toBeInTheDocument();
    expect(recruiters).toHaveBeenCalledTimes(1);
    cleanup();
    access.mockResolvedValue({ kind: "allowed", role: "stakeholder" });
    await show();
    expect(within(table()).getAllByRole("row").length).toBeGreaterThan(4);
  });

  it("sends a recruiter to «Métricas restringidas» and reads no recruiter data", async () => {
    access.mockResolvedValue({ kind: "restricted" });
    render(<RecruitersPage />);
    expect(await screen.findByText("Métricas restringidas")).toBeInTheDocument();
    expect(recruiters).not.toHaveBeenCalled();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("the page and its URL state (S2, S4)", () => {
  it("reads period, filters, order and columns from the URL and shows them", async () => {
    at(`?${WINDOW}&process_kind=replacement&recruiter_id=${andreaId}&sort=on_time%3Adescending&hide=median,delivered`);
    await show([andrea(), carlos(), fernanda()]);
    expect(recruiters).toHaveBeenCalledWith({ from: "2026-08-01", to: "2026-10-31", recruiter_id: andreaId, process_kind: "replacement" });
    expect(order()).toEqual(["Andrea Villalobos", "Carlos Mendoza Ruiz", "Fernanda Ortiz"]);
    expect(headers()).not.toContain("Mediana a la meta");
    expect(headers()).not.toContain("Entregados");
    expect(screen.getByText("Orden: entregas a tiempo (mayor a menor)")).toBeInTheDocument();
  });

  it("introduces the page with the period, a way back to Métricas that keeps the period and filters, and who it covers", async () => {
    at(`?${WINDOW}&process_kind=original&hide=median`);
    await show();
    expect(screen.getByText(/1 ago 2026 – 31 oct 2026/)).toBeInTheDocument();
    const crumb = screen.getByRole("navigation", { name: "Ruta" });
    expect(within(crumb).getByRole("link", { name: "Métricas" })).toHaveAttribute("href", `/empresa/metricas?${WINDOW}&process_kind=original`);
    expect(within(crumb).getByText("Desempeño por reclutador")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText(/personas con tramos en el periodo/).closest("[role=status]")).toHaveTextContent("Orden: nombre (A–Z)");
  });

  it("says when the numbers were computed, the period and the definitions version, as the Métricas header does (artboard)", async () => {
    at(`?${WINDOW}&process_kind=original`);
    await show();
    const line = screen.getByText(/^Actualizado /);
    expect(line).toHaveTextContent(/^Actualizado .+ · 1 ago 2026 – 31 oct 2026 · Definiciones v1 · Solo originales$/);
    cleanup();
    at(`?${WINDOW}`);
    await show(people(), null);
    expect(screen.queryByText(/^Actualizado /)).toBeNull();
    expect(screen.getByText(/1 ago 2026 – 31 oct 2026 · Definiciones v1$/)).toBeInTheDocument();
  });

  it("marks the stakeholder's view «Solo lectura» next to the title and gives the owner no badge", async () => {
    await show();
    expect(screen.queryByText("Solo lectura")).toBeNull();
    cleanup();
    access.mockResolvedValue({ kind: "allowed", role: "stakeholder" });
    await show();
    expect(screen.getByText("Solo lectura").closest("header")).toContainElement(screen.getByRole("heading", { name: "Desempeño por reclutador" }));
  });

  it("shows the inherited filters as removable chips, with «Limpiar filtros»", async () => {
    at(`?${WINDOW}&process_kind=replacement&recruiter_id=${andreaId}&requester_kind=client`);
    await show([andrea()]);
    const chips = screen.getByRole("group", { name: "Filtros activos" });
    expect(within(chips).getByText("Reclutador:")).toBeInTheDocument();
    expect(within(chips).getByText("Andrea Villalobos")).toBeInTheDocument();
    expect(within(chips).getByText("Reemplazos")).toBeInTheDocument();
    expect(screen.getByText("«Asignadas» y «Conversión» no cambian con el filtro de proceso.")).toBeInTheDocument();
    await userEvent.click(within(chips).getByRole("button", { name: "Quitar filtro Proceso: Reemplazos" }));
    expect(search().get("process_kind")).toBeNull();
    expect(search().get("recruiter_id")).toBe(andreaId);
    await userEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(Object.fromEntries(search())).toEqual({ from: "2026-08-01", to: "2026-10-31" });
    expect(screen.queryByRole("group", { name: "Filtros activos" })).toBeNull();
  });

  it("sorts by a header click, writes the order to the URL and labels it «Orden: …»", async () => {
    await show();
    expect(screen.getByText("Orden: nombre (A–Z)")).toBeInTheDocument();
    expect(search().get("sort")).toBeNull();
    await userEvent.click(within(table()).getByRole("button", { name: /Entregas a tiempo/ }));
    expect(search().get("sort")).toBe("on_time:ascending");
    expect(screen.getByText("Orden: entregas a tiempo (menor a mayor)")).toBeInTheDocument();
    await userEvent.click(within(table()).getByRole("button", { name: /Entregas a tiempo/ }));
    expect(search().get("sort")).toBe("on_time:descending");
    // 86 % Andrea, 75 % Mariana, 40 % Carlos, no sample last (S3: the percentage, not the count).
    expect(order()).toEqual(["Andrea Villalobos", "Mariana Torres", "Carlos Mendoza Ruiz", "Fernanda Ortiz"]);
    expect(search().get("from")).toBe("2026-08-01");
  });

  it("also orders from a labelled «Orden» selector, which is the phone's way to sort", async () => {
    await show();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Orden" }), "conversion:descending");
    expect(search().get("sort")).toBe("conversion:descending");
    expect(order()[0]).toBe("Andrea Villalobos");
  });

  it("chooses columns in a picker grouped like the table, keeps «Reclutador» fixed, and resets the view", async () => {
    await show();
    const reset = screen.getByRole("button", { name: "Restablecer vista" });
    expect(reset).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Columnas" }));
    const picker = screen.getByRole("dialog");
    for (const group of ["Carga de trabajo", "Entrega de candidatos", "Contratación"]) expect(within(picker).getByRole("group", { name: new RegExp(group) })).toBeInTheDocument();
    expect(within(picker).getByRole("checkbox", { name: /Reclutador/ })).toHaveAttribute("aria-disabled", "true");
    expect(within(picker).getByText("8 de 8 columnas visibles")).toBeInTheDocument();
    await userEvent.click(within(picker).getByRole("checkbox", { name: /Mediana a la meta/ }));
    expect(search().get("hide")).toBe("median");
    expect(headers()).not.toContain("Mediana a la meta");
    expect(within(picker).getByText("7 de 8 columnas visibles")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Columnas · 1 oculta" })).toBeInTheDocument();
    await userEvent.click(within(table()).getByRole("button", { name: /Conversión/ }));
    expect(search().get("sort")).toBe("conversion:ascending");
    await userEvent.click(screen.getByRole("button", { name: "Restablecer vista" }));
    expect(search().get("hide")).toBeNull();
    expect(search().get("sort")).toBeNull();
    expect(headers()).toContain("Mediana a la meta");
    expect(screen.getByText("Orden: nombre (A–Z)")).toBeInTheDocument();
  });

  it("changes the period from the segmented control and keeps order, columns and filters", async () => {
    at(`?${WINDOW}&process_kind=original&sort=placements%3Adescending&hide=median`);
    await show();
    await userEvent.click(screen.getByRole("button", { name: "30 días" }));
    expect(Object.fromEntries(search())).toEqual({ from: "2026-10-09", to: "2026-11-07", process_kind: "original", sort: "placements:descending", hide: "median" });
    await waitFor(() => expect(recruiters).toHaveBeenCalledTimes(2));
    expect(recruiters).toHaveBeenLastCalledWith({ from: "2026-10-09", to: "2026-11-07", process_kind: "original" });
  });

  it("filters by process in a single-choice panel that says which columns do not change", async () => {
    await show();
    await userEvent.click(screen.getByRole("button", { name: "Proceso" }));
    expect(screen.getByText("«Asignadas» y «Conversión» no cambian con el filtro de proceso.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /Reemplazos/ }));
    expect(search().get("process_kind")).toBe("replacement");
    expect(screen.getByRole("button", { name: "Proceso · 1" })).toBeInTheDocument();
  });

  it("opens each row's recruiter with origin=table plus the table's whole URL state (S4)", async () => {
    at(`?${WINDOW}&process_kind=original&recruiter_id=${marianaId}&sort=on_time%3Adescending&hide=median`);
    await show([card()]);
    const href = within(table()).getByRole("link", { name: "Mariana Torres" }).getAttribute("href")!;
    const url = new URL(href, "https://app.test");
    expect(url.pathname).toBe(`/empresa/metricas/reclutadores/${marianaId}`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ from: "2026-08-01", to: "2026-10-31", recruiter_id: marianaId, process_kind: "original", sort: "on_time:descending", hide: "median", origin: "table" });
  });

  it("opens «Qué mide cada columna» with the definitions in the table's order", async () => {
    await show();
    await userEvent.click(screen.getByRole("button", { name: /Qué mide cada columna/ }));
    const terms = within(screen.getByRole("dialog", { name: "Qué mide cada columna" })).getAllByRole("term").map(term => term.textContent!.split(" · ")[0]);
    expect(terms).toEqual(["Asignadas", "Reasignaciones", "Días en tramos", "Entregas a tiempo", "Mediana a la meta", "Entregados", "Placements", "Conversión"]);
  });
});

describe("the toolbar on a phone and the definitions sheet", () => {
  it("is a compact two-column grid (artboard): the period on one line, then Proceso | Columnas and Orden | Qué mide cada columna", async () => {
    await show();
    const bar = screen.getByRole("group", { name: "Filtros y vista" });
    expect(bar).toHaveClass("grid", "grid-cols-2");
    const period = within(bar).getByRole("group", { name: "Periodo" });
    expect(period).toHaveClass("flex-nowrap", "col-span-2");
    expect(period.className).not.toMatch(/(^|\s)flex-wrap/);
    // Phone: the chips size to their content (never narrower than it) and «Personalizado» becomes «Otro rango», so nothing is clipped.
    const custom = within(period).getByRole("button", { name: /Personalizado/ });
    expect(custom.querySelector("svg")).toHaveClass("max-md:hidden");
    expect(within(custom).getByText("Otro rango")).toHaveClass("md:hidden");
    expect(within(custom).getByText("Personalizado")).toHaveClass("max-md:hidden");
    for (const chip of within(period).getAllByRole("button")) expect(chip).toHaveClass("max-md:flex-auto", "max-md:whitespace-nowrap");
    // «Definiciones» on a phone, the full wording from md; one line, so the row is as tall as the select next to it.
    const definitions = within(bar).getByRole("button", { name: /Qué mide cada columna/ });
    expect(within(definitions).getByText("Definiciones")).toHaveClass("md:hidden");
    expect(within(definitions).getByText("Qué mide cada columna")).toHaveClass("max-md:hidden");
    expect(definitions).not.toHaveClass("max-md:whitespace-normal");
    expect(definitions).toHaveClass("max-md:h-auto");
    expect(within(bar).getByRole("button", { name: "Proceso" })).toHaveClass("max-md:w-full");
    expect(within(bar).getByRole("combobox", { name: "Orden" }).closest("div")).toHaveClass("md:hidden");
    // The reset only takes a row on a phone when there is something to reset.
    expect(within(bar).getByRole("button", { name: "Restablecer vista" })).toHaveClass("max-md:disabled:hidden", "max-md:col-span-2");
  });

  it("opens the definitions as a real modal (focus trapped, page behind hidden), in a focusable, named scroll region", async () => {
    await show();
    await userEvent.click(screen.getByRole("button", { name: /Qué mide cada columna/ }));
    const sheet = screen.getByRole("dialog", { name: "Qué mide cada columna" });
    // `modal="trap-focus"` let Tab reach the page behind; the default (`true`) traps focus and hides the page.
    expect(sheet).toHaveAttribute("data-modal", "true");
    const region = within(sheet).getByRole("region", { name: "Definiciones de las columnas" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveClass("overflow-y-auto", "overscroll-contain");
    expect(region.querySelector("dl")).not.toHaveClass("overflow-y-auto");
    expect(within(region).getAllByRole("term")).toHaveLength(8);
  });

  it("takes the sheet's definitions version from the same data as the page subtitle", async () => {
    await show(people(), AS_OF, "v2");
    expect(screen.getByText(/1 ago 2026 – 31 oct 2026 · Definiciones v2$/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Qué mide cada columna/ }));
    const sheet = screen.getByRole("dialog", { name: "Qué mide cada columna" });
    expect(within(sheet).getByText(/^Definiciones v2\./)).toBeInTheDocument();
    expect(within(sheet).queryByText(/Definiciones v1/)).toBeNull();
  });

  it("keeps the page where it was when the sheet opens and closes, even if the scroll lock moves it", async () => {
    await show();
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => frames.push(callback));
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const at = (top: number) => { Object.defineProperty(window, "scrollY", { configurable: true, value: top }); Object.defineProperty(window, "scrollX", { configurable: true, value: 0 }); };
    const flush = () => act(() => { while (frames.length) frames.shift()!(0); });
    try {
      at(640);
      await userEvent.click(screen.getByRole("button", { name: /Qué mide cada columna/ }));
      // The lock (or the focus move) resets the page to the top…
      at(0);
      flush();
      // …and the sheet puts it back.
      expect(scrollTo).toHaveBeenCalledWith({ left: 0, top: 640, behavior: "instant" });
      // Closing does the same if the page moved while the sheet was open (focus returning to a trigger that is off screen).
      scrollTo.mockClear();
      fireEvent.keyDown(screen.getByRole("dialog", { name: "Qué mide cada columna" }), { key: "Escape" });
      at(0);
      flush();
      expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, top: 640, behavior: "instant" });
    } finally {
      raf.mockRestore(); scrollTo.mockRestore(); at(0);
    }
  });
});

describe("states of the table region", () => {
  it("shows real headers over a skeleton while loading, with the toolbar already there", async () => {
    recruiters.mockReturnValue(new Promise(() => {}));
    render(<RecruitersPage />);
    const loading = await screen.findByRole("status", { name: "Cargando desempeño por reclutador" });
    expect(loading).toHaveAttribute("aria-busy", "true");
    expect(within(loading).getByText("Entregas a tiempo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Columnas" })).toBeInTheDocument();
  });

  it("says what failed, keeps the view, and retries", async () => {
    at(`?${WINDOW}&sort=median%3Aascending&hide=delivered`);
    recruiters.mockResolvedValueOnce({ ok: false, reason: "no_response", reference: {} } satisfies MetricsFailure);
    render(<RecruitersPage />);
    expect(await screen.findByText("No pudimos calcular el desempeño por reclutador")).toBeInTheDocument();
    expect(search().get("sort")).toBe("median:ascending");
    recruiters.mockResolvedValue(answer(people()));
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(headers()).not.toContain("Entregados");
  });

  it("explains an empty period without filters", async () => {
    recruiters.mockResolvedValue(answer([]));
    render(<RecruitersPage />);
    expect(await screen.findByText("Aún no hay reclutadores con actividad en este periodo")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("keeps and names the filters when they leave nobody, and clears them from the message", async () => {
    at(`?${WINDOW}&process_kind=replacement&requester_kind=client`);
    recruiters.mockResolvedValue(answer([]));
    render(<RecruitersPage />);
    expect(await screen.findByText("Sin resultados")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Filtros activos" })).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Limpiar filtros" }).at(-1)!);
    expect(Object.fromEntries(search())).toEqual({ from: "2026-08-01", to: "2026-10-31" });
  });

  it("dims the previous answer while a new period loads (rule 17)", async () => {
    await show();
    let resolve!: (value: MetricsResult<RecruiterList>) => void;
    recruiters.mockReturnValue(new Promise(next => { resolve = next; }));
    await userEvent.click(screen.getByRole("button", { name: "30 días" }));
    expect(table().closest(".opacity-60")).not.toBeNull();
    await act(async () => { resolve(answer(people())); });
    await waitFor(() => expect(table().closest(".opacity-60")).toBeNull());
  });
});
