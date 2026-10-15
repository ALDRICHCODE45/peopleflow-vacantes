import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  CONTRACT_TYPES,
  draftContractTypeSchema,
  draftLocationSchema,
  draftPreferredRequirementsSchema,
  draftProfessionalAreaSchema,
  draftRequiredRequirementsSchema,
  draftScalarFieldSchemas,
  draftSenioritySchema,
  draftTitleSchema,
  draftWorkModeSchema,
  draftWorkScheduleSchema,
  PROFESSIONAL_AREAS,
  SENIORITIES,
  WORK_MODES,
  WORK_SCHEDULES,
  type DraftScalarField,
} from "./scalars";

const ok = (schema: z.ZodTypeAny, input: unknown) => schema.safeParse(input).success;
const out = (schema: z.ZodTypeAny, input: unknown) => schema.parse(input);
const padded = (value: string) => ` ${value} `;

/** U+1F600: 1 codepoint, 2 UTF-16 units, 4 UTF-8 bytes. */
const ASTRAL = String.fromCodePoint(0x1f600);
/** U+00E9: 1 codepoint, 2 UTF-8 bytes. */
const TWO_BYTE = "\u00e9";

/** Exact Unicode White_Space set, written independently of the implementation. */
const WHITE_SPACE_CODE_POINTS = [
  0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x0085, 0x00a0, 0x1680, 0x2000, 0x2001,
  0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029,
  0x202f, 0x205f, 0x3000,
];

describe("draft scalar literal catalogs", () => {
  it("pins the exact contract catalogs, including all 16 professional areas", () => {
    expect(WORK_MODES).toEqual(["onsite", "remote", "hybrid"]);
    expect(WORK_SCHEDULES).toEqual(["full_time", "part_time"]);
    expect(CONTRACT_TYPES).toEqual([
      "project",
      "indefinite",
      "professional_services",
      "temporary",
      "internship",
    ]);
    expect(SENIORITIES).toEqual(["intern", "junior", "mid", "senior", "lead"]);
    expect(PROFESSIONAL_AREAS).toHaveLength(16);
    expect(PROFESSIONAL_AREAS).toEqual([
      "technology_systems",
      "engineering",
      "product",
      "design_creative",
      "sales_business_development",
      "marketing_communications",
      "administration_finance",
      "human_resources",
      "operations_production",
      "logistics_transport",
      "customer_service_support",
      "healthcare",
      "education_training",
      "legal",
      "construction_maintenance",
      "tourism_hospitality_gastronomy",
    ]);
  });
});

describe("draft scalar schemas reject undefined and non-strings except null", () => {
  it.each([
    ["title", draftTitleSchema],
    ["location", draftLocationSchema],
    ["work_mode", draftWorkModeSchema],
    ["work_schedule", draftWorkScheduleSchema],
    ["contract_type", draftContractTypeSchema],
    ["seniority", draftSenioritySchema],
    ["professional_area", draftProfessionalAreaSchema],
    ["required_requirements", draftRequiredRequirementsSchema],
    ["preferred_requirements", draftPreferredRequirementsSchema],
  ])("%s rejects undefined, numbers, booleans, objects and arrays but accepts null", (_, schema) => {
    expect(ok(schema, null)).toBe(true);
    expect(out(schema, null)).toBeNull();
    for (const invalid of [undefined, 0, 1, true, false, {}, [], ["onsite"], { title: "a" }]) {
      expect(ok(schema, invalid)).toBe(false);
    }
  });
});

