import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LocalDraftForm } from "./local-draft-form";
import { createDraftModel } from "../model";

vi.mock("../actions", () => ({ saveDraftV2Action: vi.fn() }));
vi.mock("../pipeline/publication-actions", () => ({ loadDraftPublicationAction: vi.fn(), publishDraftAction: vi.fn() }));
vi.mock("../requesters/actions", () => ({ searchRequestersAction: vi.fn(async () => ({ ok: true, items: [], nextCursor: null })), createRequesterAction: vi.fn() }));
vi.mock("@/features/geo/use-geo-catalog", () => ({ useGeoCatalog: () => ({ countries: { status: "success", data: { items: [] } }, states: { status: "success", data: { items: [] } }, municipalities: { status: "success", data: { items: [] } } }), useGeoPostalCode: () => ({ status: "idle" }) }));
afterEach(cleanup);
const sections = [
  ["Información básica", ["El puesto que estás buscando", "¿Dónde trabajará?", "Solicitante"]],
  ["Descripción y perfil", ["Cuéntales sobre la oportunidad", "Habilidades e idiomas"]],
  ["Compensación y beneficios", ["Una oferta clara desde el inicio", "Más que un sueldo"]],
  ["Preguntas de filtro", ["Conoce mejor a quienes se postulan"]],
] as const;

it.each(sections)("composes %s as topic Cards, not nested section cards", (section, titles) => {
  render(<LocalDraftForm />);
  fireEvent.click(within(screen.getByRole("tablist", { name: "Secciones de la vacante" })).getByRole("tab", { name: section }));
  const panel = document.querySelector('[data-pf-draft-step]:not([hidden])')!;
  expect(panel.querySelectorAll('[data-slot="card"]')).toHaveLength(titles.length);
  for (const title of titles) {
    const heading = within(panel as HTMLElement).getByRole("heading", { name: title, level: 3 });
    const card = heading.closest('[data-slot="card"]')!;
    expect(heading.parentElement).toHaveAttribute("data-slot", "card-title");
    expect(card.querySelector('[data-slot="card-header"] [data-slot="card-description"]')).not.toBeEmptyDOMElement();
    expect(card.querySelector('[data-slot="card-content"]')).not.toBeNull();
    expect(card.parentElement?.closest('[data-slot="card"]')).toBeNull();
  }
  const footnote = screen.getByText("Necesario para publicar, no para guardar tu borrador.");
  expect(footnote).toBeVisible();
  expect(footnote).toHaveTextContent("* Necesario para publicar, no para guardar tu borrador.");
});

it("marks publishing requirements without making draft saving require values", () => {
  render(<LocalDraftForm initialModel={createDraftModel()} />);
  for (const id of ["draft-title", "draft-professional-area", "draft-work-schedule", "draft-contract-type", "draft-work-mode"]) {
    const control = document.getElementById(id)!;
    expect(control.closest('[data-slot="field"]')?.querySelector('[data-pf-publication-required]')).not.toBeNull();
    expect(control).not.toHaveAttribute("required");
  }
  expect(document.getElementById("draft-seniority")!.closest('[data-slot="field"]')?.querySelector('[data-pf-publication-required]')).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Validar borrador" }));
  expect(screen.getByRole("status")).toHaveTextContent("Borrador local válido");
});

it.each(["onsite", "remote"] as const)("shows only the appropriate geography requirements for %s", workMode => {
  const model = createDraftModel();
  model.fields.work_mode = workMode;
  model.fields.location = { country: "MX" };
  render(<LocalDraftForm initialModel={model} />);
  const location = screen.getByRole("region", { name: "Ubicación" });
  expect(location.querySelectorAll('[data-pf-publication-required]')).toHaveLength(workMode === "remote" ? 0 : 3);
  const remote = document.getElementById("draft-remote-scope");
  if (workMode === "remote") expect(remote?.querySelector('[data-pf-publication-required]')).not.toBeNull();
  else expect(remote).toBeNull();
});

it("uses the v0 questionnaire empty anatomy and preserves adding a question", () => {
  render(<LocalDraftForm />);
  fireEvent.click(screen.getByRole("tab", { name: "Preguntas de filtro" }));
  const empty = screen.getByText("La conversación empieza aquí").closest('[data-slot="empty"]')!;
  expect(empty.querySelector('[data-slot="empty-header"] [data-slot="empty-icon"]')).not.toBeNull();
  fireEvent.click(within(empty as HTMLElement).getByRole("button", { name: "Agregar pregunta" }));
  const question = screen.getByRole("textbox", { name: "Pregunta 1" });
  expect(question).toBeVisible();
  expect(screen.getByRole("button", { name: "Probar cuestionario" })).toBeDisabled();
  fireEvent.change(question, { target: { value: "¿Qué proyecto te enorgullece más?" } });
  fireEvent.click(screen.getByRole("button", { name: "Probar cuestionario" }));
  expect(screen.getByRole("dialog", { name: "Probar cuestionario" })).toBeVisible();
});

it("orders the basic fields and puts the rich editor before requirements", () => {
  render(<LocalDraftForm />);
  const position = screen.getByRole("heading", { name: "El puesto que estás buscando" }).closest('[data-slot="card"]')!;
  expect([...position.querySelectorAll('input:not([aria-hidden]), [data-slot="select-trigger"]')].filter(node => node.id.startsWith("draft-")).map(node => node.id)).toEqual(["draft-title", "draft-professional-area", "draft-seniority", "draft-work-schedule", "draft-contract-type"]);
  fireEvent.click(screen.getByRole("tab", { name: "Descripción y perfil" }));
  expect(document.getElementById("draft-description")!.compareDocumentPosition(document.getElementById("draft-required-requirements")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(document.querySelector('[data-pf-description-frame] [role="toolbar"]')).not.toBeNull();
});
