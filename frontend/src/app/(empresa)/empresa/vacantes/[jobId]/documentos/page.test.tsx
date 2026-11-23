import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import Page from "./page";

// Vitest runs from frontend/, so cwd-relative paths keep the assertions stable.
const pageSource = readFileSync(join(process.cwd(), "src/app/(empresa)/empresa/vacantes/[jobId]/documentos/page.tsx"), "utf8");
const NEXT_NOT_FOUND = new Error("NEXT_NOT_FOUND");
vi.mock("next/navigation", () => ({ notFound: () => { throw NEXT_NOT_FOUND; } }));
vi.mock("@/features/jobs/drafts/reopen/load", () => ({ loadDraftForEditAction: vi.fn(() => new Promise(() => {})) }));
vi.mock("@/features/jobs/drafts/pipeline/publication-actions", () => ({ loadDraftPublicationAction: vi.fn(() => new Promise(() => {})) }));

const paramsFor = (jobId: string) => Promise.resolve({ jobId });

// S9: the third vacancy route, /empresa/vacantes/[jobId]/documentos.
describe("/empresa/vacantes/[jobId]/documentos", () => {
  it("routes a UUID to the vacancy Documentos screen", async () => {
    const content = await Page({ params: paramsFor("123e4567-e89b-42d3-a456-426614174000") });
    expect(content.type.name).toBe("VacancyDocumentsScreen");
    expect(content.props.vacancyId).toBe("123e4567-e89b-42d3-a456-426614174000");
  });
  it("routes every non-UUID id to notFound", async () => {
    for (const id of ["backend-developer-senior", "no-existe", "123e4567-e89b-42d3-a456-426614174000 ", ""]) {
      await expect(Page({ params: paramsFor(id) })).rejects.toThrow(NEXT_NOT_FOUND);
    }
  });
  it("serves no prototype data", () => {
    expect(pageSource).not.toMatch(/NEXO_|prototype-|findEmployerVacancy/u);
  });
});