describe("draft text trimming and null normalization", () => {
  it.each(WHITE_SPACE_CODE_POINTS)(
    "trims U+%s at both ends and keeps the interior text",
    (codePoint) => {
      const ws = String.fromCodePoint(codePoint);
      expect(out(draftTitleSchema, `${ws}a${ws}`)).toBe("a");
      expect(out(draftTitleSchema, `${ws}${ws}`)).toBeNull();
      expect(out(draftTitleSchema, `${ws}a b${ws}`)).toBe("a b");
    },
  );

  it("treats NBSP, U+3000 and U+0085 as trimmable White_Space", () => {
    expect(out(draftLocationSchema, "\u00a0a\u00a0")).toBe("a");
    expect(out(draftLocationSchema, "\u3000a\u3000")).toBe("a");
    expect(out(draftLocationSchema, "\u0085a\u0085")).toBe("a");
  });

  it("does not trim U+FEFF, which is not Unicode White_Space", () => {
    expect(out(draftTitleSchema, "\ufeffa\ufeff")).toBe("\ufeffa\ufeff");
    expect(out(draftTitleSchema, "\ufeff")).toBe("\ufeff");
    expect(out(draftTitleSchema, "\ufeff")).not.toBeNull();
  });

  it("preserves zero-width characters and interior, non-end whitespace verbatim", () => {
    expect(out(draftTitleSchema, "\u200ba\u200b")).toBe("\u200ba\u200b");
    expect(out(draftTitleSchema, "\u200dmid\u200d")).toBe("\u200dmid\u200d");
    expect(out(draftTitleSchema, "a\u00a0b")).toBe("a\u00a0b");
    expect(out(draftTitleSchema, "a\nb\tc")).toBe("a\nb\tc");
    expect(out(draftTitleSchema, "  a  b  ")).toBe("a  b");
  });

  it("preserves decomposed sequences and never applies NFC", () => {
    expect(out(draftTitleSchema, "e\u0301")).toBe("e\u0301");
    expect(out(draftTitleSchema, "e\u0301")).not.toBe("\u00e9");
    expect(out(draftLocationSchema, "\u00e1rea")).toBe("\u00e1rea");
  });

  it("maps empty and whitespace-only strings to null", () => {
    for (const input of ["", " ", "\t\n", "\u00a0", "\u3000\u2028", "\r\v\f"]) {
      expect(out(draftTitleSchema, input)).toBeNull();
      expect(out(draftRequiredRequirementsSchema, input)).toBeNull();
    }
  });
});

describe("draft text character limits count codepoints after trimming", () => {
  it("bounds title at 200 codepoints after trimming", () => {
    expect(ok(draftTitleSchema, "a".repeat(200))).toBe(true);
    expect(ok(draftTitleSchema, "a".repeat(201))).toBe(false);
    expect(out(draftTitleSchema, padded("a".repeat(200)))).toBe("a".repeat(200));
    expect(ok(draftTitleSchema, padded("a".repeat(201)))).toBe(false);
  });

  it("counts astral codepoints as one, not UTF-16 units", () => {
    expect(ASTRAL.repeat(200).length).toBe(400);
    expect(ok(draftTitleSchema, ASTRAL.repeat(200))).toBe(true);
    expect(ok(draftTitleSchema, ASTRAL.repeat(201))).toBe(false);
  });

  it("bounds location at 300 codepoints, including astral input", () => {
    expect(ok(draftLocationSchema, "a".repeat(300))).toBe(true);
    expect(ok(draftLocationSchema, "a".repeat(301))).toBe(false);
    expect(ok(draftLocationSchema, ASTRAL.repeat(300))).toBe(true);
    expect(ok(draftLocationSchema, ASTRAL.repeat(301))).toBe(false);
  });
});

describe("draft requirement limits count UTF-8 bytes after trimming", () => {
  it.each([
    ["ASCII 16384", "a".repeat(16384), "a".repeat(16385)],
    ["two-byte 8192", TWO_BYTE.repeat(8192), TWO_BYTE.repeat(8193)],
    ["four-byte 4096", ASTRAL.repeat(4096), ASTRAL.repeat(4097)],
  ])("bounds both requirement fields by %s", (_, accepted, rejected) => {
    for (const schema of [draftRequiredRequirementsSchema, draftPreferredRequirementsSchema]) {
      expect(ok(schema, accepted)).toBe(true);
      expect(ok(schema, rejected)).toBe(false);
      expect(ok(schema, padded(accepted))).toBe(true);
      expect(ok(schema, padded(rejected))).toBe(false);
    }
  });
});

