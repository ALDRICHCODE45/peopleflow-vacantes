import * as React from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
// Same boundary as metrics-workspace.test: the real Base UI popover close path refocus-loops under jsdom.
vi.mock("@/components/ui/popover", async () => {
  const Context = React.createContext<{ open: boolean; setOpen: (next: boolean) => void }>({ open: false, setOpen: () => {} });
  return {
    Popover: ({ open, onOpenChange, children }: { open?: boolean; onOpenChange?: (next: boolean) => void; children?: React.ReactNode }) =>
      <Context.Provider value={{ open: Boolean(open), setOpen: next => onOpenChange?.(next) }}>{children}</Context.Provider>,
    PopoverTrigger: ({ render, children }: { render: React.ReactElement<{ onClick?: () => void; children?: React.ReactNode }>; children?: React.ReactNode }) => {
      const { open, setOpen } = React.useContext(Context);
      return React.cloneElement(render, { onClick: () => setOpen(!open), ...(children ? { children } : {}) });
    },
    PopoverContent: ({ children }: { children?: React.ReactNode }) => React.useContext(Context).open ? <div role="dialog">{children}</div> : null,
    PopoverTitle: ({ children }: { children?: React.ReactNode }) => <h4>{children}</h4>,
    PopoverDescription: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  };
});
import type { PipelineSection as PipelineData } from "../model";
import type { SectionState } from "../use-section";
import { draftId, pipeline } from "../test-fixtures";
import { PipelineSection } from "./pipeline-section";

const period = { from: "2026-08-01", to: "2026-10-31" };
const ready = (data: PipelineData): SectionState<PipelineData> => ({ status: "ready", data, stale: false, failure: null, ref: vi.fn(), retry: vi.fn(), activate: vi.fn() });
const show = (data: PipelineData = pipeline()) => render(<PipelineSection state={ready(data)} filters={{}} period={period} />);
const card = (title: string) => screen.getByRole("heading", { level: 3, name: title }).closest('[data-slot="card"]') as HTMLElement;
const query = (link: HTMLElement) => Object.fromEntries(new URL(link.getAttribute("href")!, "https://app.test").searchParams);
// DD2: «en proceso» = active, neither new nor placement.
const IN_PROCESS = "screening,screening_ok,in_process,custom,retired";

afterEach(cleanup);

