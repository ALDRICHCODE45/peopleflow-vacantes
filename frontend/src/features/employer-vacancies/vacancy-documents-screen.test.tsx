import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { loadDraftForEditAction } from "@/features/jobs/drafts/reopen/load";
import { loadDraftPublicationAction } from "@/features/jobs/drafts/pipeline/publication-actions";
import { draftEditSeedFromRead } from "@/features/jobs/drafts/reopen/seed";
import { filledDraftRead } from "@/features/jobs/drafts/reopen/test-fixture";
import { VacancyDocumentsScreen } from "./vacancy-documents-screen";
import { loadDocumentOverviewAction } from "@/features/vacancy-documents/actions";
import { overviewSchema } from "@/features/vacancy-documents/model";
import { overviewWire } from "@/features/vacancy-documents/test-fixtures";

const membership = vi.hoisted(() => ({ state: vi.fn() }));
vi.mock("@/features/employer-company/company-membership-context", () => ({ useCompanyMembershipState: () => membership.state() }));
vi.mock("@/features/jobs/drafts/reopen/load", () => ({ loadDraftForEditAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/publication-actions", () => ({ loadDraftPublicationAction: vi.fn() }));
vi.mock("@/features/vacancy-documents/actions", () => ({ loadDocumentOverviewAction: vi.fn(), deleteDocumentAction: vi.fn(), deleteDocumentLinkAction: vi.fn(), listDocumentVersionsAction: vi.fn(), listDocumentSourcesAction: vi.fn(), createDocumentLinkAction: vi.fn() }));
vi.mock("@/components/ui/combobox", async () => (await import("@/features/vacancy-documents/ui/test-support")).comboboxDouble());
vi.mock("@/components/ui/dropdown-menu", async () => (await import("@/features/vacancy-documents/ui/test-support")).dropdownMenuDouble());
vi.mock("@/components/company-dashboard/site-header", () => ({ SiteHeader: ({ parent }: { parent: { label: string; href: string }; status?: ReactNode }) => <header><a href={parent.href}>{parent.label}</a></header> }));
const read = filledDraftRead();
const success = { ok: true, seed: { ...draftEditSeedFromRead(read), lifecycle: { ...read.lifecycle, publication: "published", process: "active", published_at: "2026-10-16T12:00:00Z" } }, identity: { draftId: read.id, etag: '"etag"' } } as const;
beforeEach(() => {
  vi.resetAllMocks();
  membership.state.mockReturnValue(null);
  vi.mocked(loadDraftForEditAction).mockResolvedValue(success as never);
  vi.mocked(loadDraftPublicationAction).mockResolvedValue({ ok: true, publication: { status: "published", publishedAt: "2026-10-16T12:00:00Z", missing: [] } });
  vi.mocked(loadDocumentOverviewAction).mockResolvedValue({ ok: true, data: overviewSchema.parse(overviewWire()) });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("lives in the vacancy frame: identity row, Documentos as the current tab, the documents table below, one read each", async () => {
  render(<VacancyDocumentsScreen vacancyId={read.id} />);
  expect(await screen.findByRole("heading", { level: 1, name: read.fields.title! })).toBeVisible();
  expect(screen.getByText("Activa")).toHaveAttribute("data-slot", "badge");
  expect(screen.getByText(/Publicada el/)).toHaveTextContent("Publicada el 16 oct 2026");
  const tabs = screen.getByRole("navigation", { name: "Secciones de la vacante" });
  expect(within(tabs).getByRole("link", { name: "Documentos" })).toHaveAttribute("aria-current", "page");
  expect(within(tabs).getByRole("link", { name: "Pipeline" })).not.toHaveAttribute("aria-current");
  expect(await screen.findByRole("heading", { level: 2, name: "Documentos" })).toBeVisible();
  expect(await screen.findByRole("table")).toBeVisible();
  expect(loadDocumentOverviewAction).toHaveBeenCalledExactlyOnceWith(read.id, undefined);
  expect(screen.getByRole("link", { name: "Vacantes" })).toHaveAttribute("href", "/empresa/vacantes");
  expect(loadDraftForEditAction).toHaveBeenCalledExactlyOnceWith(read.id);
  expect(loadDraftPublicationAction).toHaveBeenCalledExactlyOnceWith(read.id);
});
it("shows a draft read failure with a retry instead of the documents", async () => {
  vi.mocked(loadDraftForEditAction).mockResolvedValueOnce({ ok: false, reason: "not_found" });
  render(<VacancyDocumentsScreen vacancyId={read.id} />);
  fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
  expect(await screen.findByRole("heading", { level: 1, name: read.fields.title! })).toBeVisible();
  expect(loadDraftForEditAction).toHaveBeenCalledTimes(2);
});

// S11: the stakeholder reads the Documentos tab of a vacancy. It has no draft, lifecycle or publication read (recruiter-only, 403).
const company = { id: "c", name: "Talentia", rfc: "R", industry_id: "i", status: "active" as const, location: null, updated_at: "2026-10-20T12:00:00Z" };
const asRole = (role: "owner" | "recruiter" | "stakeholder") => membership.state.mockReturnValue({ userId: "u1", state: { kind: "exists", company, role, industryLabel: "Tec", canViewTalentBase: true, canViewMetrics: true }, reload: async () => {} });
const readOnlyOverview = (patch: (value: ReturnType<typeof overviewWire>) => void = () => {}) => {
  const value = overviewWire();
  value.scope = { ...value.scope, can_manage: false, allowed_actions: [], upload_blocked_reason: null } as never;
  value.items = value.items.map(item => ({ ...item, allowed_actions: ["download"] })) as never;
  value.links = value.links.map(link => ({ ...link, allowed_actions: link.state === "available" ? ["download"] : [] })) as never;
  value.participations = value.participations.map(entry => ({ ...entry, scope_allowed_actions: [], upload_blocked_reason: null })) as never;
  patch(value);
  return overviewSchema.parse(value);
};
const asStakeholder = (overview = readOnlyOverview()) => { asRole("stakeholder"); vi.mocked(loadDocumentOverviewAction).mockResolvedValue({ ok: true, data: overview }); };

it("S11: a stakeholder never makes the recruiter-only draft, lifecycle or publication reads", async () => {
  asStakeholder();
  render(<VacancyDocumentsScreen vacancyId={read.id} />);
  expect(await screen.findByRole("table")).toBeVisible();
  expect(loadDraftForEditAction).not.toHaveBeenCalled();
  expect(loadDraftPublicationAction).not.toHaveBeenCalled();
  expect(loadDocumentOverviewAction).toHaveBeenCalledWith(read.id, undefined);
});
it("S11: a stakeholder sees only the Documentos tab and goes back to the stakeholder list", async () => {
  asStakeholder();
  render(<VacancyDocumentsScreen vacancyId={read.id} />);
  await screen.findByRole("table");
  const tabs = screen.getByRole("navigation", { name: "Secciones de la vacante" });
  expect(within(tabs).getAllByRole("link").map(link => link.textContent)).toEqual(["Documentos"]);
  expect(within(tabs).getByRole("link", { name: "Documentos" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Vacantes" })).toHaveAttribute("href", "/empresa/stakeholder/vacantes");
});
it("S11: the identity row comes from the overview header (title, state, «Reemplazo», «Privada»)", async () => {
  asStakeholder();
  render(<VacancyDocumentsScreen vacancyId={read.id} />);
  expect(await screen.findByRole("heading", { level: 1, name: "Analista contable" })).toBeVisible();
  expect(screen.getByText("Activa")).toHaveAttribute("data-slot", "badge");
  expect(screen.getByText("Reemplazo")).toBeVisible();
  expect(screen.getByText("Privada", { selector: '[data-slot="badge"]' })).toBeVisible();
});
it("S2/S11: a never-published draft of the stakeholder reads «Sin título» and «Borrador»", async () => {
  asStakeholder(readOnlyOverview(value => { value.vacancy = { ...value.vacancy, title: null, publication: null, process: null, visibility: null, kind: "original" } as never; }));
  render(<VacancyDocumentsScreen vacancyId={read.id} />);
  expect(await screen.findByRole("heading", { level: 1, name: "Sin título" })).toBeVisible();
  expect(screen.getByText("Borrador")).toHaveAttribute("data-slot", "badge");
  expect(await screen.findByRole("table")).toBeVisible();
});
it("S11: the stakeholder tab is read-only — a note says so and there is no upload or link action", async () => {
  asStakeholder();
  render(<VacancyDocumentsScreen vacancyId={read.id} />);
  await screen.findByRole("table");
  expect(screen.getByRole("note")).toHaveTextContent("Solo consulta");
  expect(screen.getByRole("note")).toHaveTextContent("no hay subir, reemplazar, vincular ni eliminar");
  expect(screen.queryByRole("button", { name: "Subir documento" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Vincular/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Eliminar|Reemplazar|Desvincular/ })).toBeNull();
});
it("S11: if the overview header cannot be read the frame falls back to «Documentos» and the tab shows its own retry", async () => {
  asRole("stakeholder");
  vi.mocked(loadDocumentOverviewAction).mockResolvedValue({ ok: false, reason: "no_response", message: "No pudimos cargar los documentos.", reference: {} } as never);
  render(<VacancyDocumentsScreen vacancyId={read.id} />);
  expect(await screen.findAllByText("No pudimos cargar los documentos.")).not.toHaveLength(0);
  expect(screen.getByRole("heading", { level: 1, name: "Documentos" })).toBeVisible();
  expect(screen.queryByText("Activa")).toBeNull();
  expect(loadDraftForEditAction).not.toHaveBeenCalled();
});
it.each(["owner", "recruiter"] as const)("keeps today's screen for a %s: draft and publication reads, three tabs, portfolio crumb", async role => {
  asRole(role);
  render(<VacancyDocumentsScreen vacancyId={read.id} />);
  expect(await screen.findByRole("heading", { level: 1, name: read.fields.title! })).toBeVisible();
  await screen.findByRole("table");
  expect(within(screen.getByRole("navigation", { name: "Secciones de la vacante" })).getAllByRole("link")).toHaveLength(3);
  expect(screen.getByRole("link", { name: "Vacantes" })).toHaveAttribute("href", "/empresa/vacantes");
  expect(loadDraftForEditAction).toHaveBeenCalledExactlyOnceWith(read.id);
  expect(loadDraftPublicationAction).toHaveBeenCalledExactlyOnceWith(read.id);
  expect(screen.queryByRole("note")).toBeNull();
});
it("reads nothing while the membership is still unknown (no recruiter-only read can fire for a stakeholder)", () => {
  membership.state.mockReturnValue({ userId: "u1", state: null, reload: async () => {} });
  render(<VacancyDocumentsScreen vacancyId={read.id} />);
  expect(screen.getByRole("heading", { level: 1, name: "Documentos" })).toBeInTheDocument();
  expect(loadDraftForEditAction).not.toHaveBeenCalled();
  expect(loadDraftPublicationAction).not.toHaveBeenCalled();
  expect(loadDocumentOverviewAction).not.toHaveBeenCalled();
});
