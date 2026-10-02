import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  apiErrorEnvelopeSchema,
  createJobRequestSchema,
  createJobSuccessSchema,
  jobEditorViewSchema,
} from "./schemas";
import type { ApiErrorEnvelope, CreateJobRequest, JobEditorView } from "./schemas";

const JOB_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const COMPANY_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f";

/** Minimal body that satisfies every required `POST /jobs` field. */
const BASE_REQUEST = {
  title: "Ingeniera Frontend",
  description: "Construye la experiencia de vacantes.",
  work_mode: "remote",
  employment_type: "full_time",
  seniority: "senior",
};
const validRequest = (overrides: Record<string, unknown> = {}) => ({
  ...BASE_REQUEST,
  ...overrides,
});

/** Minimal body that satisfies the `201` editor view (nullable fields omitted). */
const BASE_EDITOR_VIEW = {
  id: JOB_ID,
  title: "Ingeniera Frontend",
  description: "Construye la experiencia de vacantes.",
  work_mode: "remote",
  employment_type: "full_time",
  seniority: "senior",
  salary_currency: "MXN",
  status: "draft",
  updated_at: "2026-02-01T10:00:00Z",
  company: { id: COMPANY_ID, name: "Acme" },
};
const validEditorView = (overrides: Record<string, unknown> = {}) => ({
  ...BASE_EDITOR_VIEW,
  ...overrides,
});

