import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/components/ui/popover", async () => (await import("../test-utils")).popoverMock());
import { drillFor } from "../drilldown";
import { summary } from "../test-fixtures";
import { failed, loading, ready } from "../test-utils";
import { SummarySection } from "./summary-section";

afterEach(cleanup);
const card = (title: string) => screen.getByRole("heading", { level: 3, name: title }).closest("article") as HTMLElement;
const query = (link: HTMLElement) => Object.fromEntries(new URL(link.getAttribute("href")!, "https://app.test").searchParams);

describe("Resumen (artboard 09)", () => {
  it("shows the hero in-process figure with its delta, sparkline and published context", () => {
    render(<SummarySection state={ready(summary())} window={30} drill={drillFor(30)} />);
    const hero = card("Candidatos en proceso");
    expect(within(hero).getByText("143")).toBeInTheDocument();
    expect(within(hero).getByText("+18")).toBeInTheDocument();
    expect(within(hero).getByText("vs hace 30 días")).toBeInTheDocument();
    expect(within(hero).getByRole("img", { name: /Candidatos en proceso por día: de 125 el 9 oct a 143 hoy/ })).toBeInTheDocument();
    expect(hero).toHaveTextContent("En 28 vacantes publicadas");
    // `.pf-kpi-hero` (globals.css) keeps the inverted tile dark in dark mode instead of a near-white block.
    expect(hero).toHaveClass("pf-kpi-hero");
  });

  it("shows published vacancies, pool additions and covered positions with their bar", () => {
    render(<SummarySection state={ready(summary())} window={30} drill={drillFor(30)} />);
    expect(within(card("Vacantes publicadas")).getByText("+3")).toBeInTheDocument();
    const pool = card("Nuevos en la base");
    expect(within(pool).getByText("96")).toBeInTheDocument();
    expect(within(pool).getByText("vs 30 días anteriores")).toBeInTheDocument();
    const positions = card("Posiciones cubiertas");
    expect(positions).toHaveTextContent("19de 64 posiciones");
    expect(within(positions).getByRole("group", { name: "Posiciones de las vacantes publicadas: 19 cubiertas, 45 por cubrir" })).toBeInTheDocument();
    expect(positions).toHaveTextContent("Cubiertas 19 · 30%");
    expect(positions).toHaveTextContent("Por cubrir 45 · 70%");
  });

  it("hides «Nuevos en la base» without talent-base access, as the current dashboard does", () => {
    render(<SummarySection state={ready(summary(30, { pool_added: null }))} window={30} drill={drillFor(30)} />);
    expect(screen.queryByRole("heading", { name: "Nuevos en la base" })).toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(3);
  });

  it("links every figure by default with an accessible name, and keeps them as plain text when the lists are switched off", () => {
    const { unmount } = render(<SummarySection state={ready(summary())} window={30} drill={drillFor(30, false)} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    unmount();
    render(<SummarySection state={ready(summary())} window={30} drill={drillFor(30)} />);
    expect(query(screen.getByRole("link", { name: "Ver los 143 candidatos en proceso" }))).toEqual({ kind: "candidates", window: "30", in_process: "true" });
    expect(query(screen.getByRole("link", { name: "Ver las 28 vacantes publicadas" }))).toEqual({ kind: "vacancies", window: "30", status: "published" });
    expect(screen.getByRole("link", { name: "Ver los 96 perfiles agregados a la base" })).toHaveAttribute("href", "/empresa/talento?added_from=2026-10-10&added_to=2026-11-08");
  });

  it("puts each figure in the tab order once: the repeated published and covered figures stay clickable but are not a second tab stop", () => {
    render(<SummarySection state={ready(summary())} window={30} drill={drillFor(30)} />);
    expect(screen.getAllByRole("link", { name: "Ver las 28 vacantes publicadas" })).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: "Ver las 19 posiciones cubiertas" })).toHaveLength(1);
    const repeats = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].filter(link => link.getAttribute("tabindex") === "-1");
    expect(repeats.map(link => link.textContent)).toEqual(["28 vacantes", "19"]);
    for (const link of repeats) expect(link).toHaveAttribute("aria-hidden", "true");
  });

  it("says «Sin posiciones definidas» instead of inventing a ratio, and «Sin cambio» for a flat delta", () => {
    render(<SummarySection state={ready(summary(7, { positions: { covered: 0, required: 0 }, published_vacancies: { current: 4, previous: 4 } }))} window={7} drill={drillFor(7)} />);
    expect(card("Posiciones cubiertas")).toHaveTextContent("Sin posiciones definidas");
    expect(within(card("Vacantes publicadas")).getByText("Sin cambio")).toBeInTheDocument();
    expect(within(card("Vacantes publicadas")).getByText("vs hace 7 días")).toBeInTheDocument();
  });

  it("keeps the explanation behind «Cómo se calcula»", async () => {
    render(<SummarySection state={ready(summary())} window={30} drill={drillFor(30)} />);
    expect(screen.queryByText(/sin contar Nuevos ni Placement/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Cómo se calcula: Resumen" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(/sin contar Nuevos ni Placement/);
  });

  it("has a skeleton of its shape and a retry on failure", async () => {
    const { unmount } = render(<SummarySection state={loading()} window={30} drill={drillFor(30)} />);
    expect(screen.getByRole("status", { name: "Cargando resumen" })).toBeInTheDocument();
    unmount();
    const state = failed();
    render(<SummarySection state={state} window={30} drill={drillFor(30)} />);
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(state.retry).toHaveBeenCalled();
  });
});
