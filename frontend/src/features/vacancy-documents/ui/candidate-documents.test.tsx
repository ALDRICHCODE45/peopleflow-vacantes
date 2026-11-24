import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { loadDocumentOverviewAction } from "../actions";
import { overviewSchema } from "../model";
import { ids, overviewWire } from "../test-fixtures";
import { CandidateDocuments, candidateDocumentsHref, initialDocumentFilters } from "./candidate-documents";

vi.mock("../actions", () => ({ loadDocumentOverviewAction: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

it("links the candidate's documents tab and counts only that participation's documents", async () => {
  vi.mocked(loadDocumentOverviewAction).mockResolvedValue({ ok: true, data: overviewSchema.parse(overviewWire()) });
  render(<CandidateDocuments vacancyId={ids.draft} participationId={ids.participation} />);
  const link = await screen.findByRole("link", { name: /Documentos \(1\)/ });
  expect(link).toHaveAttribute("href", candidateDocumentsHref(ids.draft, ids.participation));
  expect(link.getAttribute("href")).toBe(`/empresa/vacantes/${ids.draft}/documentos?candidato=${ids.participation}`);
  expect(loadDocumentOverviewAction).toHaveBeenCalledWith(ids.draft, ids.participation);
});
it("keeps the link, without a count, when the read fails", async () => {
  vi.mocked(loadDocumentOverviewAction).mockResolvedValue({ ok: false, reason: "no_response", message: "x", reference: {} } as never);
  render(<CandidateDocuments vacancyId={ids.draft} participationId={ids.participation} />);
  await waitFor(() => expect(screen.getByRole("link", { name: "Documentos" })).toBeVisible());
});
it("reads ?candidato= as the initial candidate filter, only when it is a UUID", () => {
  expect(initialDocumentFilters(`?candidato=${ids.participation}`)).toMatchObject({ participationId: ids.participation, scope: "candidates" });
  expect(initialDocumentFilters("?candidato=../x")).toMatchObject({ participationId: null, scope: "all" });
  expect(initialDocumentFilters("")).toMatchObject({ participationId: null, scope: "all" });
});
