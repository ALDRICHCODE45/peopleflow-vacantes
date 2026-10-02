import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";

import { candidateIdentitySchema, candidateProfileSchema } from "@/features/candidate/model";
import { CANDIDATE_IDENTITY, CANDIDATE_PROFILE } from "@/features/candidate/prototype-candidate";
import {
  APPLICATION_CANDIDATE_FIELDS,
  APPLICATION_CANDIDATE_FIELD_IDS,
  APPLICATION_CANDIDATE_FIELD_LABELS,
  applicationCandidateDraftFromFixture,
  applicationCandidateInitials,
  parseApplicationCandidateDraft,
} from "./application-candidate-draft";
import type {
  ApplicationCandidateDraft,
  ApplicationCandidateDraftParseResult,
  ApplicationCandidateField,
} from "./application-candidate-draft";

const SOURCE = readFileSync(
  join(process.cwd(), "src", "features", "jobs", "application", "application-candidate-draft.ts"),
  "utf8",
);
/** Every module specifier the production module imports; the candidate model is the only allowed one. */
const specifiers = (): readonly string[] => [
  ...new Set([...SOURCE.matchAll(/from "([^"]+)"/gu)].map((match) => match[1])),
];

/** A valid raw draft seeded from the frozen fixture unless patched. */
const input = (patch: Partial<Record<(typeof APPLICATION_CANDIDATE_FIELDS)[number], string>> = {}) => ({
  ...applicationCandidateDraftFromFixture(CANDIDATE_IDENTITY, CANDIDATE_PROFILE),
  ...patch,
});

/** Parses a draft that must succeed and returns its normalized draft. */
function draftOf(
  patch: Partial<Record<(typeof APPLICATION_CANDIDATE_FIELDS)[number], string>> = {},
): ApplicationCandidateDraft {
  const result = parseApplicationCandidateDraft(input(patch));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.draft;
}

/** Parses a draft that must fail and returns its issues. */
function issuesOf(raw: unknown): readonly { readonly path: string; readonly message: string }[] {
  const result = parseApplicationCandidateDraft(raw);
  if (result.ok) throw new Error("expected validation issues");
  return result.issues;
}

/** Messages keyed by the single field they must blame. */
const messageOf = (
  patch: Partial<Record<(typeof APPLICATION_CANDIDATE_FIELDS)[number], string>>,
): string => {
  const issues = issuesOf(input(patch));
  expect(issues.map((issue) => issue.path)).toEqual([Object.keys(patch)[0]]);
  return issues[0].message;
};

describe("application candidate draft model", () => {
  it("keeps the exact ordered field vocabulary with Spanish labels and stable ids", () => {
    expect(APPLICATION_CANDIDATE_FIELDS).toEqual([
      "fullName",
      "email",
      "phone",
      "professionalTitle",
      "city",
      "country",
    ]);
    expect(APPLICATION_CANDIDATE_FIELD_LABELS).toEqual({
      fullName: "Nombre completo",
      email: "Correo electrónico",
      phone: "Teléfono",
      professionalTitle: "Título profesional",
      city: "Ciudad",
      country: "País",
    });
    const ids = APPLICATION_CANDIDATE_FIELDS.map((field) => APPLICATION_CANDIDATE_FIELD_IDS[field]);
    expect(ids.every((id) => id.startsWith("application-"))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(APPLICATION_CANDIDATE_FIELD_IDS.city).toBe("application-city");
  });

  it("seeds the six local strings from the frozen identity and profile without inventing values", () => {
    expect(applicationCandidateDraftFromFixture(CANDIDATE_IDENTITY, CANDIDATE_PROFILE)).toEqual({
      fullName: "Ximena Barrera",
      email: "ximena.barrera@correo.mx",
      phone: "+52 55 4821 7790",
      professionalTitle: "Desarrolladora Frontend Senior",
      city: "Ciudad de México",
      country: "México",
    });
    expect(
      applicationCandidateDraftFromFixture(CANDIDATE_IDENTITY, {
        phone: null,
        professionalTitle: null,
        city: null,
        country: null,
      }),
    ).toEqual({ ...applicationCandidateDraftFromFixture(CANDIDATE_IDENTITY, CANDIDATE_PROFILE), phone: "", professionalTitle: "", city: "", country: "" });
  });

  it("trims every field and lowercases the email on success", () => {
    const draft = draftOf({
      fullName: "  Ana López  ",
      email: "  ANA@Correo.MX  ",
      phone: "  +52 55 1111 2222  ",
      city: "  Guadalajara  ",
    });
    expect(draft.fullName).toBe("Ana López");
    expect(draft.email).toBe("ana@correo.mx");
    expect(draft.phone).toBe("+52 55 1111 2222");
    expect(draft.city).toBe("Guadalajara");
    expectTypeOf(parseApplicationCandidateDraft(input())).toEqualTypeOf<ApplicationCandidateDraftParseResult>();
  });

  it("requires a full name and an email, blaming exactly the empty field", () => {
    expect(messageOf({ fullName: "" })).toBe("El nombre completo es obligatorio.");
    expect(messageOf({ fullName: "   " })).toBe("El nombre completo es obligatorio.");
    expect(messageOf({ email: "" })).toBe("El correo electrónico es obligatorio.");
    expect(issuesOf({ ...input(), fullName: "", email: "" }).map((issue) => issue.path)).toEqual([
      "fullName",
      "email",
    ]);
  });

  it("accepts a two-character name and rejects one character or more than 120", () => {
    expect(draftOf({ fullName: "Xi" }).fullName).toBe("Xi");
    expect(messageOf({ fullName: "X" })).toBe("El nombre completo debe tener al menos 2 caracteres.");
    expect(draftOf({ fullName: "X".repeat(120) }).fullName).toHaveLength(120);
    expect(messageOf({ fullName: "X".repeat(121) })).toBe(
      "El nombre completo debe tener como máximo 120 caracteres.",
    );
  });

  it("rejects a malformed email and one longer than 160 characters", () => {
    expect(messageOf({ email: "ximena.correo.mx" })).toBe("El correo electrónico no es válido.");
    expect(messageOf({ email: "ximena@" })).toBe("El correo electrónico no es válido.");
    expect(messageOf({ email: `${"a".repeat(151)}@correo.mx` })).toBe(
      "El correo electrónico debe tener como máximo 160 caracteres.",
    );
  });

  it("keeps phone, title, city and country optional but bounded like the profile schema", () => {
    for (const field of ["phone", "professionalTitle", "city", "country"] as const) {
      expect(draftOf({ [field]: "" })[field]).toBe("");
      expect(draftOf({ [field]: "   " })[field]).toBe("");
    }
    expect(messageOf({ phone: "1234" })).toBe("El teléfono debe tener al menos 5 caracteres.");
    expect(draftOf({ phone: "12345" }).phone).toBe("12345");
    expect(draftOf({ phone: "1".repeat(30) }).phone).toHaveLength(30);
    expect(messageOf({ phone: "1".repeat(31) })).toBe("El teléfono debe tener como máximo 30 caracteres.");
    expect(draftOf({ professionalTitle: "T".repeat(120) }).professionalTitle).toHaveLength(120);
    expect(messageOf({ professionalTitle: "T".repeat(121) })).toBe(
      "El título profesional debe tener como máximo 120 caracteres.",
    );
    expect(messageOf({ city: "C".repeat(121) })).toBe("La ciudad debe tener como máximo 120 caracteres.");
    expect(messageOf({ country: "P".repeat(121) })).toBe("El país debe tener como máximo 120 caracteres.");
  });

  it("rejects a non-string value for any field instead of coercing it to empty", () => {
    const malformed: readonly [ApplicationCandidateField, unknown, string][] = [
      ["fullName", 42, "El nombre completo debe ser texto."],
      ["email", true, "El correo electrónico debe ser texto."],
      ["phone", 5_548_217_790, "El teléfono debe ser texto."],
      ["professionalTitle", 7, "El título profesional debe ser texto."],
      ["city", ["Guadalajara"], "La ciudad debe ser texto."],
      ["country", { name: "México" }, "El país debe ser texto."],
    ];
    for (const [field, value, message] of malformed) {
      const raw: Record<string, unknown> = { ...input() };
      raw[field] = value;
      expect(issuesOf(raw)).toEqual([{ path: field, message }]);
    }
    // A numeric phone is a type error, never an accepted "unset" value.
    expect(parseApplicationCandidateDraft({ ...input(), phone: 12345 }).ok).toBe(false);
  });

  it("keeps an explicit null or a missing optional field as the empty-string unset", () => {
    const result = parseApplicationCandidateDraft({ ...input(), phone: null, city: undefined });
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.draft.phone).toBe("");
    expect(result.draft.city).toBe("");
    expect(parseApplicationCandidateDraft({ ...input(), fullName: null }).ok).toBe(false);
  });

  it("mirrors the candidate model acceptance boundary field by field", () => {
    const modelAccepts = {
      fullName: (value: string) =>
        candidateIdentitySchema.safeParse({ ...CANDIDATE_IDENTITY, fullName: value }).success,
      email: (value: string) =>
        candidateIdentitySchema.safeParse({ ...CANDIDATE_IDENTITY, email: value }).success,
      phone: (value: string) =>
        candidateProfileSchema.safeParse({
          ...CANDIDATE_PROFILE,
          phone: value.trim() === "" ? null : value,
        }).success,
      professionalTitle: (value: string) =>
        candidateProfileSchema.safeParse({
          ...CANDIDATE_PROFILE,
          professionalTitle: value.trim() === "" ? null : value,
        }).success,
      city: (value: string) =>
        candidateProfileSchema.safeParse({
          ...CANDIDATE_PROFILE,
          city: value.trim() === "" ? null : value,
        }).success,
      country: (value: string) =>
        candidateProfileSchema.safeParse({
          ...CANDIDATE_PROFILE,
          country: value.trim() === "" ? null : value,
        }).success,
    };
    const samples: Record<(typeof APPLICATION_CANDIDATE_FIELDS)[number], readonly string[]> = {
      fullName: ["", "X", "Xi", "X".repeat(120), "X".repeat(121)],
      email: ["", "X", "ximena.correo.mx", "ximena@correo.mx", `${"a".repeat(150)}@correo.mx`],
      phone: ["", "1234", "12345", "1".repeat(30), "1".repeat(31)],
      professionalTitle: ["", "T".repeat(120), "T".repeat(121)],
      city: ["", "C".repeat(120), "C".repeat(121)],
      country: ["", "P".repeat(120), "P".repeat(121)],
    };
    for (const field of APPLICATION_CANDIDATE_FIELDS) {
      for (const value of samples[field]) {
        const draftAccepts = parseApplicationCandidateDraft(input({ [field]: value })).ok;
        expect({ field, value: value.length, draftAccepts }).toEqual({
          field,
          value: value.length,
          draftAccepts: modelAccepts[field](value),
        });
      }
    }
  });

  it("rejects unknown keys and non-object drafts instead of guessing", () => {
    expect(parseApplicationCandidateDraft({ ...input(), extra: "x" }).ok).toBe(false);
    expect(parseApplicationCandidateDraft(null).ok).toBe(false);
    expect(parseApplicationCandidateDraft(undefined).ok).toBe(false);
    expect(parseApplicationCandidateDraft("ximena").ok).toBe(false);
    expect(parseApplicationCandidateDraft(7).ok).toBe(false);
  });

  it("builds deterministic initials, falling back to a neutral mark for a blank name", () => {
    expect(applicationCandidateInitials("Ximena Barrera")).toBe("XB");
    expect(applicationCandidateInitials("  ximena   barrera  ")).toBe("XB");
    expect(applicationCandidateInitials("ana lópez garcía")).toBe("AL");
    expect(applicationCandidateInitials("Ximena")).toBe("X");
    expect(applicationCandidateInitials("")).toBe("?");
    expect(applicationCandidateInitials("   ")).toBe("?");
  });

  it("stays free of React, transport, storage, browser, timer and fixture coupling", () => {
    expect(specifiers()).toEqual(["@/features/candidate/model"]);
    expect(SOURCE).not.toMatch(/prototype-candidate|public\/|CANDIDATE_IDENTITY|CANDIDATE_PROFILE/u);
    expect(SOURCE).not.toMatch(/import[^\n]*\breact\b|"use client"|useState|useRef|useEffect/u);
    for (const pattern of [
      /fetch\(|XMLHttpRequest|axios/u,
      /localStorage|sessionStorage|indexedDB/u,
      /document\.|window\.|navigator\.|next\/navigation|useRouter/u,
      /setTimeout|setInterval|Math\.random|Date\.now|new Date\(|randomUUID/u,
    ]) {
      expect(SOURCE).not.toMatch(pattern);
    }
  });
});
