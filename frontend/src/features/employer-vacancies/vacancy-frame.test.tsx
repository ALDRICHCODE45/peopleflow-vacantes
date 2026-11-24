import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { Lifecycle } from "@/features/vacancy-lifecycle/model";
import { boardFixture } from "@/features/pipeline-movement/board-fixture";
import { VacancyFrame, vacancyTabsFor, type VacancyTab } from "./vacancy-frame";
import { InVacancyTabRow } from "./vacancy-frame-slot";

// S9: one frame (identity row + tabs) for Pipeline / Documentos / Configuración. S11: the tab visibility rule.
vi.mock("@/components/company-dashboard/site-header", () => ({
  SiteHeader: (props: { title?: string | null; parent?: { label: string; href: string }; status?: ReactNode }) => <header data-testid="site-header" data-title={String(props.title)} data-has-status={String(props.status !== undefined)}>{props.parent && <a href={props.parent.href}>{props.parent.label}</a>}</header>,
}));
afterEach(cleanup);
const id = "123e4567-e89b-42d3-a456-426614174000";
const lifecycle = (extra: Partial<Lifecycle> = {}): Lifecycle => ({ ...boardFixture().lifecycle, publication: "published", process: "active", published_at: "2026-11-05T18:00:00Z", paused_at: null, closed_at: null, process_finished_at: null, close_reason: null, close_reason_note: null, ...extra });
const frame = (props: Partial<Parameters<typeof VacancyFrame>[0]> = {}) => render(<VacancyFrame vacancyId={id} active="pipeline" title="Supervisor(a) de Almacén" lifecycle={lifecycle()} {...props}><p>Contenido de la pestaña</p></VacancyFrame>);
const tabsNav = () => screen.getByRole("navigation", { name: "Secciones de la vacante" });

