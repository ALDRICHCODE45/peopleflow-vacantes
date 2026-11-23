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
