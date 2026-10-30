import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { COMPETENCY_IDS, type Profile } from "../model";
import { saveProfileAction } from "../actions";
import { ProfileEditor } from "./editor";
vi.mock("../actions", () => ({ loadProfileAction: vi.fn(), saveProfileAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
const profile = (): Profile => ({ version: "1", enabled: false, confirmed: true, confirmed_at: "2026-10-29T12:00:00Z", test: "ipip60-mx", competencies: COMPETENCY_IDS.map((competency_id, i) => ({ competency_id, importance: i === 0 ? "importance.clave" : i === 1 ? "importance.importante" : "importance.no_relevante", desired_band: i < 2 ? "band.medium" : null, rationale: i < 2 ? "Trabajo concreto" : null, task: i === 0 ? "Cerrar entregas" : null })), auto_send_stage_ids: [], expires_in_days: 7 });
const mount = (data = profile()) => render(<ProfileEditor draftId="vacancy" profile={data} etag={'"pp1"'} stages={[]} />);
const row = (name: string) => within(screen.getByRole("list", { name: "Seleccionar competencia" })).getByRole("button", { name: new RegExp(name) });
beforeEach(() => vi.stubGlobal("PointerEvent", MouseEvent));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
it("uses aligned active items with keyboard-only focus and explicit hover states", () => {
  mount();
  const first = row("Orden para avanzar");
  const second = row("Cuidado de acuerdos");
  for (const item of [first, second]) {
    expect(item).toHaveClass("rounded-2xl", "px-3", "py-3", "outline-none", "transition-colors", "hover:bg-muted", "hover:text-foreground", "focus-visible:ring-3", "focus-visible:ring-ring/30");
    expect(item).not.toHaveAttribute("data-slot", "button");
  }
  expect(first).toHaveAttribute("aria-pressed", "true");
  expect(first).toHaveClass("bg-card", "text-foreground", "shadow-sm", "ring-1", "ring-primary/40");
  expect(second).toHaveClass("text-muted-foreground");
  fireEvent.click(second);
  expect(second).toHaveAttribute("aria-pressed", "true");
  expect(second).toHaveClass("bg-card", "text-foreground", "shadow-sm", "ring-1", "ring-primary/40");
  expect(first).toHaveAttribute("aria-pressed", "false");
  expect(first).not.toHaveClass("ring-1");
  expect(saveProfileAction).not.toHaveBeenCalled();
});
it("selects a competency without losing the previous detail's captured input", () => {
  mount(); fireEvent.change(screen.getByRole("textbox", { name: /Tarea concreta de Orden/ }), { target: { value: "Planificar entregas" } });
  fireEvent.click(row("Cuidado de acuerdos"));
  expect(row("Cuidado de acuerdos")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("heading", { name: "Cuidado de acuerdos" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: /Justificación laboral de Cuidado/ })).toHaveValue("Trabajo concreto");
  expect(screen.queryByRole("textbox", { name: /Tarea concreta/ })).not.toBeInTheDocument();
  expect(screen.getByText("2 / 7")).toBeVisible();
  fireEvent.click(row("Orden para avanzar"));
  expect(screen.getByRole("textbox", { name: /Tarea concreta de Orden/ })).toHaveValue("Planificar entregas");
  expect(saveProfileAction).not.toHaveBeenCalled();
});
it("clears irrelevant detail and disables all desired band choices", () => {
  mount(); fireEvent.click(screen.getByRole("button", { name: "No relevante" }));
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  for (const name of ["Bajo", "Medio", "Alto"]) expect(screen.getByRole("button", { name })).toBeDisabled();
  expect(screen.getByText("Sin banda", { selector: "p" })).toBeVisible();
  expect(row("Orden para avanzar")).toHaveTextContent("—");
  expect(screen.getByText("Perfil sin confirmar")).toBeVisible();
  expect(saveProfileAction).not.toHaveBeenCalled();
});
it("shows complete, missing and irrelevant indicators with an actionable sticky summary", () => {
  const data = profile(); data.competencies[1].rationale = ""; mount(data);
  expect(row("Orden para avanzar")).toHaveTextContent("✓");
  expect(row("Cuidado de acuerdos")).toHaveTextContent("Pendiente");
  expect(row("Impulso para coordinar")).toHaveTextContent("—");
  const bar = screen.getByRole("region", { name: "Guardar y confirmar" });
  expect(bar).toHaveClass("sticky");
  expect(within(bar).getByText("Falta la justificación de Cuidado de acuerdos")).toBeVisible();
  expect(within(bar).getAllByTestId("completeness-segment")).toHaveLength(2);
  fireEvent.click(row("Cuidado de acuerdos"));
  fireEvent.change(screen.getByRole("textbox", { name: /Justificación laboral de Cuidado/ }), { target: { value: "Cuidar entregas" } });
  expect(within(bar).getByText("Perfil completo")).toBeVisible();
});
it("confirm selects the first invalid competency and focuses its first missing field without writing", async () => {
  const data = profile(); data.competencies[1].rationale = ""; mount(data);
  fireEvent.click(row("Manejo de la presión")); fireEvent.click(screen.getByRole("button", { name: "Confirmar perfil" }));
  await waitFor(() => expect(screen.getByRole("textbox", { name: /Justificación laboral de Cuidado/ })).toHaveFocus());
  expect(row("Cuidado de acuerdos")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("textbox", { name: /Justificación laboral de Cuidado/ })).toHaveAccessibleDescription("Justifica esta competencia en 1 a 1000 caracteres");
  expect(row("Cuidado de acuerdos")).toHaveTextContent("Pendiente");
  expect(screen.getByRole("textbox", { name: /Justificación laboral de Cuidado/ })).toHaveValue("");
  expect(saveProfileAction).not.toHaveBeenCalled();
});
it("keeps the dated confirmation for general settings, but invalidates it for requirements", () => {
  mount(); expect(screen.getByText("Perfil confirmado · 29 oct 2026")).toBeVisible();
  fireEvent.click(screen.getByRole("switch"));
  expect(screen.getByText("Perfil confirmado · 29 oct 2026")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Alto" }));
  expect(screen.getByText("Perfil sin confirmar")).toBeVisible();
  expect(screen.queryByText(/Perfil confirmado ·/)).not.toBeInTheDocument();
  expect(saveProfileAction).not.toHaveBeenCalled();
});
