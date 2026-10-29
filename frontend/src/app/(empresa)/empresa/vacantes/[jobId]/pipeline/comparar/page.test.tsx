import { describe, it, expect, vi } from "vitest";
import Page, { metadata } from "./page";
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
vi.mock("@/features/vacancy-checklist/compare/ui", () => ({ ComparisonPage: () => null }));
describe("comparison route", () => {
 it.each(["bad-id", "123", "../secret"])("rejects invalid job id %s", async jobId => {
  await expect(Page({ params: Promise.resolve({ jobId }), searchParams: Promise.resolve({ ids: "one,two" }) })).rejects.toThrow("NEXT_NOT_FOUND");
 });
 it("passes ids to the mounted action loader and has metadata", async () => {
  const result = await Page({ params: Promise.resolve({ jobId: "123e4567-e89b-42d3-a456-000000000001" }), searchParams: Promise.resolve({ ids: "one,two" }) });
  expect(result.props.ids).toBe("one,two");
  expect(metadata.title).toContain("Comparar");
 });
 it("defaults absent or ambiguous selections to empty", async () => {
  for (const searchParams of [{}, { ids: ["one", "two"] }]) {
   const result = await Page({ params: Promise.resolve({ jobId: "123e4567-e89b-42d3-a456-000000000001" }), searchParams: Promise.resolve(searchParams) });
   expect(result.props.ids).toBe("");
  }
 });
});
