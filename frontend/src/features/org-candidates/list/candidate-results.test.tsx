import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { CandidateResults, CandidateResultsSkeleton } from "./candidate-results";
import { candidate } from "./test-fixtures";
import { candidateSchema, type OrgCandidate } from "../model";
vi.mock("@/components/ui/dropdown-menu", async () => (await import("@/components/data-table/test-menu")).menuDouble);
vi.mock("@/components/ui/tooltip", async () => (await import("@/components/data-table/test-menu")).tooltipDouble);
vi.mock("../contacts/contacts-actions", () => ({ getCandidateContactsAction: vi.fn() }));
vi.mock("./candidate-csv", () => ({ downloadCandidateCsv: vi.fn() }));
import { getCandidateContactsAction } from "../contacts/contacts-actions";
import { downloadCandidateCsv } from "./candidate-csv";
const languages = [{ code: "en", name: "Inglés" }, { code: "es", name: "Español" }];
const empty: OrgCandidate = { ...candidate, professional_title: null, profile: { location: null, skills: [], seniority: null, years_of_experience: null, education: { highest_completed: null, in_progress: null }, languages: [] } };
beforeEach(() => { vi.stubGlobal("PointerEvent", MouseEvent); localStorage.clear(); vi.mocked(downloadCandidateCsv).mockClear(); vi.mocked(getCandidateContactsAction).mockReset(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each(["table", "cards"] as const)("shows correction indicators from parsed list data in %s without opening detail", view => {
 const corrected = candidateSchema.parse({ ...candidate, kind: "organic", corrected_fields: ["full_name"] });
 const { rerender } = show(corrected, view);
 expect(screen.getByLabelText("Datos corregidos por tu empresa")).toBeInTheDocument();
 rerender(<CandidateResults items={[candidate]} view={view} languages={languages} />);
 expect(screen.queryByLabelText("Datos corregidos por tu empresa")).not.toBeInTheDocument();
});
it("waits for contacts, disables export with Spinner, then downloads only the captured selection", async () => {
 let resolve!: (value: { ok: true; data: { items: [] } }) => void;
 vi.mocked(getCandidateContactsAction).mockReturnValue(new Promise(done => { resolve = done; }));
 show(); fireEvent.click(screen.getByRole("checkbox", { name: "Seleccionar todos" }));
 const button = screen.getByRole("button", { name: "Exportar seleccionados" }); fireEvent.click(button);
 expect(button).toBeDisabled(); expect(button.querySelector('[data-slot=spinner]')).not.toBeNull();
 expect(downloadCandidateCsv).not.toHaveBeenCalled();
 expect(getCandidateContactsAction).toHaveBeenCalledExactlyOnceWith([{ kind: candidate.kind, id: candidate.id }]);
 await act(async () => { resolve({ ok: true, data: { items: [] } }); });
 expect(button).not.toBeDisabled();
 expect(downloadCandidateCsv).toHaveBeenCalledWith([candidate], expect.arrayContaining(["candidate", "activity"]), languages, []);
});
it.each(["failure", "throw"])("does not download on contact %s and shows the C4 feedback", async mode => {
 if (mode === "failure") vi.mocked(getCandidateContactsAction).mockResolvedValue({ ok: false });
 else vi.mocked(getCandidateContactsAction).mockRejectedValue(new Error("private"));
 show(); fireEvent.click(screen.getByRole("checkbox", { name: "Seleccionar todos" }));
 fireEvent.click(screen.getByRole("button", { name: "Exportar seleccionados" }));
 expect((await screen.findByText("No pudimos obtener el contacto de los candidatos. Intenta de nuevo.")).closest('[role="status"]')).toBeInTheDocument();
 expect(downloadCandidateCsv).not.toHaveBeenCalled();
 await waitFor(() => expect(screen.getByRole("button", { name: "Exportar seleccionados" })).not.toBeDisabled());
});
it("matches the approved row anatomy using primitive slots, including corrections and origin", () => {
  show({ ...candidate, corrected_fields: ["full_name"] } as OrgCandidate);
  const row = screen.getByText(candidate.full_name).closest('tr')!;
  const identity = row.querySelector('[data-column-id=candidate]')!;
  expect(identity.querySelector('[data-slot=avatar-fallback]')).toHaveTextContent('MO');
  expect(within(identity as HTMLElement).getByText('Manual')).toHaveAttribute('data-slot', 'badge');
  expect(within(identity as HTMLElement).getByLabelText('Datos corregidos por tu empresa')).toBeInTheDocument();
  expect(row.querySelector('[data-column-id=vacancy] [data-slot=badge]')).toHaveTextContent('Entrevista');
  expect(screen.getByText('Guadalajara')).toBeInTheDocument();
  expect(screen.getByText('Jalisco, México')).toBeInTheDocument();
  expect(screen.getByText('1 activo')).toHaveClass('text-status-success');
});
function show(item: OrgCandidate = candidate, view: "table" | "cards" = "table") {
  return render(<CandidateResults items={[item]} view={view} languages={languages} />);
}
it("renders selection plus nine data/action columns, two-line hierarchy, fixed widths and default pins", () => {
  show();
  expect(screen.getAllByRole("columnheader").map(header => header.querySelector('[data-header-label]')?.textContent)).toEqual(["", "Candidato", "Ubicación", "Experiencia", "Estudios", "Idiomas", "Última vacante", "Procesos", "Actividad", "Acciones"]);
  expect(screen.getByRole("table")).toHaveClass("table-fixed");
  expect(screen.getByText("4.5 años")).toHaveClass("truncate", "font-medium");
  expect(screen.getByText("Senior")).toHaveClass("truncate", "text-muted-foreground");
  expect(screen.getByText("Maestría · En curso")).toHaveClass("truncate");
  expect(screen.getByText("Jalisco, México")).toBeInTheDocument();
  expect(screen.getByText("2 procesos")).toBeInTheDocument(); expect(screen.getByText("1 activo")).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: /Candidato/u })).toHaveAttribute("data-pinned", "start");
  expect(screen.getByRole("columnheader", { name: /Acciones/u })).toHaveAttribute("data-pinned", "end");
  expect(JSON.parse(localStorage.getItem("pf.table.org-candidates")!).v).toBe(1);
  const widths = screen.getAllByRole("columnheader").map(header => parseInt(header.style.width));
  // 1440px viewport minus the sidebar and page padding leaves ~1300px: all default columns must fit without horizontal scroll.
  expect(widths.reduce((sum, width) => sum + width, 0)).toBeLessThanOrEqual(1300);
  expect(widths.at(-1)).toBe(56);
  // Short-label columns keep room for their label plus the 24px options button («Proces…» was cut at 104px).
  const widthOf = (name: string) => parseInt((screen.getByRole("columnheader", { name }) as HTMLElement).style.width);
  expect(widthOf("Procesos")).toBeGreaterThanOrEqual(116);
  expect(widthOf("Actividad")).toBeGreaterThanOrEqual(120);
  expect(screen.getByText("Acciones")).toHaveClass("sr-only");
  expect(screen.queryByRole("button", { name: "Opciones de Acciones" })).not.toBeInTheDocument();
});
it("reserves 202px for common education and grows the vacancy column without changing fixed widths", () => {
  show();
  expect(screen.getByRole("columnheader", { name: "Estudios" })).toHaveStyle({ width: "202px" });
  const viewport = screen.getByRole("region", { name: "Tabla con desplazamiento horizontal" });
  Object.defineProperty(viewport, "clientWidth", { value: 1600 });
  fireEvent(window, new Event("resize"));
  expect(screen.getByRole("table")).toHaveStyle({ width: "1600px" });
  expect(screen.getByRole("columnheader", { name: "Última vacante" })).toHaveStyle({ width: "466px" });
  expect(screen.getByRole("columnheader", { name: "Estudios" })).toHaveStyle({ width: "202px" });
  expect(screen.getByRole("columnheader", { name: "Acciones" })).toHaveStyle({ width: "56px" });
});
it("truncates long text instead of wrapping, including the candidate name", () => {
  show();
  expect(screen.getByText(candidate.full_name)).toHaveClass("truncate", "text-foreground");
  expect(screen.getByText(candidate.professional_title)).toHaveClass("truncate");
  expect(screen.getByText("Backend Go")).toHaveClass("truncate");
  for (const cell of screen.getAllByRole("cell")) expect(cell).not.toHaveClass("whitespace-normal");
});
it("shows the first language chip and a muted +N tooltip listing all languages", async () => {
  show({ ...candidate, profile: { ...candidate.profile, languages: [{ code: "en", level: "C1" }, { code: "es", level: "native" }] } });
  expect(screen.getByText("Inglés C1").closest('[data-slot="badge"]')).toHaveAttribute('data-variant', 'outline');
  const more = screen.getByText("+1 idioma"); expect(more).toHaveClass("text-muted-foreground");
  fireEvent.focus(more);
  const tooltip = await screen.findByRole("tooltip");
  expect(tooltip).toHaveTextContent("Inglés C1"); expect(tooltip).toHaveTextContent("Español Nativo");
});
it.each([
  ["closed", "active", "active", "Cerrada"], ["paused", "active", "active", "Pausada"],
  ["published", "finished", "active", "Proceso finalizado"], ["published", "active", "discarded", "Descartado"],
  ["published", "active", "active", "Entrevista"],
] as const)("renders stage and dot status (%s / %s / %s)", (publication, process, state, text) => {
  show({ ...candidate, latest_participation: { ...candidate.latest_participation!, state, vacancy: { ...candidate.latest_participation!.vacancy, lifecycle: { publication, process } } } });
  const value = screen.getByText(new RegExp(text, "u"));
  expect(value).toHaveClass("truncate");
  const badge = value.closest('[data-slot=badge]');
  expect(badge).toHaveAttribute('data-dot');
  expect(badge).toHaveAttribute('data-variant', text === "Cerrada" || text === "Proceso finalizado" ? "neutral" : text === "Pausada" ? "review" : text === "Descartado" ? "danger" : "info");
});
it("trims stage labels in the vacancy secondary line", () => {
  show({ ...candidate, latest_participation: { ...candidate.latest_participation!, stage: { ...candidate.latest_participation!.stage, name: " Nuevos " } } });
  expect(screen.getByText("Nuevos").textContent).toBe("Nuevos");
});
it("shows activity date and relative time", () => {
  vi.spyOn(Date, "now").mockReturnValue(new Date("2026-10-23T18:02:11Z").getTime());
  show(); expect(screen.getByText(/21 oct.*2026/u)).toBeInTheDocument(); expect(screen.getByText("hace 2 días")).toBeInTheDocument();
});
it("opens the sheet by row click or Enter, but never by opening or using row menus", async () => {
  const onOpen = vi.fn();
  render(<CandidateResults items={[candidate]} view="table" languages={languages} onOpen={onOpen} />);
  const row = screen.getByText(candidate.full_name).closest("tr")!;
  fireEvent.click(row); fireEvent.keyDown(row, { key: "Enter" }); expect(onOpen).toHaveBeenCalledTimes(2); onOpen.mockClear();
  await userEvent.click(screen.getByRole("button", { name: `Acciones de ${candidate.full_name}` })); expect(onOpen).not.toHaveBeenCalled();
  expect(screen.getByRole("menuitem", { name: "Abrir tablero de la vacante" })).toHaveAttribute("href", `/empresa/vacantes/${candidate.latest_participation!.vacancy.id}/pipeline`);
  await userEvent.click(screen.getByRole("menuitem", { name: "Ver ficha" })); expect(onOpen).toHaveBeenCalledExactlyOnceWith({ kind: candidate.kind, id: candidate.id });
});
it("does not offer a board without a latest participation", async () => {
  show({ ...empty, latest_participation: null });
  expect(screen.getByText("Sin participaciones")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: `Acciones de ${candidate.full_name}` }));
  expect(screen.queryByText("Abrir tablero de la vacante")).not.toBeInTheDocument();
});
it("mutes missing profile facts without inventing values", () => {
  show(empty); for (const missing of screen.getAllByText("Sin dato")) expect(missing).toHaveClass("text-muted-foreground");
});
it("keeps cards unchanged: language pills, origin badge, neutral name action and incomplete-profile fallback", () => {
  const { rerender } = show(candidate, "cards");
  expect(screen.getByText("Inglés C1").closest('[data-slot=badge]')).toHaveAttribute("data-variant", "outline");
  expect(screen.getByText("Manual")).toHaveAttribute("data-variant", "outline");
  expect(screen.getByRole("button", { name: `Abrir ficha de ${candidate.full_name}` })).toHaveClass("text-foreground", "font-medium");
  rerender(<CandidateResults items={[empty]} view="cards" languages={languages} />);
  expect(screen.queryAllByText(/Sin dato/u)).toHaveLength(0); expect(screen.getByText("Perfil sin completar")).toBeInTheDocument();
});
it.each([
  { seniority: "senior" as const, years_of_experience: null, text: "Senior" },
  { seniority: null, years_of_experience: "0", text: "0 años" },
  { seniority: null, years_of_experience: "1", text: "1 año" },
])("cards retain partial experience: $text", ({ text, ...experience }) => {
  show({ ...empty, profile: { ...empty.profile, ...experience } }, "cards"); expect(screen.getByText(text)).toBeInTheDocument(); expect(screen.queryByText("Perfil sin completar")).not.toBeInTheDocument();
});
it.each([
  { profile: { ...empty.profile, location: candidate.profile.location }, text: "Guadalajara, Jalisco" },
  { profile: { ...empty.profile, education: candidate.profile.education }, text: "Licenciatura o Ingeniería" },
  { profile: { ...empty.profile, languages: candidate.profile.languages }, text: "Inglés C1" },
  { profile: { ...empty.profile, skills: ["Go"] }, text: "Go" },
])("cards retain isolated facts: $text", ({ profile, text }) => {
  show({ ...empty, profile }, "cards"); expect(screen.getByText(text)).toBeInTheDocument(); expect(screen.queryByText("Perfil sin completar")).not.toBeInTheDocument();
});
it("keeps loading columns aligned with the rich table", () => {
  const { container } = render(<CandidateResultsSkeleton view="table" />); expect(within(container).queryByText("Seniority")).not.toBeInTheDocument(); expect(container.querySelectorAll("th")).toHaveLength(10);
});
