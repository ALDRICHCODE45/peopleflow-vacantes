import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/components/ui/popover", async () => (await import("../test-utils")).popoverMock());
import { drillFor } from "../drilldown";
import { recent, vacancies, vacancyId } from "../test-fixtures";
import { ready } from "../test-utils";
import { VacanciesSection } from "./vacancies-section";

afterEach(cleanup);
const now = new Date("2026-11-08T20:00:00Z");
const show = (overrides: Partial<Parameters<typeof VacanciesSection>[0]> = {}) =>
  render(<VacanciesSection vacancies={ready(vacancies())} recent={ready(recent())} drill={drillFor(30)} now={now} {...overrides} />);
const card = (title: string) => screen.getByRole("heading", { level: 3, name: title }).closest("article") as HTMLElement;

describe("Vacantes activas", () => {
  it("links each title to its board with the requester, the in-process bar and positions", () => {
    show();
    const active = card("Vacantes activas");
    expect(within(active).getByRole("link", { name: "Abrir el pipeline de Analista de crédito Sr." })).toHaveAttribute("href", `/empresa/vacantes/${vacancyId}/pipeline`);
    const first = within(active).getAllByRole("listitem")[0];
    expect(first).toHaveTextContent("Banorte · Andrés Castillo");
    expect(first).toHaveTextContent("14");
    expect(first).toHaveTextContent("1 de 3");
    const second = within(active).getAllByRole("listitem")[1];
    expect(second).toHaveTextContent("Área sin especificar · Sin responsable");
    expect(second).toHaveTextContent("Sin definir");
    expect(within(active).getByRole("link", { name: "Ver todas las vacantes" })).toHaveAttribute("href", "/empresa/vacantes");
  });

  it("opens a vacancy's in-process candidates when the lists are on", () => {
    show({ drill: drillFor(30, true) });
    const href = screen.getByRole("link", { name: "Ver los 14 candidatos en proceso de Analista de crédito Sr." }).getAttribute("href")!;
    expect(Object.fromEntries(new URL(href, "https://app.test").searchParams)).toEqual({ kind: "candidates", window: "30", vacancy_id: vacancyId, in_process: "true" });
  });

  it("stacks each vacancy as a list row on a narrow screen: the whole title, the in-process figure and a chevron (rule 14)", () => {
    show({ drill: drillFor(30, true) });
    const active = card("Vacantes activas");
    const first = within(active).getAllByRole("listitem")[0];
    const title = within(first).getByRole("link", { name: "Abrir el pipeline de Analista de crédito Sr." });
    // The title wraps instead of being cut, and its link covers the row so the chevron opens it too.
    expect(title).toHaveClass("max-sm:whitespace-normal", "max-sm:break-words", "max-sm:after:absolute", "max-sm:after:inset-0");
    expect(first).toHaveClass("relative");
    expect(within(first).getByText("en proceso")).toHaveClass("sm:hidden");
    expect(within(first).getByText("de 3", { exact: false }).closest("span")).toHaveClass("max-sm:hidden");
    expect(first.querySelector("svg[aria-hidden='true'].lucide-chevron-right")).toHaveClass("sm:hidden");
    // The figure stays its own link above the row's.
    expect(within(first).getByRole("link", { name: "Ver los 14 candidatos en proceso de Analista de crédito Sr." })).toHaveClass("relative", "z-10");
    expect(active.querySelector("[aria-hidden='true'].text-xs")).toHaveClass("max-sm:hidden");
  });

  it("keeps the current first-visit copy when there are no published vacancies", () => {
    show({ vacancies: ready(vacancies({ top: [] })) });
    expect(screen.getByRole("heading", { name: "Todavía no hay vacantes activas" })).toBeInTheDocument();
  });
});

describe("Candidatos recientes", () => {
  it("shows one stage badge style, the source or who added them, and a relative date; names open the board", () => {
    show();
    const list = card("Candidatos recientes");
    const ana = within(list).getByRole("link", { name: "Ana Real" });
    expect(ana).toHaveAttribute("href", `/empresa/vacantes/${vacancyId}/pipeline`);
    const [first, second] = within(list).getAllByRole("listitem");
    expect(first).toHaveTextContent("Plataforma real · Postulación");
    expect(first).toHaveTextContent("Hoy, 9:18");
    expect(within(first).getByText("Entrevista")).toHaveClass("stage-badge", "stage-process");
    expect(second).toHaveTextContent("Agregado por María Equipo");
    expect(second).toHaveTextContent("Ayer, 18:05");
    expect(within(second).getByText("Screening")).toHaveClass("stage-badge", "stage-neutral");
  });

  it("shows the snapshot title next to the name, and nothing when it is null (T13)", () => {
    show();
    const [first, second] = within(card("Candidatos recientes")).getAllByRole("listitem");
    expect(within(first).getByText("Ingeniera")).toHaveAttribute("data-candidate-title");
    expect(within(first).getByText("Ingeniera")).toHaveClass("truncate", "text-muted-foreground");
    expect(second.querySelector("[data-candidate-title]")).toBeNull();
  });

  it("has its own empty state", () => {
    show({ recent: ready(recent({ recent: [] })) });
    expect(screen.getByRole("heading", { name: "Sin candidatos" })).toBeInTheDocument();
  });
});