describe("create job request schema", () => {
  it("accepts the exact POST /jobs contract and returns the wire payload unchanged", () => {
    const request = validRequest({
      location: "Monterrey, NL",
      salary_min: 25000,
      salary_max: 40000,
      salary_currency: "USD",
    });
    expect(createJobRequestSchema.parse(request)).toEqual(request);
  });

  it("trims required text and rejects whitespace-only title or description with the backend message", () => {
    expect(createJobRequestSchema.parse(validRequest({ title: "  React Dev  " })).title).toBe(
      "React Dev",
    );
    expect(
      createJobRequestSchema.parse(validRequest({ description: "  Cuerpo  " })).description,
    ).toBe("Cuerpo");
    for (const field of ["title", "description"] as const) {
      for (const blank of ["", "   ", "\n\t"]) {
        expect(() =>
          createJobRequestSchema.parse(validRequest({ [field]: blank })),
        ).toThrow(`${field} must not be empty`);
      }
      expect(() => createJobRequestSchema.parse(validRequest({ [field]: undefined }))).toThrow();
    }
  });

  it("omits empty optional fields from the wire payload instead of sending empty strings", () => {
    const parsed = createJobRequestSchema.parse(
      validRequest({ location: "   ", salary_currency: "" }),
    );
    expect(parsed.location).toBeUndefined();
    expect(parsed.salary_currency).toBeUndefined();
    const wire = JSON.stringify(parsed);
    expect(wire).not.toContain("location");
    expect(wire).not.toContain("salary_currency");
    // An absent currency lets the backend apply its MXN default.
    expect(Object.keys(parsed).sort()).toEqual(
      ["description", "employment_type", "seniority", "title", "work_mode"].sort(),
    );
  });

  it("accepts every supported enum value and rejects anything outside the feature enums", () => {
    const accepted: Record<string, string[]> = {
      work_mode: ["onsite", "remote", "hybrid"],
      employment_type: ["full_time", "part_time", "contract", "internship"],
      seniority: ["intern", "junior", "mid", "senior", "lead"],
      salary_currency: ["MXN", "USD"],
    };
    for (const [field, values] of Object.entries(accepted)) {
      for (const value of values) {
        expect(() =>
          createJobRequestSchema.parse(validRequest({ [field]: value })),
        ).not.toThrow();
      }
    }
    for (const [field, value] of [
      ["work_mode", "telecommute"],
      ["work_mode", "remote "],
      ["employment_type", "freelance"],
      ["seniority", "principal"],
      ["salary_currency", "EUR"],
      ["salary_currency", "mxn"],
    ] as const) {
      expect(() =>
        createJobRequestSchema.parse(validRequest({ [field]: value })),
      ).toThrow();
    }
  });

  it("requires integer salary bounds and rejects non-integer values", () => {
    expect(
      createJobRequestSchema.parse(validRequest({ salary_min: 0, salary_max: 0 })),
    ).toMatchObject({ salary_min: 0, salary_max: 0 });
    for (const field of ["salary_min", "salary_max"] as const) {
      expect(() =>
        createJobRequestSchema.parse(validRequest({ [field]: 2500.5 })),
      ).toThrow();
      expect(() => createJobRequestSchema.parse(validRequest({ [field]: "25000" }))).toThrow();
    }
  });

  it("accepts backend-valid explicit null optionals and omits each one from the wire payload", () => {
    const parsed = createJobRequestSchema.parse(
      validRequest({
        location: null,
        salary_min: null,
        salary_max: null,
        salary_currency: null,
      }),
    );
    for (const omitted of [
      "location",
      "salary_min",
      "salary_max",
      "salary_currency",
    ] as const) {
      expect(Object.hasOwn(parsed, omitted)).toBe(false);
      expect(parsed[omitted]).toBeUndefined();
    }
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(BASE_REQUEST).sort());
    // A null bound is never sent downstream as `null`.
    expect(JSON.stringify(parsed)).not.toContain("null");

    // A null bound never invalidates an otherwise valid single bound.
    expect(
      createJobRequestSchema.parse(
        validRequest({ salary_min: null, salary_max: 25000 }),
      ),
    ).toEqual(validRequest({ salary_max: 25000 }));
    expect(
      createJobRequestSchema.parse(
        validRequest({ salary_min: 40000, salary_max: null }),
      ),
    ).toEqual(validRequest({ salary_min: 40000 }));
  });

  it("types explicit null optionals as accepted input while the output stays omission-friendly", () => {
    type RequestInput = z.input<typeof createJobRequestSchema>;
    expectTypeOf<RequestInput["location"]>().toEqualTypeOf<
      string | null | undefined
    >();
    expectTypeOf<CreateJobRequest["location"]>().toEqualTypeOf<
      string | undefined
    >();
  });

  it("enforces min<=max only when both bounds are present", () => {
    expect(() =>
      createJobRequestSchema.parse(
        validRequest({ salary_min: 40000, salary_max: 25000 }),
      ),
    ).toThrow("salary_min must be less than or equal to salary_max");
    for (const partial of [
      { salary_min: 40000 },
      { salary_max: 25000 },
      { salary_min: 25000, salary_max: 25000 },
    ]) {
      expect(() => createJobRequestSchema.parse(validRequest(partial))).not.toThrow();
    }
  });

  it("strips immutable and unknown keys so they can never reach the wire payload", () => {
    const parsed = createJobRequestSchema.parse(
      validRequest({
        id: JOB_ID,
        company_id: COMPANY_ID,
        status: "published",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        published_at: "2026-01-01T00:00:00Z",
        search_vector: "'acme':1",
      }),
    );
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(BASE_REQUEST).sort());
  });

  it("types the request exactly as the implemented POST /jobs body", () => {
    expectTypeOf<CreateJobRequest["work_mode"]>().toEqualTypeOf<
      "onsite" | "remote" | "hybrid"
    >();
    expectTypeOf<CreateJobRequest["employment_type"]>().toEqualTypeOf<
      "full_time" | "part_time" | "contract" | "internship"
    >();
    expectTypeOf<CreateJobRequest["seniority"]>().toEqualTypeOf<
      "intern" | "junior" | "mid" | "senior" | "lead"
    >();
    expectTypeOf<CreateJobRequest["salary_currency"]>().toEqualTypeOf<
      "MXN" | "USD" | undefined
    >();
    expectTypeOf<CreateJobRequest["salary_min"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<CreateJobRequest["title"]>().toEqualTypeOf<string>();
  });
});

