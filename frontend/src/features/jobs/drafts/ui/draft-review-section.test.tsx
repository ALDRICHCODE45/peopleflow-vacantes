import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LocalDraftForm } from "./local-draft-form";
import { createDraftModel } from "../model";
import { loadDraftPublicationAction } from "../pipeline/publication-actions";

vi.mock("../actions", () => ({ saveDraftV2Action: vi.fn() }));
vi.mock("../pipeline/publication-actions", () => ({ loadDraftPublicationAction: vi.fn(async () => ({ ok: true, publication: { status: "draft", missing: ["delivery_target_missing"] } })), publishDraftAction: vi.fn() }));
vi.mock("../requesters/actions", () => ({ searchRequestersAction: vi.fn(async () => ({ ok: true, items: [], nextCursor: null })), createRequesterAction: vi.fn() }));
vi.mock("@/features/geo/use-geo-catalog", () => ({ useGeoCatalog: () => ({ countries: { status: "success", data: { items: [] } }, states: { status: "success", data: { items: [] } }, municipalities: { status: "success", data: { items: [] } } }), useGeoPostalCode: () => ({ status: "idle" }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function review() { fireEvent.click(screen.getByRole("tab", { name: "Revisión y publicación" })); }

it.each(["Modalidad", "Jornada", "Tipo de contrato", "Área profesional", "Solicitante"])("focuses the %s control from its pending row", (label) => {
  render(<LocalDraftForm />); review();
  fireEvent.click(screen.getByRole("button", { name: `Completar ${label}` }));
  expect(screen.getByRole("combobox", { name: label === "Solicitante" ? "Área o cliente" : label })).toHaveFocus();
});

it.each([false, true])("focuses the missing Mexican subdivision (state present: %s)", hasState => {
  const model = createDraftModel();
  model.fields.work_mode = "onsite";
  model.fields.location = { country: "MX", ...(hasState ? { state: "09" } : {}) };
  render(<LocalDraftForm initialModel={model} />); review();
  fireEvent.click(screen.getByRole("button", { name: "Completar Completa estado y municipio." }));
  expect(screen.getByRole("combobox", { name: hasState ? "Municipio" : "Estado" })).toHaveFocus();
});

it("focuses the countries input when remote scope has no countries", () => {
  const model = createDraftModel();
  model.fields.work_mode = "remote";
  model.fields.remote_scope = { kind: "countries", countries: [] };
  render(<LocalDraftForm initialModel={model} />); review();
  fireEvent.click(screen.getByRole("button", { name: "Completar Indica desde dónde pueden postular." }));
  expect(document.getElementById("draft-remote-countries")).toHaveFocus();
});

it("shows unknown configuration honestly before the first save and routes title/description to focused fields", () => {
  render(<LocalDraftForm />); review();
  expect(screen.getByText("La lista de solicitud y entrega aparece después del primer guardado.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Configurar solicitud y entrega" })).toBeDisabled();
  expect(screen.queryByText("Completa")).toBeNull();
  const title = screen.getByRole("button", { name: "Completar Título" });
  expect(title.closest('[data-slot="item-actions"]')?.closest('[data-slot="item-group"]')).not.toBeNull();
  expect(title.closest('[data-slot="item-group"]')?.querySelector('[data-slot="item-separator"]')).not.toBeNull();
  fireEvent.click(title);
  expect(screen.getByRole("textbox", { name: "Título" })).toHaveFocus();
  review(); fireEvent.click(screen.getByRole("button", { name: "Completar Descripción" }));
  expect(document.getElementById("draft-description-content")).toHaveFocus();
});

it("renders known completed groups and pending configuration links without invented values", async () => {
  render(<LocalDraftForm initialIdentity={{ draftId: "draft-id", etag: '"v1"' }} />); review();
  const request = screen.getByRole("region", { name: "Configuración de solicitud" });
  expect(await within(request).findByText("Completa")).toBeVisible();
  expect(screen.getByRole("link", { name: "Completar Objetivo de entrega" })).toHaveAttribute("href", "/empresa/vacantes/draft-id/configuracion/entrega");
  expect(screen.getByRole("link", { name: "Configurar solicitud y entrega" })).toHaveAttribute("href", "/empresa/vacantes/draft-id/configuracion/solicitud");
  for (const name of ["Completar Objetivo de entrega", "Configurar solicitud y entrega"]) {
    expect(screen.getByRole("link", { name })).not.toHaveAttribute("role");
    expect(screen.getByRole("link", { name }).tagName).toBe("A");
  }
});

it("reviews internal values, opens safe public preview, and reuses simulation", () => {
  const model = createDraftModel();
  model.fields.requester = { kind: "internal_area", id: "req-id" };
  model.fields.compensation = { mode: "range", amount: null, min: "35000", max: "45000", currency: "MXN", pay_period: "monthly", basis: "gross", public_visible: false };
  render(<LocalDraftForm initialModel={model} initialScreeningQuestionsV2={[]} />); review();
  const internal = screen.getByRole("region", { name: "Revisión interna" });
  expect(within(internal).getByText("0 preguntas")).toBeVisible();
  expect(within(internal).getByText(/35,000.*45,000.*MXN/)).toBeVisible();
  expect(internal).not.toHaveTextContent("req-id");
  fireEvent.click(screen.getByRole("button", { name: "Revisar y probar" }));
  expect(screen.getByRole("dialog", { name: "Probar cuestionario" })).toBeVisible();
});

it("does not claim configuration complete when the readiness read fails", async () => {
  vi.mocked(loadDraftPublicationAction).mockRejectedValueOnce(new Error("unavailable"));
  render(<LocalDraftForm initialIdentity={{ draftId: "draft-id", etag: '"v1"' }} />); review();
  expect(await screen.findByText(/Aún no pudimos comprobar solicitud y entrega/)).toBeVisible();
  expect(within(screen.getByRole("region", { name: "Configuración de solicitud" })).queryByText("Completa")).toBeNull();
  expect(within(screen.getByRole("region", { name: "Configuración de entrega" })).queryByText("Completa")).toBeNull();
});

it("shows a known internal zero without inventing missing currency or cadence", () => {
  const model = createDraftModel();
  model.fields.compensation = { mode: "fixed", amount: "0", min: null, max: null, currency: null, pay_period: null, basis: null, public_visible: false };
  render(<LocalDraftForm initialModel={model} />); review();
  const internal = screen.getByRole("region", { name: "Revisión interna" });
  expect(internal).toHaveTextContent("$0 · Moneda sin definir");
  expect(internal).toHaveTextContent("Periodicidad sin definir · Neto/bruto sin definir");
});

it("does not format malformed money as a valid internal amount", () => {
  const model = createDraftModel();
  model.fields.compensation = { mode: "fixed", amount: "1e3", min: null, max: null, currency: "USD", pay_period: "monthly", basis: "net", public_visible: false };
  render(<LocalDraftForm initialModel={model} />); review();
  expect(within(screen.getByRole("region", { name: "Revisión interna" })).getByText("Compensación por revisar")).toBeVisible();
});

it("opens the full public preview from review without internal information", () => {
  const model = createDraftModel();
  model.requesterName = "Equipo privado";
  model.fields.compensation = { mode: "fixed", amount: "35000", min: null, max: null, currency: "MXN", pay_period: "monthly", basis: "gross", public_visible: false };
  render(<LocalDraftForm initialModel={model} />); review();
  fireEvent.click(screen.getByRole("button", { name: "Revisar vista previa pública" }));
  const preview = screen.getByRole("dialog", { name: "Vista previa pública" });
  expect(preview).toBeVisible();
  expect(within(preview).queryByText("Revisión interna")).toBeNull();
  expect(preview).not.toHaveTextContent("Equipo privado");
  expect(preview).not.toHaveTextContent("35,000");
  expect(preview).toHaveTextContent("Salario no publicado");
});

it("keeps the existing dirty publication guard for the review CTA", async () => {
  render(<LocalDraftForm initialIdentity={{ draftId: "draft-id", etag: '"v1"' }} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Título" }), { target: { value: "Cambio" } }); review();
  fireEvent.click(screen.getByRole("button", { name: "Revisar y publicar" }));
  expect(await screen.findByRole("dialog", { name: "Guarda los cambios antes de publicar" })).toBeVisible();
  expect(loadDraftPublicationAction).toHaveBeenCalledTimes(1);
});