describe("draft scalar enums are exact, nullable and uncoerced", () => {
  it("accepts every literal plus null without trimming or defaults", () => {
    for (const mode of WORK_MODES) {
      expect(out(draftWorkModeSchema, mode)).toBe(mode);
    }
    for (const schedule of WORK_SCHEDULES) {
      expect(out(draftWorkScheduleSchema, schedule)).toBe(schedule);
    }
    for (const contract of CONTRACT_TYPES) {
      expect(out(draftContractTypeSchema, contract)).toBe(contract);
    }
    for (const seniority of SENIORITIES) {
      expect(out(draftSenioritySchema, seniority)).toBe(seniority);
    }
    for (const area of PROFESSIONAL_AREAS) {
      expect(out(draftProfessionalAreaSchema, area)).toBe(area);
    }
    expect(out(draftWorkModeSchema, null)).toBeNull();
    expect(out(draftProfessionalAreaSchema, null)).toBeNull();
  });

  it.each([
    [draftWorkModeSchema, "Onsite"],
    [draftWorkModeSchema, "REMOTE"],
    [draftWorkModeSchema, "onsite "],
    [draftWorkModeSchema, ""],
    [draftWorkScheduleSchema, "fulltime"],
    [draftWorkScheduleSchema, "Full_Time"],
    [draftWorkScheduleSchema, "full_time "],
    [draftContractTypeSchema, "permanent"],
    [draftContractTypeSchema, "PROJECT"],
    [draftContractTypeSchema, ""],
    [draftSenioritySchema, "principal"],
    [draftSenioritySchema, "Mid"],
    [draftProfessionalAreaSchema, "Technology_Systems"],
    [draftProfessionalAreaSchema, "it"],
    [draftProfessionalAreaSchema, "technology_systems "],
    [draftProfessionalAreaSchema, ""],
  ])("rejects %j as an exact enum value", (schema, value) => {
    expect(ok(schema, value)).toBe(false);
  });

  it("accepts every published professional area and nothing more", () => {
    for (const area of PROFESSIONAL_AREAS) {
      expect(ok(draftProfessionalAreaSchema, area)).toBe(true);
    }
    expect(ok(draftProfessionalAreaSchema, "other")).toBe(false);
  });
});

describe("draftScalarFieldSchemas map", () => {
  it("exposes exactly the nine contract scalar fields", () => {
    expect(Object.keys(draftScalarFieldSchemas).sort()).toEqual([
      "contract_type",
      "location",
      "preferred_requirements",
      "professional_area",
      "required_requirements",
      "seniority",
      "title",
      "work_mode",
      "work_schedule",
    ]);
  });

  it("maps each field to a schema that rejects undefined and non-strings", () => {
    for (const schema of Object.values(draftScalarFieldSchemas)) {
      expect(ok(schema, undefined)).toBe(false);
      expect(ok(schema, 1)).toBe(false);
      expect(ok(schema, {})).toBe(false);
      expect(ok(schema, null)).toBe(true);
    }
  });
});

describe("draft scalar types", () => {
  it("keeps text input and output as nullable strings", () => {
    expectTypeOf<z.input<typeof draftTitleSchema>>().toEqualTypeOf<string | null>();
    expectTypeOf<z.output<typeof draftTitleSchema>>().toEqualTypeOf<string | null>();
    expectTypeOf<z.input<typeof draftRequiredRequirementsSchema>>().toEqualTypeOf<string | null>();
    expectTypeOf<z.output<typeof draftRequiredRequirementsSchema>>().toEqualTypeOf<string | null>();
  });

  it("types enum output as the exact literal union or null", () => {
    expectTypeOf<z.output<typeof draftWorkModeSchema>>().toEqualTypeOf<
      (typeof WORK_MODES)[number] | null
    >();
    expectTypeOf<z.output<typeof draftProfessionalAreaSchema>>().toEqualTypeOf<
      (typeof PROFESSIONAL_AREAS)[number] | null
    >();
    expectTypeOf<DraftScalarField>().toEqualTypeOf<
      | "title"
      | "location"
      | "work_mode"
      | "work_schedule"
      | "contract_type"
      | "seniority"
      | "professional_area"
      | "required_requirements"
      | "preferred_requirements"
    >();
  });
});
