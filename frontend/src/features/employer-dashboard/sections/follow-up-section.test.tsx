import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/components/ui/popover", async () => (await import("../test-utils")).popoverMock());
import { drillFor } from "../drilldown";
import { attention, emptyAttention, pipeline, secondVacancyId, vacancyId } from "../test-fixtures";
import { failed, loading, ready } from "../test-utils";
import { FollowUpSection } from "./follow-up-section";

afterEach(cleanup);
const today = "2026-11-08";
const show = (overrides: Partial<Parameters<typeof FollowUpSection>[0]> = {}) =>
  render(<FollowUpSection attention={ready(attention())} pipeline={ready(pipeline())} drill={drillFor(30)} today={today} {...overrides} />);
const query = (link: HTMLElement) => Object.fromEntries(new URL(link.getAttribute("href")!, "https://app.test").searchParams);

describe("Necesita atención (artboard 09, rule 13)", () => {
  it("opens on overdue deliveries, each row naming the consequence and opening the vacancy board", () => {
    show();
    expect(screen.getByRole("region", { name: "Seguimiento" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Entregas vencidas\s*6/ })).toHaveAttribute("aria-selected", "true");
    const row = screen.getByRole("link", { name: "Abrir el pipeline de Ejecutivo de cuenta: entrega vencida hace 6 días hábiles, faltan 3 de 5 candidatos" });
    expect(row).toHaveAttribute("href", `/empresa/vacantes/${vacancyId}/pipeline`);
    expect(row).toHaveTextContent("Banorte · Andrés Castillo");
    expect(row).toHaveTextContent("Faltan 3 de 5 candidatos");
    expect(row).toHaveTextContent("Venció hace 6 días hábiles");
    expect(screen.getByRole("link", { name: /Jefe de mantenimiento/ })).toHaveAttribute("href", `/empresa/vacantes/${secondVacancyId}/pipeline`);
    expect(screen.getByText("Sin solicitante · Sin responsable")).toBeInTheDocument();
  });

  it("switches tabs by click and arrow keys: due this week and stalled candidates", async () => {
    show();
    await userEvent.click(screen.getByRole("tab", { name: /Vencen esta semana/ }));
    expect(screen.getByRole("link", { name: /Analista de crédito Sr\.: entrega vence hoy, faltan 2 de 4 candidatos/ })).toHaveTextContent("Vence hoy");
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /Candidatos detenidos\s*14/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Candidatos detenidos/ })).toHaveFocus();
    const row = screen.getByRole("link", { name: "Abrir el pipeline de Desarrollador backend Go: Héctor Salinas lleva 12 días sin avanzar en Evaluación" });
    expect(row).toHaveTextContent("12 días sin avanzar");
    expect(within(row).getByText("Evaluación")).toHaveClass("stage-badge", "stage-process");
  });

  it("jumps to the first and last tab with Home and End", async () => {
    show();
    await userEvent.click(screen.getByRole("tab", { name: /Entregas vencidas/ }));
    await userEvent.keyboard("{End}");
    expect(screen.getByRole("tab", { name: /Candidatos detenidos/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Candidatos detenidos/ })).toHaveFocus();
    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: /Entregas vencidas/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Entregas vencidas/ })).toHaveFocus();
  });

  it("wraps the tabs onto a second line on a narrow screen instead of scrolling or clipping them (rule 14)", () => {
    show();
    const tabs = screen.getByRole("tablist", { name: "Tipo de pendiente" });
    expect(tabs).toHaveClass("flex-wrap");
    expect(tabs).not.toHaveClass("overflow-x-auto");
  });

  it("keeps the consequence and the badge in each row on a narrow screen, stacked under the name (rule 14)", async () => {
    show();
    const row = screen.getByRole("link", { name: /^Abrir el pipeline de Ejecutivo de cuenta/ });
    expect(within(row).getByText("Faltan 3 de 5 candidatos")).not.toHaveClass("hidden");
    expect(within(row).getByText("Venció hace 6 días hábiles")).not.toHaveClass("hidden");
    await userEvent.click(screen.getByRole("tab", { name: /Candidatos detenidos/ }));
    expect(within(screen.getByRole("link", { name: /Héctor Salinas/ })).getByText("12 días sin avanzar")).not.toHaveClass("hidden");
  });

  it("starts on the first tab with rows and shows «Todo al día» for an empty one", async () => {
    show({ attention: ready({ ...emptyAttention(), stalled: attention().stalled }) });
    expect(screen.getByRole("tab", { name: /Candidatos detenidos/ })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: /Entregas vencidas/ }));
    expect(screen.getByRole("heading", { name: "Todo al día" })).toBeInTheDocument();
  });

  it("links the «Ver …» foot by default, and not when the lists are switched off", () => {
    const { unmount } = show({ drill: drillFor(30, false) });
    expect(screen.queryByRole("link", { name: /Ver las 6 entregas vencidas/ })).toBeNull();
    unmount();
    show();
    expect(query(screen.getByRole("link", { name: "Ver las 6 entregas vencidas" }))).toEqual({ kind: "deliveries", window: "30", state: "overdue" });
  });

  it("says in the help that overdue days are business days", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: "Cómo se calcula: Seguimiento" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(/días hábiles/);
  });
});

describe("Pipeline por etapa", () => {
  it("lists every stage with its count, stalled people and «Al día»", () => {
    show();
    const stages = screen.getByRole("heading", { level: 3, name: "Pipeline por etapa" }).closest("article") as HTMLElement;
    expect(stages).toHaveTextContent("Hoy · 143 candidatos");
    expect(within(stages).getByText("Nuevos")).toBeInTheDocument();
    expect(within(stages).getByText("7 detenidos")).toHaveClass("text-status-danger");
    for (const quiet of within(stages).getAllByText("2 detenidos")) expect(quiet).toHaveClass("text-muted-foreground");
    expect(within(stages).getByText("No aplica")).toBeInTheDocument();
    expect(within(stages).getAllByText("Al día").length).toBeGreaterThan(0);
  });

  it("opens the stage lists when on", () => {
    show({ drill: drillFor(30, true) });
    expect(query(screen.getByRole("link", { name: "Ver los 7 candidatos detenidos en En proceso" }))).toEqual({ kind: "candidates", window: "30", stage_kind: "in_process", stalled: "true" });
    expect(query(screen.getByRole("link", { name: "Ver los 48 candidatos en Nuevos" }))).toEqual({ kind: "candidates", window: "30", stage_kind: "new" });
  });
});

describe("states", () => {
  it("loads and fails each card on its own", async () => {
    const state = failed();
    show({ attention: loading(), pipeline: state });
    expect(screen.getByRole("status", { name: "Cargando necesita atención" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(state.retry).toHaveBeenCalled();
  });

  it("dims stale numbers while the new answer arrives", () => {
    show({ pipeline: ready(pipeline(), true) });
    expect(screen.getByRole("heading", { level: 3, name: "Pipeline por etapa" }).closest("[data-stale]")).toHaveAttribute("data-stale", "true");
  });
});