it("offers Pipeline, Documentos and Configuración as links to the three vacancy routes, in that order", () => {
  frame();
  const links = within(tabsNav()).getAllByRole("link");
  expect(links.map(link => link.textContent)).toEqual(["Pipeline", "Documentos", "Configuración"]);
  expect(links.map(link => link.getAttribute("href"))).toEqual([`/empresa/vacantes/${id}/pipeline`, `/empresa/vacantes/${id}/documentos`, `/empresa/vacantes/${id}/configuracion`]);
});
it.each([["pipeline", "Pipeline"], ["documentos", "Documentos"], ["configuracion", "Configuración"]] as const)("marks only %s as the current page", (active, label) => {
  frame({ active });
  const links = within(tabsNav()).getAllByRole("link");
  expect(links.filter(link => link.hasAttribute("aria-current")).map(link => link.textContent)).toEqual([label]);
  expect(screen.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
});
it("keeps tabs as plain keyboard-reachable links (no tab roles, no negative tabindex) with 40px targets", () => {
  frame();
  expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  for (const link of within(tabsNav()).getAllByRole("link")) {
    expect(link).not.toHaveAttribute("tabindex");
    expect(link).toHaveClass("min-h-10");
  }
});
it("is a segmented control on phones: three equal columns on a muted track, the current tab raised", () => {
  frame();
  expect(within(tabsNav()).getByRole("list")).toHaveClass("max-sm:grid", "max-sm:grid-flow-col", "max-sm:auto-cols-fr", "max-sm:bg-muted");
  expect(screen.getByRole("link", { name: "Pipeline" })).toHaveClass("max-sm:aria-[current=page]:bg-background");
});
it("keeps the shared SiteHeader to the back crumb: it gets title={null} and no status", () => {
  frame();
  const header = screen.getByTestId("site-header");
  expect(header).toHaveAttribute("data-title", "null"); // null on purpose: omitting it would read «Dashboard»
  expect(header).toHaveAttribute("data-has-status", "false");
  expect(within(header).getByRole("link", { name: "Vacantes" })).toHaveAttribute("href", "/empresa/vacantes");
});
it("shows the identity row above the tabs: the vacancy title is the page h1 and wraps instead of truncating", () => {
  const title = "Supervisor(a) de Almacén con una descripción muy larga que en un teléfono debe verse completa";
  frame({ title });
  const heading = screen.getByRole("heading", { level: 1, name: title });
  expect(heading.className).not.toMatch(/truncate|line-clamp/);
  expect(heading).toHaveClass("[overflow-wrap:anywhere]");
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(heading.compareDocumentPosition(tabsNav()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it("shows state, «Reemplazo» and «Privada» badges and the start date in the identity row", () => {
  frame({ lifecycle: lifecycle({ kind: "replacement", sequence: 2, replacement_of: "223e4567-e89b-42d3-a456-426614174000", visibility: "private" }) });
  expect(screen.getByText("Activa")).toHaveAttribute("data-slot", "badge");
  expect(screen.getByText("Reemplazo")).toHaveAttribute("data-slot", "badge");
  expect(screen.getByText("Privada", { selector: '[data-slot="badge"]' })).toBeVisible();
  expect(screen.getByText(/Proceso iniciado el/)).toHaveTextContent("Proceso iniciado el 5 nov 2026");
  expect(screen.getByText("Privada · sin publicar")).toBeVisible();
});
it("an original says «Publicada el …» (the publication read's date when the lifecycle has none)", () => {
  frame({ lifecycle: lifecycle({ published_at: null }), publishedAt: "2026-10-16T12:00:00Z" });
  expect(screen.getByText(/Publicada el/)).toHaveTextContent("Publicada el 16 oct 2026");
});
it.each([[{ covered: 1, required: 2 }, "Cubierta al cierre"], [{ covered: 2, required: 2 }, "Cubierta"], [undefined, "Cubierta"]] as const)("a closed vacancy says «Motivo de cierre» with its coverage (%j → %s)", (coverage, label) => {
  frame({ lifecycle: lifecycle({ publication: "closed", process: "finished", close_reason: "filled", closed_at: "2026-11-14T12:00:00Z", process_finished_at: "2026-11-14T12:00:00Z" }), coverage });
  expect(screen.getByText(/Proceso finalizado el/)).toHaveTextContent("Proceso finalizado el 14 nov 2026");
  expect(screen.getByText(/Motivo de cierre/)).toHaveTextContent(new RegExp(`^Motivo de cierre: ${label}$`));
});
it("can hide the status badges while the publication read has failed, keeping title and dates", () => {
  frame({ showStatus: false });
  expect(screen.queryByText("Activa")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Supervisor(a) de Almacén" })).toBeVisible();
  expect(screen.getByText(/Publicada el/)).toBeVisible();
});
it("while loading it reserves the identity row: a skeleton, an accessible h1 with the fallback name, busy semantics", () => {
  const { container } = frame({ title: undefined, lifecycle: undefined, loading: true, fallbackTitle: "Pipeline" });
  expect(screen.getByRole("heading", { level: 1, name: "Pipeline" })).toBeInTheDocument();
  expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
  // The tabs are navigation, not data: they are usable while the vacancy loads.
  expect(screen.getByRole("link", { name: "Documentos" })).toHaveAttribute("href", `/empresa/vacantes/${id}/documentos`);
});
it("with no title (a failed read) shows the fallback name visibly", () => {
  frame({ title: undefined, lifecycle: undefined, fallbackTitle: "Configuración" });
  expect(screen.getByRole("heading", { level: 1, name: "Configuración" })).toBeVisible();
});
it("S11: a stakeholder sees only the Documentos tab (no Pipeline, no Configuración)", () => {
  const tabs = vacancyTabsFor("stakeholder");
  expect(tabs).toEqual<VacancyTab[]>(["documentos"]);
  expect(vacancyTabsFor("employer")).toEqual<VacancyTab[]>(["pipeline", "documentos", "configuracion"]);
  frame({ active: "documentos", tabs });
  expect(within(tabsNav()).getAllByRole("link").map(link => link.textContent)).toEqual(["Documentos"]);
  expect(screen.queryByRole("link", { name: "Pipeline" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Configuración" })).not.toBeInTheDocument();
});
it("renders no tab row when the vacancy cannot be opened (tabs=[]), keeping the identity fallback", () => {
  frame({ tabs: [], title: undefined, lifecycle: undefined, fallbackTitle: "Pipeline" });
  expect(screen.queryByRole("navigation", { name: "Secciones de la vacante" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Pipeline" })).toBeVisible();
  expect(screen.getByText("Contenido de la pestaña")).toBeVisible();
});
it("renders the tab content below the tabs", () => {
  frame();
  expect(tabsNav().compareDocumentPosition(screen.getByText("Contenido de la pestaña")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it("fills the viewport only when asked (the live board), keeping page scroll otherwise", () => {
  const { container, unmount } = frame({ fill: true });
  expect(container.firstElementChild).toHaveClass("md:h-[calc(100dvh-1rem)]", "md:overflow-hidden", "min-h-0", "flex-1");
  unmount();
  const other = frame();
  expect(other.container.firstElementChild).not.toHaveClass("md:h-[calc(100dvh-1rem)]");
});
it("lets the tab's content place one line (the replacement link) in the tab row, and inline when there is no frame", () => {
  const { container } = render(<VacancyFrame vacancyId={id} active="pipeline" title="T" lifecycle={lifecycle()}><InVacancyTabRow><p>Aviso de reemplazo</p></InVacancyTabRow></VacancyFrame>);
  expect(tabsNav().parentElement).toContainElement(screen.getByText("Aviso de reemplazo"));
  expect(container.querySelectorAll("p:not([role=status])")).toHaveLength(2); // the date line and the notice (the share menu keeps its own live region)
  cleanup();
  render(<InVacancyTabRow><p>Aviso suelto</p></InVacancyTabRow>);
  expect(screen.getByText("Aviso suelto")).toBeVisible();
});

// S11/S12: the stakeholder audience. Documentos is the only tab, the back crumb returns to the stakeholder list, and the identity row
// is fed by the `vacancy` header of document-overview (the stakeholder has no lifecycle read).
it("S11: the stakeholder audience offers Documentos only and points the back crumb at the stakeholder list", () => {
  frame({ audience: "stakeholder", active: "documentos" });
  expect(within(tabsNav()).getAllByRole("link").map(link => link.textContent)).toEqual(["Documentos"]);
  expect(within(tabsNav()).getByRole("link", { name: "Documentos" })).toHaveAttribute("href", `/empresa/vacantes/${id}/documentos`);
  expect(within(screen.getByTestId("site-header")).getByRole("link", { name: "Vacantes" })).toHaveAttribute("href", "/empresa/stakeholder/vacantes");
});
it("keeps the employer audience as it was: three tabs and the portfolio crumb", () => {
  frame({ audience: "employer" });
  expect(within(tabsNav()).getAllByRole("link")).toHaveLength(3);
  expect(within(screen.getByTestId("site-header")).getByRole("link", { name: "Vacantes" })).toHaveAttribute("href", "/empresa/vacantes");
});
it("builds the identity row from the overview header: state, «Reemplazo» and «Privada», no lifecycle dates", () => {
  frame({ audience: "stakeholder", active: "documentos", title: "Analista contable", lifecycle: undefined, vacancy: { id, title: "Analista contable", publication: "published", process: "active", kind: "replacement", visibility: "private" } });
  expect(screen.getByRole("heading", { level: 1, name: "Analista contable" })).toBeVisible();
  expect(screen.getByText("Activa")).toHaveAttribute("data-slot", "badge");
  expect(screen.getByText("Reemplazo")).toHaveAttribute("data-slot", "badge");
  expect(screen.getByText("Privada", { selector: '[data-slot="badge"]' })).toBeVisible();
  expect(screen.queryByText(/Publicada el|Proceso iniciado el|Motivo de cierre/)).toBeNull();
});
it("reads a never-published draft from the overview header as «Borrador» and no title as the fallback", () => {
  frame({ audience: "stakeholder", active: "documentos", title: undefined, lifecycle: undefined, fallbackTitle: "Sin título", vacancy: { id, title: null, publication: null, process: null, kind: "original", visibility: null } });
  expect(screen.getByRole("heading", { level: 1, name: "Sin título" })).toBeVisible();
  expect(screen.getByText("Borrador")).toHaveAttribute("data-slot", "badge");
  expect(screen.queryByText("Reemplazo")).toBeNull();
});
it("says «Cerrada · proceso finalizado» for a closed vacancy of the overview header", () => {
  frame({ audience: "stakeholder", active: "documentos", title: "Cerrada", lifecycle: undefined, vacancy: { id, title: "Cerrada", publication: "closed", process: "finished", kind: "original", visibility: "public" } });
  expect(screen.getByText("Cerrada · proceso finalizado")).toHaveAttribute("data-slot", "badge");
});

// A-F3/A-F4: the way back to the editor and sharing live in the identity row of a live vacancy.
const identity = () => document.querySelector("[data-pf-vacancy-identity]") as HTMLElement;
it("a published public vacancy offers «Editar publicación», «Compartir» and «Ver página pública» (new tab) in the identity row", () => {
  frame({ lifecycle: lifecycle({ visibility: "public" }) });
  const row = within(identity());
  expect(row.getByRole("link", { name: "Editar publicación" })).toHaveAttribute("href", `/empresa/vacantes/borradores/${id}`);
  expect(row.getByRole("button", { name: "Compartir" })).toBeInTheDocument();
  const publicPage = row.getByRole("link", { name: /Ver página pública/ });
  expect(publicPage).toHaveAttribute("href", `/vacantes/${id}`);
  expect(publicPage).toHaveAttribute("target", "_blank");
  expect(publicPage).toHaveAttribute("rel", "noopener noreferrer");
});
it.each([
  ["a private replacement", { visibility: "private" as const }, true],
  ["a paused vacancy", { publication: "paused" as const, visibility: "public" as const }, true],
  ["a closed vacancy", { publication: "closed" as const, process: "finished" as const, closed_at: "2026-11-10T12:00:00Z", process_finished_at: "2026-11-10T12:00:00Z", visibility: "public" as const }, false],
  ["a draft", { publication: null, process: null, published_at: null, visibility: null }, false],
])("%s has no public page or share in the identity row (editor: %s)", (_name, extra, editor) => {
  frame({ lifecycle: lifecycle(extra) });
  const row = within(identity());
  expect(row.queryByRole("link", { name: /Ver página pública/ })).not.toBeInTheDocument();
  expect(row.queryByRole("button", { name: "Compartir" })).not.toBeInTheDocument();
  expect(Boolean(row.queryByRole("link", { name: "Editar publicación" }))).toBe(editor);
});
it("a stakeholder, or a frame still loading, gets none of these actions", () => {
  frame({ audience: "stakeholder", lifecycle: lifecycle({ visibility: "public" }) });
  expect(within(identity()).queryByRole("link", { name: "Editar publicación" })).not.toBeInTheDocument();
  cleanup();
  frame({ loading: true, lifecycle: lifecycle({ visibility: "public" }) });
  expect(within(identity()).queryByRole("button", { name: "Compartir" })).not.toBeInTheDocument();
});
