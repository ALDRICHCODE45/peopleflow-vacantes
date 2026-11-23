import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { loadDraftForEditAction } from "@/features/jobs/drafts/reopen/load";
import { loadDraftPublicationAction } from "@/features/jobs/drafts/pipeline/publication-actions";
import { draftEditSeedFromRead } from "@/features/jobs/drafts/reopen/seed";
import { filledDraftRead } from "@/features/jobs/drafts/reopen/test-fixture";
import { VacancyDocumentsScreen } from "./vacancy-documents-screen";
import { VacancyDocumentsPlaceholder } from "./vacancy-documents-placeholder";

vi.mock("@/features/jobs/drafts/reopen/load", () => ({ loadDraftForEditAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/publication-actions", () => ({ loadDraftPublicationAction: vi.fn() }));
vi.mock("@/components/company-dashboard/site-header", () => ({ SiteHeader: ({ parent }: { parent: { label: string; href: string }; status?: ReactNode }) => <header><a href={parent.href}>{parent.label}</a></header> }));
const read = filledDraftRead();
const success = { ok: true, seed: { ...draftEditSeedFromRead(read), lifecycle: { ...read.lifecycle, publication: "published", process: "active", published_at: "2026-10-16T12:00:00Z" } }, identity: { draftId: read.id, etag: '"etag"' } } as const;
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadDraftForEditAction).mockResolvedValue(success as never);
  vi.mocked(loadDraftPublicationAction).mockResolvedValue({ ok: true, publication: { status: "published", publishedAt: "2026-10-16T12:00:00Z", missing: [] } });
});
afterEach(cleanup);

it("the placeholder says «Documentos» with a short «Próximamente» empty state", () => {
  render(<VacancyDocumentsPlaceholder />);
  expect(screen.getByRole("heading", { level: 2, name: "Documentos" })).toBeVisible();
  expect(screen.getByText("Próximamente")).toBeVisible();
});
it("lives in the vacancy frame: identity row, Documentos as the current tab, the placeholder below, one read each", async () => {
  render(<VacancyDocumentsScreen vacancyId={read.id} />);
  expect(await screen.findByRole("heading", { level: 1, name: read.fields.title! })).toBeVisible();
  expect(screen.getByText("Activa")).toHaveAttribute("data-slot", "badge");
  expect(screen.getByText(/Publicada el/)).toHaveTextContent("Publicada el 16 oct 2026");
  const tabs = screen.getByRole("navigation", { name: "Secciones de la vacante" });
  expect(within(tabs).getByRole("link", { name: "Documentos" })).toHaveAttribute("aria-current", "page");
  expect(within(tabs).getByRole("link", { name: "Pipeline" })).not.toHaveAttribute("aria-current");
  expect(screen.getByRole("heading", { level: 2, name: "Documentos" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Vacantes" })).toHaveAttribute("href", "/empresa/vacantes");
  expect(loadDraftForEditAction).toHaveBeenCalledExactlyOnceWith(read.id);
  expect(loadDraftPublicationAction).toHaveBeenCalledExactlyOnceWith(read.id);
});
it("shows a draft read failure with a retry instead of the placeholder", async () => {
  vi.mocked(loadDraftForEditAction).mockResolvedValueOnce({ ok: false, reason: "not_found" });
  render(<VacancyDocumentsScreen vacancyId={read.id} />);
  fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
  expect(await screen.findByRole("heading", { level: 1, name: read.fields.title! })).toBeVisible();
  expect(loadDraftForEditAction).toHaveBeenCalledTimes(2);
});