describe("Pipeline por etapa (artboard 07)", () => {
  it("has a professional title; the threshold and «foto de hoy» live behind «Cómo se calcula», never under the title", async () => {
    show();
    const section = screen.getByRole("region", { name: "Pipeline por etapa" });
    expect(section.querySelector("h2 + p")).toBeNull();
    expect(section).not.toHaveTextContent("Detenido =");
    await userEvent.click(screen.getByRole("button", { name: "Cómo se calcula: Pipeline por etapa" }));
    const help = screen.getByRole("dialog");
    expect(help).toHaveTextContent("Foto de hoy; no depende del periodo");
    expect(help).toHaveTextContent("Detenido = 7 días hábiles o más en la etapa");
    expect(help).toHaveTextContent("fuera de Nuevos y Placement");
  });

  it("shows two cards: candidates by stage (8 columns) and the vacancies with most candidates (4 columns)", () => {
    show();
    expect(screen.getAllByRole("heading", { level: 3 }).map(heading => heading.textContent)).toEqual(["Candidatos por etapa", "Vacantes con más candidatos"]);
    expect(card("Candidatos por etapa")).toHaveClass("xl:col-span-8");
    expect(card("Vacantes con más candidatos")).toHaveClass("xl:col-span-4");
  });

  it("lists every stage in the contract order with count, median days and stalled badge", () => {
    show();
    const rows = within(card("Candidatos por etapa")).getAllByRole("listitem");
    expect(rows.map(row => within(row).getAllByText(/./)[0].textContent)).toEqual(["Nuevos", "Screening", "Screening OK", "En proceso", "Columnas propias", "Placement"]);
    expect(rows[0]).toHaveTextContent("48");
    expect(rows[0]).toHaveTextContent("1 día hábil");
    expect(rows[0]).toHaveTextContent("2 detenidos");
    expect(rows[2]).toHaveTextContent("1 detenido");
    expect(rows[3]).toHaveTextContent("6.5 días hábiles");
    expect(rows[4]).toHaveTextContent("Sin datos suficientes");
    expect(rows[4]).toHaveTextContent("Al día");
    expect(rows[5]).toHaveTextContent("No aplica");
    expect(card("Candidatos por etapa")).toHaveTextContent("Hoy · 101 candidatos en vacantes abiertas");
  });

  it("adds the retired stage only when the response has it", () => {
    show(pipeline({ stages: [...pipeline().stages, { kind: "retired", candidates: 3, median_business_days_in_stage: 9, stalled: 2 }] }));
    expect(within(card("Candidatos por etapa")).getAllByRole("listitem").at(-1)).toHaveTextContent("Columnas retiradas");
  });

  it("tints only stalled counts above 0 with the alarm tone", () => {
    show();
    const rows = within(card("Candidatos por etapa")).getAllByRole("listitem");
    expect(within(rows[3]).getByText("7 detenidos")).toHaveClass("text-destructive");
    expect(within(rows[4]).getByText("Al día")).not.toHaveClass("text-destructive");
  });

  it("opens each stage, its stalled people and the total per contract §4.4; a 0 is never a link", () => {
    show();
    expect(query(screen.getByRole("link", { name: "Ver los 48 candidatos en Nuevos" }))).toEqual({ kind: "candidates", stage_kind: "new", ...period });
    expect(query(screen.getByRole("link", { name: "Ver el 1 candidato en Screening OK" }))).toEqual({ kind: "candidates", stage_kind: "screening_ok", ...period });
    expect(query(screen.getByRole("link", { name: "Ver los 7 candidatos detenidos en En proceso" }))).toEqual({ kind: "candidates", stage_kind: "in_process", stalled: "true", ...period });
    expect(query(screen.getByRole("link", { name: "Ver los 101 candidatos en vacantes abiertas" }))).toEqual({ kind: "candidates", ...period });
    expect(screen.queryByRole("link", { name: /Columnas propias/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /detenidos en Placement/ })).not.toBeInTheDocument();
  });

  it("lists the top vacancies with requester and responsible, opening exactly the in-process candidates of each", () => {
    show();
    const top = card("Vacantes con más candidatos");
    expect(top).toHaveTextContent("2 vacantes abiertas");
    const rows = within(top).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Analista de crédito Sr.");
    expect(rows[0]).toHaveTextContent("Grupo Bimbo · Mariana Torres");
    expect(rows[0]).toHaveTextContent("14 en proceso");
    expect(rows[1]).toHaveTextContent("Vacante sin título");
    expect(rows[1]).toHaveTextContent("Sin solicitante · Sin responsable");
    const link = within(rows[0]).getByRole("link", { name: "Ver los 14 candidatos en proceso de Analista de crédito Sr." });
    expect(query(link)).toEqual({ kind: "candidates", vacancy_id: draftId, stage_kind: IN_PROCESS, ...period });
    expect(within(rows[1]).getByRole("link", { name: "Ver el 1 candidato en proceso de Vacante sin título" })).toBeInTheDocument();
  });

  it("shows each card's own empty state", () => {
    show(pipeline({ stages: pipeline().stages.map(stage => ({ ...stage, candidates: 0, median_business_days_in_stage: null, stalled: 0 })), top_vacancies: [] }));
    expect(card("Candidatos por etapa")).toHaveTextContent("Sin candidatos en proceso");
    expect(card("Vacantes con más candidatos")).toHaveTextContent("Sin vacantes con candidatos en proceso");
  });

  it("shows a skeleton shaped like the two cards while loading", () => {
    render(<PipelineSection state={{ status: "loading", data: null, stale: false, failure: null, ref: vi.fn(), retry: vi.fn(), activate: vi.fn() }} filters={{}} period={period} />);
    expect(screen.getByRole("status", { name: "Cargando pipeline por etapa" })).toBeInTheDocument();
  });
});
