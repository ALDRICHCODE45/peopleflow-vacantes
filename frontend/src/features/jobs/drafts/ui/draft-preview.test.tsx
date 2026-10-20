import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { createDraftModel } from "../model";
import { initialDraftFormState } from "./draft-form-state";
import { DraftPublicDetail, draftToPublicDetail } from "./draft-public-detail";
import { internalCompensationView } from "./draft-preview";

vi.mock("@/features/geo/use-geo-catalog", () => ({ useGeoCatalog: () => ({ countries: { data: { items: [{ id: "MX", name: "México" }] } }, states: { data: { items: [] } }, municipalities: { data: { items: [] } } }) }));
afterEach(cleanup);
const emptyState = () => initialDraftFormState(createDraftModel());

it("maps raw public fields without mutating state or inventing company, publication or applicants", () => {
  const state = emptyState();
  Object.assign(state, { title: "Arquitecto de Software", work_mode: "hybrid", work_schedule: "full_time", contract_type: "indefinite", professional_area: "technology_systems", seniority: "senior", locationLabel: "Ciudad de México", required_requirements: "Go y PostgreSQL", preferred_requirements: "Kubernetes", skills: [{ id: "1", value: "Go" }, { id: "2", value: " " }], benefits: ["health_insurance"], custom_benefits: [{ id: "1", value: "Café gratis" }], description: { schema_version: 1, document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Buscamos talento" }] }] } } });
  state.requester.name = "Cliente privado";
  const before = structuredClone(state);
  const job = draftToPublicDetail(state);
  expect(job).toMatchObject({ title: state.title, work_mode: "hybrid", work_schedule: "full_time", contract_type: "indefinite", professional_area: "technology_systems", seniority: "senior", location_label: "Ciudad de México", requirements: { required: "Go y PostgreSQL", preferred: "Kubernetes" }, skills: ["Go"], benefits: { predefined: ["health_insurance"], custom: ["Café gratis"] }, description_plain: "Buscamos talento", published_at: null, applicants: null, screening_questions: null, company: null });
  expect(JSON.stringify(job)).not.toContain("Cliente privado");
  const { container } = render(<DraftPublicDetail state={state} />);
  expect(container.querySelector('[data-slot="public-job-detail"]')).toBeInTheDocument();
  expect(container.querySelector('[data-slot="card"]')).toBeNull();
  for (const name of ["Arquitecto de Software", "La vacante de un vistazo", "Sobre la vacante", "Lo que buscamos", "Habilidades", "Beneficios para ti"]) expect(screen.getByRole("heading", { name })).toBeVisible();
  expect(screen.getByText("Buscamos talento")).toBeVisible();
  expect(screen.getByRole("button", { name: "Disponible al publicar" })).toBeDisabled();
  expect(screen.queryByRole("link", { name: "Postularme" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Compartir/ })).toBeNull();
  expect(container).not.toHaveTextContent("Publicada el");
  expect(state).toEqual(before);
});

it("passes supplied public company identity through the adapter without placeholder data", () => {
  const state = emptyState();
  const company = { id: "real-company", name: "Acme Talento", logo_url: "https://example.com/logo.png" };
  expect(draftToPublicDetail(state, null, company).company).toEqual(company);
  render(<DraftPublicDetail state={state} company={company} />);
  expect(screen.getAllByText(/Acme Talento/)).toHaveLength(3);
  expect(screen.queryByText(/Empresa no disponible/)).toBeNull();
});

it("uses honest missing data and omits empty public sections", () => {
  const { container } = render(<DraftPublicDetail state={emptyState()} />);
  expect(screen.getByRole("heading", { name: "Título sin definir" })).toBeVisible();
  expect(screen.queryByText(/Empresa no disponible/)).toBeNull();
  expect(container.querySelector('[data-slot="avatar"]')).toBeNull();
  expect(screen.getByText("Salario no publicado")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Sobre la vacante" })).toBeNull();
  expect(container).not.toHaveTextContent("Remoto");
});

it.each([
  [false, "987654.32", "MXN", "monthly", "gross"],
  [true, "1e3", "MXN", "monthly", "gross"],
  [true, "50000", "", "monthly", "gross"],
  [true, "50000", "MXN", "", "gross"],
  [true, "50000", "MXN", "monthly", ""],
])("does not project hidden, malformed or incomplete compensation (%s %s %s %s %s)", (public_visible, amount, currency, pay_period, basis) => {
  const state = emptyState();
  state.compensation = { mode: "fixed", amount, currency, pay_period, basis, public_visible, min: "", max: "" };
  expect(draftToPublicDetail(state).compensation).toBeNull();
  const { container } = render(<DraftPublicDetail state={state} />);
  expect(screen.getByText("Salario no publicado")).toBeVisible();
  expect(container).not.toHaveTextContent(/987,?654|50,?000|1e3/);
});

it("projects only the active salary buffer and preserves exact decimals", () => {
  const state = emptyState();
  state.compensation = { mode: "fixed", amount: "999999999999.99", min: "private", max: "private", currency: "USD", pay_period: "semimonthly", basis: "net", public_visible: true };
  expect(draftToPublicDetail(state).compensation).toEqual({ mode: "fixed", amount: "999999999999.99", min: null, max: null, currency: "USD", pay_period: "semimonthly", basis: "net" });
  render(<DraftPublicDetail state={state} />);
  expect(screen.getByText("$999,999,999,999.99")).toBeVisible();
  expect(screen.getByText("Quincenal · Neto")).toBeVisible();
});

it("requires both public range bounds but keeps partial amounts in internal review", () => {
  const state = emptyState();
  state.compensation = { mode: "range", amount: "private", min: "", max: "50000.00", currency: "USD", pay_period: "weekly", basis: "gross", public_visible: true };
  expect(draftToPublicDetail(state).compensation).toBeNull();
  expect(internalCompensationView(state.compensation)?.amount).toBe("Hasta $50,000 USD");
  state.compensation.min = "30000.00";
  expect(draftToPublicDetail(state).compensation).toMatchObject({ mode: "range", amount: null, min: "30000.00", max: "50000.00" });
});

it("validates the entire rich document before public rendering", () => {
  const state = emptyState();
  state.description = { schema_version: 1, document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "unsafe", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] } } as unknown as typeof state.description;
  expect(draftToPublicDetail(state).description).toBeNull();
  expect(draftToPublicDetail(state).description_plain).toBe("");
  const { container } = render(<DraftPublicDetail state={state} />);
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  expect(container).not.toHaveTextContent("unsafe");
});

it("uses catalog names for geography and never renders country codes as labels", () => {
  const state = emptyState();
  state.location.country = "MX";
  state.work_mode = "remote";
  state.remote_scope = { kind: "countries", countries: ["CO", "MX"] };
  state.remoteCountries = [{ id: "MX", name: "México" }, { id: "CO", name: "Colombia" }];
  render(<DraftPublicDetail state={state} />);
  expect(screen.getByText("Solo desde Colombia y México")).toBeVisible();
  expect(screen.getAllByText("México").length).toBeGreaterThan(0);
  state.work_mode = "onsite";
  expect(draftToPublicDetail(state).remote_scope).toBeNull();
});
