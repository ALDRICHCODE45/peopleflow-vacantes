import { afterEach, expect, it, vi } from "vitest";
import { publicJobDetailSchema, publicJobItemSchema } from "../schemas";
import { legacyDetail, listItem, vacancyDetail } from "./public-fixtures";
import { getJob } from "./getJob";
import { listJobs } from "./listJobs";

vi.mock("../../../lib/api/server", async () => ({ requestJson: (await import("../../../lib/api/requestJson")).requestJson }));
vi.mock("../../../lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://127.0.0.1:8080", apiTimeoutMs: 8000, sampleJobs: false } }));
afterEach(() => vi.unstubAllGlobals());

const enrichment = {
  excerpt: "Construye servicios seguros.", excerpt_truncated: false,
  benefits_preview: { predefined: ["health_insurance"], custom: ["Café"] }, benefits_total: 5,
  skills_preview: ["Go", "SQL", "Redis", "AWS", "Docker", "Linux"], skills_total: 8,
  applicants: "under_10", screening_questions: 0,
};
const enriched = { ...vacancyDetail, ...enrichment, company: { ...vacancyDetail.company, logo_url: "https://example.test/logo.png" }, skills: [...enrichment.skills_preview, "Git", "HTTP"] };
const enrichedItem = { ...listItem(vacancyDetail), ...enrichment, company: enriched.company };

it("accepts every enrichment key without stripping ordered previews or the full detail skills", () => {
  expect(publicJobItemSchema.parse(enrichedItem)).toEqual(enrichedItem);
  expect(publicJobDetailSchema.parse(enriched)).toEqual(enriched);
  expect(Object.keys(publicJobItemSchema.parse(enrichedItem))).toHaveLength(25);
  expect(Object.keys(publicJobDetailSchema.parse(enriched))).toHaveLength(30);
});

it.each(["excerpt", "excerpt_truncated", "benefits_preview", "benefits_total", "skills_preview", "skills_total", "applicants", "screening_questions"])("requires enrichment key %s in list and detail", (key) => {
  for (const [schema, input] of [[publicJobItemSchema, enrichedItem], [publicJobDetailSchema, enriched]] as const) {
    const missing = { ...input };
    Reflect.deleteProperty(missing, key);
    expect(schema.safeParse(missing).success).toBe(false);
  }
});

it.each([null, "https://example.test/logo.png", "HTTPS://example.test/logo.png"])("accepts public logo %s on either source", (logo_url) => {
  for (const detail of [vacancyDetail, legacyDetail]) {
    expect(publicJobItemSchema.safeParse({ ...listItem(detail), company: { ...detail.company, logo_url } }).success).toBe(true);
  }
});

it.each([undefined, "/logo.png", "http://example.test/a", "data:image/png;base64,a", "https://user:pass@example.test/a", "https://@example.test/a", "https://:@example.test/a", "https://", "not a url"])("rejects malformed or missing public logo %s", (logo_url) => {
  expect(publicJobItemSchema.safeParse({ ...enrichedItem, company: { ...enriched.company, logo_url } }).success).toBe(false);
});

it.each(["under_10", "10_plus", "25_plus", "50_plus"])("accepts closed applicant range %s", (applicants) => {
  expect(publicJobItemSchema.safeParse({ ...enrichedItem, applicants }).success).toBe(true);
});

it("enforces legacy null/empty enrichment and the required full skills key", () => {
  expect(publicJobDetailSchema.safeParse(legacyDetail).success).toBe(true);
  for (const patch of [{ applicants: "under_10" }, { screening_questions: 0 }, { skills_preview: ["Go"] }, { skills_total: 1 }, { benefits_preview: { predefined: [], custom: ["Café"] } }, { benefits_total: 1 }, { skills: ["Go"] }]) {
    expect(publicJobDetailSchema.safeParse({ ...legacyDetail, ...patch }).success, JSON.stringify(patch)).toBe(false);
  }
  const missing = { ...enriched };
  Reflect.deleteProperty(missing, "skills");
  expect(publicJobDetailSchema.safeParse(missing).success).toBe(false);
  expect(publicJobItemSchema.safeParse({ ...enrichedItem, skills: [] }).success).toBe(false);
});

it.each([
  { applicants: "100_plus" }, { applicants: 10 }, { applicants: null },
  { screening_questions: -1 }, { screening_questions: 1.5 }, { screening_questions: null },
  { benefits_preview: { predefined: ["unknown"], custom: [] } },
  { benefits_preview: { predefined: ["health_insurance", "wellness"], custom: ["A", "B"] } },
  { benefits_preview: { predefined: [], custom: [" "] } },
  { benefits_total: -1 }, { benefits_total: 1.5 },
  { skills_preview: Array.from({ length: 7 }, (_, i) => `Skill ${i}`) },
  { skills_preview: [""] }, { skills_preview: [" Go"] }, { skills_preview: ["😀".repeat(201)] },
  { skills_total: -1 }, { skills_total: 2.5 }, { excerpt_truncated: "true" },
])("maps malformed enrichment to an unrecognized response on list and detail: %j", async (patch) => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ items: [{ ...enrichedItem, ...patch }], next_cursor: null }) });
  vi.stubGlobal("fetch", fetchMock);
  const invalid = { ok: false, error: { kind: "invalid_response", retryable: false } };
  expect(await listJobs({})).toEqual(invalid);
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...enriched, ...patch }) });
  expect(await getJob(enriched.id)).toEqual(invalid);
});

it("bounds normalized excerpts by code points without treating BOM as Unicode White_Space", () => {
  for (const excerpt of ["😀".repeat(240), "\uFEFFTexto\uFEFF", "A B"]) {
    expect(publicJobItemSchema.safeParse({ ...enrichedItem, excerpt }).success, excerpt).toBe(true);
  }
  for (const excerpt of ["😀".repeat(241), "", " A", "A\nB", "A\u0085B", "A  B"]) {
    expect(publicJobItemSchema.safeParse({ ...enrichedItem, excerpt }).success, excerpt).toBe(false);
  }
});

it("preserves Unicode code points and entered skill order at the contract limits", () => {
  const skill = "😀".repeat(200);
  expect(publicJobDetailSchema.safeParse({ ...enriched, skills: [skill, "A  B", "é", "é"] }).success).toBe(true);
  expect(publicJobDetailSchema.safeParse({ ...enriched, skills: Array(101).fill("Go") }).success).toBe(false);
  expect(publicJobDetailSchema.safeParse({ ...enriched, skills: [" "] }).success).toBe(false);
});
