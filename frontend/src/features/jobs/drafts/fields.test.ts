import { describe, expect, it } from "vitest";

import { draftPatchBodySchema, draftPostBodySchema } from "./fields";

const defaults = () => ({
  title: null,
  location: null,
  remote_scope: null,
  work_mode: null,
  work_schedule: null,
  contract_type: null,
  seniority: null,
  professional_area: null,
  required_requirements: null,
  preferred_requirements: null,
  skills: [],
  custom_benefits: [],
  benefits: [],
  screening_questions: [],
  requester: null,
  languages: [],
  compensation: {
    mode: null, amount: null, min: null, max: null,
    currency: "MXN", pay_period: "monthly", basis: null, public_visible: false,
  },
  description: null,
});

const rich = (value: string) => ({
  schema_version: 1,
  document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: value }] }] },
});

// One accepted normalization and one rejection through every composed field.
const fieldCases: Array<[string, unknown, unknown, unknown]> = [
  ["title", " Backend Go ", "Backend Go", "x".repeat(201)],
  ["location", { country: "MX", state: "09" }, { country: "MX", state: "09" }, "CDMX"],
  ["remote_scope", { kind: "anywhere" }, { kind: "anywhere" }, { kind: "countries", countries: [] }],
  ["work_mode", "remote", "remote", " remote "],
  ["work_schedule", "part_time", "part_time", "contract"],
  ["contract_type", "professional_services", "professional_services", "full_time"],
  ["seniority", "mid", "mid", "expert"],
  ["professional_area", "technology_systems", "technology_systems", "IT"],
  ["required_requirements", " Go ", "Go", "x".repeat(16385)],
  ["preferred_requirements", " SQL ", "SQL", "x".repeat(16385)],
  ["skills", [" Go ", "SQL"], ["Go", "SQL"], ["Go", " Go "]],
  ["custom_benefits", [" Training ", "Lunch"], ["Training", "Lunch"], ["x", " x "]],
  ["benefits", ["annual_bonus", "health_insurance"], ["annual_bonus", "health_insurance"], ["unknown"]],
  ["screening_questions", [{ prompt: " Why? " }], [{ prompt: "Why?" }], [{ prompt: "Why?", id: "ui" }]],
  ["requester", { kind: "client", id: null }, { kind: "client", id: null }, { kind: "client", id: null, name: "readonly" }],
  ["languages", [{ language: "other", custom_name: " French ", level: null }], [{ language: "other", custom_name: "French", level: null }], [{ language: "en", custom_name: "French", level: null }]],
  ["compensation", { ...defaults().compensation, mode: "fixed", amount: "12.3" }, { ...defaults().compensation, mode: "fixed", amount: "12.30" }, { mode: "fixed" }],
  ["description", rich("  <>&\u2028  "), rich("  <>&\u2028  "), rich("x".repeat(65420))],
];

const schemas = [
  ["POST", draftPostBodySchema],
  ["PATCH", draftPatchBodySchema],
] as const;

