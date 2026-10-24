import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import Page from "./page";

// Vitest runs from frontend/, so cwd-relative paths keep the assertions stable.
const pageSource = readFileSync(
  join(process.cwd(), "src/app/(empresa)/empresa/vacantes/[jobId]/pipeline/page.tsx"),
  "utf8",
);

/** The framework not-found signal, stubbed so the page contract is observable. */
const NEXT_NOT_FOUND = new Error("NEXT_NOT_FOUND");

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw NEXT_NOT_FOUND;
  },
}));

vi.mock("@/features/jobs/drafts/reopen/load", () => ({ loadDraftForEditAction: vi.fn(() => new Promise(() => {})) }));
vi.mock("@/features/jobs/drafts/pipeline/actions", () => ({ loadDraftPipelineAction: vi.fn(() => new Promise(() => {})), saveDraftPipelineAction: vi.fn() }));

const paramsFor = (jobId: string) => Promise.resolve({ jobId });

describe("/empresa/vacantes/[jobId]/pipeline", () => {
  it("routes a UUID to the real vacancy board", async () => {
    const content = await Page({ params: paramsFor("123e4567-e89b-42d3-a456-426614174000") });
    expect(content.type.name).toBe("DraftPipelineState");
    expect(content.props.draftId).toBe("123e4567-e89b-42d3-a456-426614174000");
  });

  it("routes every non-UUID id to notFound, including the former prototype ids", async () => {
    for (const id of [
      "backend-developer-senior",
      "no-existe",
      "BACKEND-DEVELOPER-SENIOR",
      "123e4567-e89b-42d3-a456-426614174000 ",
      "",
    ]) {
      await expect(Page({ params: paramsFor(id) })).rejects.toThrow(NEXT_NOT_FOUND);
    }
  });

  it("serves no prototype data", () => {
    expect(pageSource).not.toMatch(/NEXO_|prototype-|PipelineWorkspace|findEmployerVacancy/u);
  });
});