describe("own-enumerable request boundary", () => {
  it("does not let a required field inherited through the prototype satisfy the contract", () => {
    const inheritedRequired = Object.create({ ...BASE_REQUEST });
    // Nothing the contract requires is an own property of the input.
    expect(Object.keys(inheritedRequired)).toEqual([]);

    const result = createJobRequestSchema.safeParse(inheritedRequired);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.error.issues.map((issue) => issue.path.join(".")).sort(),
    ).toEqual(
      ["description", "employment_type", "seniority", "title", "work_mode"].sort(),
    );
  });

  it("never materializes inherited optional or prototype-only properties into the wire payload", () => {
    const input = Object.assign(
      Object.create({
        title: "inherited title",
        description: "inherited description",
        work_mode: "onsite",
        location: "CDMX",
        salary_min: 25000,
        salary_currency: "USD",
        status: "published",
        company_id: COMPANY_ID,
        screening_questions: [],
      }),
      BASE_REQUEST,
    );

    const parsed = createJobRequestSchema.parse(input);

    expect(Object.keys(parsed).sort()).toEqual(Object.keys(BASE_REQUEST).sort());
    for (const inherited of [
      "location",
      "salary_min",
      "salary_currency",
      "status",
      "company_id",
      "screening_questions",
    ]) {
      expect(Object.hasOwn(parsed, inherited)).toBe(false);
    }
    // The own property always wins over the shadowed prototype value.
    expect(parsed.title).toBe(BASE_REQUEST.title);
    const wire = JSON.stringify(parsed);
    for (const leaked of ["CDMX", "USD", "published", "company_id"]) {
      expect(wire).not.toContain(leaked);
    }
  });

  it("treats a two-level prototype chain and a non-enumerable own property as absent", () => {
    const grandparent = { location: "Guadalajara" };
    const parent = Object.create(grandparent) as { salary_currency: string };
    parent.salary_currency = "USD";
    const chained = Object.assign(Object.create(parent), BASE_REQUEST);

    const parsed = createJobRequestSchema.parse(chained);
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(BASE_REQUEST).sort());
    expect(JSON.stringify(parsed)).not.toContain("Guadalajara");

    // An own but non-enumerable required property is not part of the input.
    const hidden: Record<string, unknown> = { ...BASE_REQUEST };
    delete hidden.title;
    Object.defineProperty(hidden, "title", {
      value: "hidden title",
      enumerable: false,
    });
    expect(Object.keys(hidden)).not.toContain("title");
    const hiddenResult = createJobRequestSchema.safeParse(hidden);
    expect(hiddenResult.success).toBe(false);
    if (hiddenResult.success) return;
    // An absent key keeps the contract's own invalid_type/Required rejection.
    expect(hiddenResult.error.issues.map((issue) => issue.path.join("."))).toEqual([
      "title",
    ]);
    expect(hiddenResult.error.issues[0]?.code).toBe("invalid_type");
  });

  it("keeps validating every own enumerable property exactly as before", () => {
    expect(
      createJobRequestSchema.parse(
        Object.assign(Object.create({ location: "CDMX" }), BASE_REQUEST, {
          location: "Monterrey, NL",
          salary_min: 25000,
          salary_max: 40000,
        }),
      ),
    ).toEqual({
      ...BASE_REQUEST,
      location: "Monterrey, NL",
      salary_min: 25000,
      salary_max: 40000,
    });
  });
});

describe("job editor view schema", () => {
  it("accepts the 201 editor response with the nested company block and omitted nullable fields", () => {
    const parsed = jobEditorViewSchema.parse(validEditorView());
    expect(parsed).toEqual(BASE_EDITOR_VIEW);
    expect(parsed.company).toEqual({ id: COMPANY_ID, name: "Acme" });
    expect(parsed.status).toBe("draft");
    for (const omitted of [
      "location",
      "salary_min",
      "salary_max",
      "published_at",
    ] as const) {
      expect(parsed[omitted]).toBeUndefined();
    }
  });

  it("accepts every status, enum, integer, and RFC3339 timestamp the backend can emit", () => {
    for (const status of ["draft", "published", "closed"] as const) {
      expect(jobEditorViewSchema.parse(validEditorView({ status })).status).toBe(status);
    }
    expect(
      jobEditorViewSchema.parse(
        validEditorView({
          location: "CDMX",
          salary_min: 25000,
          salary_max: 40000,
          published_at: "2026-01-15T06:00:00-06:00",
          updated_at: "2026-02-01T10:00:00.123456789Z",
        }),
      ),
    ).toMatchObject({
      location: "CDMX",
      salary_min: 25000,
      salary_max: 40000,
      published_at: "2026-01-15T06:00:00-06:00",
    });
  });

  it("rejects null nullable fields, invalid enums, non-UUID ids, and offset-less timestamps", () => {
    for (const invalid of [
      validEditorView({ location: null }),
      validEditorView({ salary_min: null }),
      validEditorView({ salary_max: null }),
      validEditorView({ published_at: null }),
      validEditorView({ id: "not-a-uuid" }),
      validEditorView({ company: { id: "123", name: "Acme" } }),
      validEditorView({ company: { id: COMPANY_ID, name: "" } }),
      validEditorView({ title: "" }),
      validEditorView({ status: "archived" }),
      validEditorView({ status: undefined }),
      validEditorView({ work_mode: "telecommute" }),
      validEditorView({ employment_type: "freelance" }),
      validEditorView({ seniority: "principal" }),
      validEditorView({ salary_currency: "EUR" }),
      validEditorView({ salary_min: 2500.5 }),
      validEditorView({ updated_at: undefined }),
      validEditorView({ updated_at: "2026-02-01T10:00:00" }),
      validEditorView({ published_at: "ayer" }),
    ]) {
      expect(() => jobEditorViewSchema.parse(invalid)).toThrow();
    }
  });

  it("strips additive keys the editor view does not declare", () => {
    const parsed = jobEditorViewSchema.parse(
      validEditorView({
        created_at: "2026-01-01T00:00:00Z",
        deleted_at: null,
        search_vector: "'acme':1",
        company: { id: COMPANY_ID, name: "Acme", logo_url: "https://acme.mx/l.png" },
      }),
    );
    for (const stripped of ["created_at", "deleted_at", "search_vector"]) {
      expect(parsed).not.toHaveProperty(stripped);
    }
    expect(parsed.company).not.toHaveProperty("logo_url");
  });

  it("types the editor response status domain exactly", () => {
    expectTypeOf<JobEditorView["status"]>().toEqualTypeOf<
      "draft" | "published" | "closed"
    >();
    expectTypeOf<JobEditorView["updated_at"]>().toEqualTypeOf<string>();
    expectTypeOf<JobEditorView["company"]>().toEqualTypeOf<{ id: string; name: string }>();
    expectTypeOf<JobEditorView["published_at"]>().toEqualTypeOf<string | undefined>();
  });
});