for (const [method, schema] of schemas) {
  describe(`${method} strict write body`, () => {
    it.each([
      undefined, null, [], {}, { fields: undefined }, { fields: null }, { fields: [] },
      { fields: "invalid" }, { fields: { title: "x" }, status: "draft" },
      { fields: { title: "x" }, schema_version: 1 },
    ])("rejects malformed or expanded envelope %#", (input) => {
      expect(schema.safeParse(input).success).toBe(false);
    });

    it.each([
      "unknown", "description_plain", "created_by", "actor", "organization", "principal",
      "principal_recruiter_id", "status", "id", "version", "created_at", "updated_at",
      "closingDate", "wizardStep", "employmentType", "department",
    ])("rejects non-writable key %s at either level", (key) => {
      expect(schema.safeParse({ fields: { title: "x", [key]: "forbidden" } }).success).toBe(false);
      expect(schema.safeParse({ fields: { title: "x" }, [key]: "forbidden" }).success).toBe(false);
    });

    it.each(fieldCases)("normalizes %s without mutating input", (key, input, normalized) => {
      const body = { fields: { [key]: input } };
      const snapshot = structuredClone(body);
      const result = schema.parse(body);
      expect(result.fields).toHaveProperty(key, normalized);
      expect(body).toStrictEqual(snapshot);
      expect(result).not.toHaveProperty("description_plain");
    });

    it.each(fieldCases)("rejects invalid %s without mutating input", (key, _input, _normalized, invalid) => {
      const body = { fields: { [key]: invalid } };
      const snapshot = structuredClone(body);
      expect(schema.safeParse(body).success).toBe(false);
      expect(body).toStrictEqual(snapshot);
    });

    it.each(fieldCases)("rejects explicitly undefined %s", (key) => {
      const result = schema.safeParse({ fields: { title: "valid", [key]: undefined } });
      expect(result.success).toBe(false);
    });

    it.each([
      "title", "location", "work_mode", "work_schedule", "contract_type", "seniority",
      "professional_area", "required_requirements", "preferred_requirements", "requester", "description",
    ])("accepts explicit null for %s", (key) => {
      expect(schema.parse({ fields: { [key]: null } }).fields).toHaveProperty(key, null);
    });

    it.each(["skills", "custom_benefits", "benefits", "screening_questions", "languages", "compensation"])(
      "rejects null for %s", (key) => {
        expect(schema.safeParse({ fields: { [key]: null } }).success).toBe(false);
      },
    );

    it("rejects partial replacements for every nested object kind", () => {
      for (const fields of [
        { compensation: { currency: "USD" } }, { requester: { kind: "client" } },
        { languages: [{ language: "other" }] }, { description: { schema_version: 1 } },
      ]) {
        expect(schema.safeParse({ fields }).success).toBe(false);
      }
    });

    it("normalizes the exact compensation edit example without adding derived fields", () => {
      const compensation = {
        mode: "range", amount: null, min: "30000", max: "45000", currency: "MXN",
        pay_period: "monthly", basis: "gross", public_visible: false,
      };
      expect(schema.parse({ fields: { compensation } }).fields.compensation).toStrictEqual({
        ...compensation, min: "30000.00", max: "45000.00",
      });
    });
  });
}

describe("POST defaults versus PATCH omission", () => {
  it("fills exactly all 17 writable fields on empty POST", () => {
    expect(draftPostBodySchema.parse({ fields: {} })).toStrictEqual({ fields: defaults() });
    expect(Object.keys(defaults())).toHaveLength(18);
  });

  it("returns independent arrays and compensation defaults for every POST", () => {
    const a = draftPostBodySchema.parse({ fields: {} });
    const b = draftPostBodySchema.parse({ fields: {} });
    for (const key of ["skills", "custom_benefits", "benefits", "screening_questions", "languages", "compensation"] as const) {
      expect(a.fields[key]).not.toBe(b.fields[key]);
    }
  });

  it("applies defaults to the exact minimal create example", () => {
    const fields = { title: "Backend Go", professional_area: "technology_systems" };
    expect(draftPostBodySchema.parse({ fields })).toStrictEqual({ fields: { ...defaults(), ...fields } });
  });

  it("preserves only present PATCH fields including null, empty arrays and empty-to-null normalization", () => {
    const fields = { title: " \u0085 ", description: null, requester: null, languages: [], skills: [] };
    expect(draftPatchBodySchema.parse({ fields })).toStrictEqual({ fields: { ...fields, title: null } });
  });

  it("does not fill present compensation null members with POST defaults", () => {
    const compensation = { ...defaults().compensation, currency: null, pay_period: null };
    expect(draftPostBodySchema.parse({ fields: { compensation } }).fields.compensation).toStrictEqual(compensation);
  });

  it("distinguishes POST normalization from PATCH without a nested merge", () => {
    const body = { fields: { title: " x " } };
    expect(draftPostBodySchema.parse(body)).toStrictEqual({ fields: { ...defaults(), title: "x" } });
    expect(draftPatchBodySchema.parse(body)).toStrictEqual({ fields: { title: "x" } });
  });

  it("rejects empty PATCH with the empty_patch discriminator at fields", () => {
    const result = draftPatchBodySchema.safeParse({ fields: {} });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toContainEqual(expect.objectContaining({
      code: "custom", path: ["fields"], message: "empty_patch", params: { kind: "empty_patch" },
    }));
  });
});