describe("create job success schema", () => {
  it("accepts a created draft and narrows its status to draft", () => {
    const parsed = createJobSuccessSchema.parse(validEditorView());
    expect(parsed.status).toBe("draft");
    expect(parsed.published_at).toBeUndefined();
    expectTypeOf<z.infer<typeof createJobSuccessSchema>["status"]>().toEqualTypeOf<
      "draft"
    >();
  });

  it("rejects a 201 that is not a draft or that carries published_at", () => {
    for (const invalid of [
      validEditorView({ status: "published" }),
      validEditorView({ status: "closed" }),
      validEditorView({ published_at: "2026-01-15T12:00:00Z" }),
      validEditorView({ status: "published", published_at: "2026-01-15T12:00:00Z" }),
      validEditorView({ status: "closed", published_at: "2026-01-15T12:00:00Z" }),
    ]) {
      expect(() => createJobSuccessSchema.parse(invalid)).toThrow();
    }
  });

  it("keeps the generic editor schema valid for every status so future editor reads still work", () => {
    for (const status of ["draft", "published", "closed"] as const) {
      expect(jobEditorViewSchema.parse(validEditorView({ status })).status).toBe(status);
    }
    expect(
      jobEditorViewSchema.parse(
        validEditorView({ status: "published", published_at: "2026-01-15T12:00:00Z" }),
      ).published_at,
    ).toBe("2026-01-15T12:00:00Z");
  });
});

describe("api error envelope schema", () => {
  it("accepts the stable backend envelope with and without conflict data", () => {
    expect(apiErrorEnvelopeSchema.parse({ error: "unauthenticated", code: "unauthenticated" })).toEqual(
      { error: "unauthenticated", code: "unauthenticated" },
    );
    expect(
      apiErrorEnvelopeSchema.parse({
        error: "resource conflict",
        code: "conflict",
        data: { id: JOB_ID },
      }),
    ).toEqual({ error: "resource conflict", code: "conflict", data: { id: JOB_ID } });
  });

  it("rejects bodies that are not the backend envelope", () => {
    for (const invalid of [
      {},
      { error: "forbidden" },
      { code: "forbidden" },
      { error: "", code: "forbidden" },
      { error: "forbidden", code: "" },
      { error: 403, code: "forbidden" },
      null,
    ]) {
      expect(() => apiErrorEnvelopeSchema.parse(invalid)).toThrow();
    }
  });

  it("types the envelope fields", () => {
    expectTypeOf<ApiErrorEnvelope["code"]>().toEqualTypeOf<string>();
    expectTypeOf<ApiErrorEnvelope["data"]>().toEqualTypeOf<unknown>();
  });
});
