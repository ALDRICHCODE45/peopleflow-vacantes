import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";

import { createJobRequestSchema } from "../schemas";
import {
  BENEFIT_OPTIONS,
  CEFR_LEVEL_OPTIONS,
  DEPARTMENTS,
  INITIAL_PROTOTYPE_VALUES,
  LANGUAGES,
  MAX_LANGUAGES,
  MAX_SCREENING_QUESTIONS,
  MAX_SKILLS,
  PAY_FREQUENCY_OPTIONS,
  SKILLS,
  addLanguageRequirement,
  addScreeningQuestion,
  removeLanguageRequirement,
  removeScreeningQuestion,
  updateLanguageRequirement,
  updateScreeningQuestion,
} from "./prototype-model";
import type {
  BenefitKey,
  CefrLevel,
  LanguageRequirement,
  PayFrequency,
  ScreeningQuestion,
  VacancyPrototypeValues,
} from "./prototype-model";
import type { VacancyFormValues } from "./model";

/** Every key the local-only prototype owns, in camel and snake spelling. */
const PROTOTYPE_ONLY_KEYS = [
  "department",
  "skills",
  "languages",
  "benefits",
  "payFrequency",
  "pay_frequency",
  "requiredRequirements",
  "required_requirements",
  "preferredRequirements",
  "preferred_requirements",
  "screeningQuestions",
  "screening_questions",
  "closingDate",
  "closing_date",
  "descriptionRich",
  "description_rich",
] as const;

/** The nine keys `POST /jobs` accepts: the complete wire contract, nothing else. */
const REQUEST_KEYS = [
  "title",
  "description",
  "work_mode",
  "employment_type",
  "seniority",
  "location",
  "salary_min",
  "salary_max",
  "salary_currency",
] as const;

/** Minimal body that satisfies every required request field. */
const BASE_REQUEST = {
  title: "Backend Developer (Senior)",
  description: "Diseñá los servicios core.",
  work_mode: "remote",
  employment_type: "full_time",
  seniority: "senior",
};

const createDir = join(process.cwd(), "src", "features", "jobs", "create");
const formDir = join(createDir, "form");
const prototypeSource = readFileSync(join(formDir, "prototype-model.ts"), "utf8");

const spanish: LanguageRequirement = {
  id: "lang-es",
  language: "Español",
  level: "C2",
};
const english: LanguageRequirement = {
  id: "lang-en",
  language: "Inglés",
  level: "B2",
};
const portuguese: LanguageRequirement = {
  id: "lang-pt",
  language: "Portugués",
  level: "B1",
};
const french: LanguageRequirement = {
  id: "lang-fr",
  language: "Francés",
  level: "A2",
};

const firstQuestion: ScreeningQuestion = {
  id: "question-1",
  prompt: "¿Cuántos años de experiencia tenés con React?",
};
const secondQuestion: ScreeningQuestion = {
  id: "question-2",
  prompt: "¿Trabajaste antes en equipos distribuidos?",
};

describe("prototype catalogs", () => {
  it("declares the six CEFR levels in order with useful Spanish labels", () => {
    expect(CEFR_LEVEL_OPTIONS.map((option) => option.value)).toEqual([
      "A1",
      "A2",
      "B1",
      "B2",
      "C1",
      "C2",
    ]);
    for (const option of CEFR_LEVEL_OPTIONS) {
      expect(option.label.trim().length).toBeGreaterThan(0);
    }
    expect(new Set(CEFR_LEVEL_OPTIONS.map((option) => option.label)).size).toBe(6);
  });

  it("declares pay frequency with the exact required Spanish labels", () => {
    expect(PAY_FREQUENCY_OPTIONS.map((option) => option.value)).toEqual([
      "monthly",
      "yearly",
      "hourly",
    ]);
    expect(
      Object.fromEntries(
        PAY_FREQUENCY_OPTIONS.map((option) => [option.value, option.label]),
      ),
    ).toEqual({
      monthly: "Mensual",
      yearly: "Anual",
      hourly: "Por hora",
    });
  });

  it("declares every benefit key with a Spanish label", () => {
    expect(BENEFIT_OPTIONS.map((option) => option.value)).toEqual([
      "health_insurance",
      "computer_equipment",
      "flexible_schedule",
      "remote_stipend",
      "training_budget",
      "extra_time_off",
      "wellness",
      "annual_bonus",
    ]);
    for (const option of BENEFIT_OPTIONS) {
      expect(option.label.trim().length).toBeGreaterThan(0);
    }
    expect(new Set(BENEFIT_OPTIONS.map((option) => option.label)).size).toBe(8);
  });

  it("declares the fixed department, skill, and language catalogs", () => {
    expect(DEPARTMENTS).toEqual([
      "Ingeniería",
      "Producto",
      "Diseño",
      "Ventas",
      "Marketing",
      "Operaciones",
      "Personas",
      "Finanzas",
      "Soporte al cliente",
    ]);
    expect(SKILLS).toEqual([
      "React",
      "TypeScript",
      "Node.js",
      "Next.js",
      "PostgreSQL",
      "AWS",
      "Docker",
      "Kubernetes",
      "GraphQL",
      "Liderazgo",
      "Comunicación",
      "Product discovery",
    ]);
    expect(LANGUAGES).toEqual([
      "Español",
      "Inglés",
      "Portugués",
      "Francés",
      "Alemán",
    ]);
  });

  it("exposes the prototype limits and allows zero screening questions", () => {
    expect(MAX_SKILLS).toBe(10);
    expect(MAX_LANGUAGES).toBe(3);
    expect(MAX_SCREENING_QUESTIONS).toBe(3);
    // Zero is a valid configuration, so the limit is a ceiling, not a floor.
    expect(addScreeningQuestion([], firstQuestion)).toEqual([firstQuestion]);
  });

  it("types the prototype model exactly", () => {
    expectTypeOf<CefrLevel>().toEqualTypeOf<
      "A1" | "A2" | "B1" | "B2" | "C1" | "C2"
    >();
    expectTypeOf<PayFrequency>().toEqualTypeOf<
      "monthly" | "yearly" | "hourly"
    >();
    expectTypeOf<BenefitKey>().toEqualTypeOf<
      | "health_insurance"
      | "computer_equipment"
      | "flexible_schedule"
      | "remote_stipend"
      | "training_budget"
      | "extra_time_off"
      | "wellness"
      | "annual_bonus"
    >();
    expectTypeOf<LanguageRequirement>().toEqualTypeOf<{
      id: string;
      language: string;
      level: CefrLevel | "";
    }>();
    expectTypeOf<ScreeningQuestion>().toEqualTypeOf<{
      id: string;
      prompt: string;
    }>();
  });

  it("declares exactly the ten prototype fields with no contract alias", () => {
    expect(Object.keys(INITIAL_PROTOTYPE_VALUES).sort()).toEqual([
      "benefits",
      "closingDate",
      "department",
      "descriptionRich",
      "languages",
      "payFrequency",
      "preferredRequirements",
      "requiredRequirements",
      "screeningQuestions",
      "skills",
    ]);
    expectTypeOf<VacancyPrototypeValues["department"]>().toEqualTypeOf<string>();
    expectTypeOf<VacancyPrototypeValues["skills"]>().toEqualTypeOf<string[]>();
    expectTypeOf<VacancyPrototypeValues["languages"]>().toEqualTypeOf<
      LanguageRequirement[]
    >();
    expectTypeOf<VacancyPrototypeValues["benefits"]>().toEqualTypeOf<
      BenefitKey[]
    >();
    expectTypeOf<VacancyPrototypeValues["payFrequency"]>().toEqualTypeOf<
      PayFrequency | ""
    >();
    expectTypeOf<
      VacancyPrototypeValues["requiredRequirements"]
    >().toEqualTypeOf<string>();
    expectTypeOf<
      VacancyPrototypeValues["preferredRequirements"]
    >().toEqualTypeOf<string>();
    expectTypeOf<
      VacancyPrototypeValues["screeningQuestions"]
    >().toEqualTypeOf<ScreeningQuestion[]>();
    expectTypeOf<VacancyPrototypeValues["closingDate"]>().toEqualTypeOf<string>();
    // The tokenized rich description stays local-only; the contract keeps the
    // derived plain `description`.
    expectTypeOf<VacancyPrototypeValues["descriptionRich"]>().toEqualTypeOf<string>();

    // The prototype is a separate shape: it shares no key with the API form.
    type SharedKeys = Extract<
      keyof VacancyPrototypeValues,
      keyof VacancyFormValues
    >;
    expectTypeOf<SharedKeys>().toEqualTypeOf<never>();
  });

  it("starts from an entirely empty prototype state", () => {
    expect(INITIAL_PROTOTYPE_VALUES).toEqual({
      department: "",
      skills: [],
      languages: [],
      benefits: [],
      payFrequency: "",
      requiredRequirements: "",
      preferredRequirements: "",
      screeningQuestions: [],
      closingDate: "",
      descriptionRich: "",
    });
    expect(INITIAL_PROTOTYPE_VALUES.languages).toHaveLength(0);
    expect(INITIAL_PROTOTYPE_VALUES.screeningQuestions).toHaveLength(0);
  });
});

describe("prototype language helpers", () => {
  it("appends a caller-provided language without mutating or reordering the input", () => {
    const base = [spanish, english];
    const next = addLanguageRequirement(base, portuguese);

    expect(base).toEqual([spanish, english]);
    expect(next).toEqual([spanish, english, portuguese]);
    expect(next).not.toBe(base);
    // Every existing entry keeps its identity, so React keys stay stable.
    expect(next[0]).toBe(spanish);
    expect(next[1]).toBe(english);
    expect(next[2]).toBe(portuguese);
  });

  it("returns the original array unchanged once the language limit is reached", () => {
    const atLimit = [spanish, english, portuguese];
    const next = addLanguageRequirement(atLimit, french);

    expect(next).toBe(atLimit);
    expect(next).toHaveLength(MAX_LANGUAGES);
    expect(next).toEqual([spanish, english, portuguese]);
  });

  it("updates one language by id preserving order, identity, and unknown ids", () => {
    const base = [spanish, english];
    const updated = updateLanguageRequirement(base, "lang-en", { level: "C1" });

    expect(base[1]).toBe(english);
    expect(updated).not.toBe(base);
    expect(updated[0]).toBe(spanish);
    expect(updated[1]).not.toBe(english);
    expect(updated[1]).toEqual({
      id: "lang-en",
      language: "Inglés",
      level: "C1",
    });
    expect(updated.map((language) => language.id)).toEqual([
      "lang-es",
      "lang-en",
    ]);

    // An unknown id changes nothing at all.
    expect(updateLanguageRequirement(base, "lang-de", { level: "C2" })).toBe(
      base,
    );
  });

  it("removes one language by id preserving order and ignoring unknown ids", () => {
    const base = [spanish, english, portuguese];
    const next = removeLanguageRequirement(base, "lang-en");

    expect(base).toHaveLength(3);
    expect(next).toEqual([spanish, portuguese]);
    expect(next[0]).toBe(spanish);
    expect(next[1]).toBe(portuguese);
    expect(removeLanguageRequirement(base, "lang-de")).toBe(base);
  });
});

describe("prototype screening-question helpers", () => {
  it("appends a caller-provided question without mutating the input", () => {
    const base = [firstQuestion];
    const next = addScreeningQuestion(base, secondQuestion);

    expect(base).toEqual([firstQuestion]);
    expect(next).toEqual([firstQuestion, secondQuestion]);
    expect(next[0]).toBe(firstQuestion);
    expect(next[1]).toBe(secondQuestion);
  });

  it("returns the original array unchanged once the question limit is reached", () => {
    const thirdQuestion: ScreeningQuestion = {
      id: "question-3",
      prompt: "¿Tenés disponibilidad para viajar?",
    };
    const fourthQuestion: ScreeningQuestion = {
      id: "question-4",
      prompt: "¿Cuál es tu expectativa salarial?",
    };
    const atLimit = [firstQuestion, secondQuestion, thirdQuestion];
    const next = addScreeningQuestion(atLimit, fourthQuestion);

    expect(next).toBe(atLimit);
    expect(next).toHaveLength(MAX_SCREENING_QUESTIONS);
  });

  it("updates and removes one question by id, ignoring unknown ids", () => {
    const base = [firstQuestion, secondQuestion];
    const updated = updateScreeningQuestion(base, "question-1", {
      prompt: "¿Cuántos años de experiencia tenés con TypeScript?",
    });

    expect(base[0]).toBe(firstQuestion);
    expect(updated[0]).not.toBe(firstQuestion);
    expect(updated[0]).toEqual({
      id: "question-1",
      prompt: "¿Cuántos años de experiencia tenés con TypeScript?",
    });
    expect(updated[1]).toBe(secondQuestion);

    expect(updateScreeningQuestion(base, "question-9", { prompt: "x" })).toBe(
      base,
    );

    const next = removeScreeningQuestion(base, "question-2");
    expect(base).toHaveLength(2);
    expect(next).toEqual([firstQuestion]);
    expect(next[0]).toBe(firstQuestion);
    expect(removeScreeningQuestion(base, "question-9")).toBe(base);
  });
});

describe("prototype state cannot reach the API request boundary", () => {
  it("strips every prototype-only key and returns exactly the nine request keys", () => {
    const parsed = createJobRequestSchema.parse({
      title: "Backend Developer (Senior)",
      description: "Diseñá los servicios core.",
      work_mode: "remote",
      employment_type: "full_time",
      seniority: "senior",
      location: "Monterrey, NL",
      salary_min: 25000,
      salary_max: 40000,
      salary_currency: "MXN",
      department: "Ingeniería",
      skills: ["React", "TypeScript"],
      languages: [{ id: "lang-en", language: "Inglés", level: "C1" }],
      benefits: ["health_insurance", "annual_bonus"],
      payFrequency: "monthly",
      pay_frequency: "monthly",
      requiredRequirements: "5 años de experiencia.",
      required_requirements: "5 años de experiencia.",
      preferredRequirements: "Next.js y PostgreSQL.",
      preferred_requirements: "Next.js y PostgreSQL.",
      screeningQuestions: [{ id: "question-1", prompt: "¿Experiencia con AWS?" }],
      screening_questions: [{ id: "question-1", prompt: "¿Experiencia con AWS?" }],
      closingDate: "2026-12-31",
      closing_date: "2026-12-31",
    });

    expect(Object.keys(parsed).sort()).toEqual([...REQUEST_KEYS].sort());
    for (const key of PROTOTYPE_ONLY_KEYS) {
      expect(Object.hasOwn(parsed, key)).toBe(false);
    }

    const wire = JSON.stringify(parsed);
    for (const key of PROTOTYPE_ONLY_KEYS) {
      expect(wire).not.toContain(key);
    }
  });

  it("keeps prototype values out of the wire payload even as an empty state", () => {
    const parsed = createJobRequestSchema.parse({
      title: "Backend Developer",
      description: "Diseñá los servicios core.",
      work_mode: "onsite",
      employment_type: "contract",
      seniority: "mid",
      ...INITIAL_PROTOTYPE_VALUES,
    });

    expect(Object.keys(parsed).sort()).toEqual(
      [
        "title",
        "description",
        "work_mode",
        "employment_type",
        "seniority",
      ].sort(),
    );
  });
});

/**
 * Regression guard for the other direction of the boundary: the local-only
 * prototype must not have loosened the write contract. These assertions pin
 * behavior that existed before the prototype pass, so they fail if a future
 * change routes prototype state through the request schema.
 */
describe("write contract stays unchanged by the prototype pass", () => {
  it("still normalizes and strips explicit-null optionals", () => {
    const parsed = createJobRequestSchema.parse({
      ...BASE_REQUEST,
      location: null,
      salary_min: null,
      salary_max: null,
      salary_currency: null,
    });

    for (const omitted of [
      "location",
      "salary_min",
      "salary_max",
      "salary_currency",
    ] as const) {
      expect(Object.hasOwn(parsed, omitted)).toBe(false);
    }
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(BASE_REQUEST).sort());
    expect(JSON.stringify(parsed)).not.toContain("null");

    // A null bound never invalidates the other, still-present bound.
    expect(
      createJobRequestSchema.parse({
        ...BASE_REQUEST,
        salary_min: null,
        salary_max: 25000,
      }),
    ).toEqual({ ...BASE_REQUEST, salary_max: 25000 });
  });

  it("still rejects every unsupported enum value", () => {
    for (const [field, value] of [
      ["work_mode", "telecommute"],
      ["work_mode", "remote "],
      ["employment_type", "freelance"],
      ["seniority", "principal"],
      ["salary_currency", "EUR"],
      ["salary_currency", "mxn"],
    ] as const) {
      expect(() =>
        createJobRequestSchema.parse({ ...BASE_REQUEST, [field]: value }),
      ).toThrow();
    }
  });

  it("still rejects a minimum salary above the maximum", () => {
    expect(() =>
      createJobRequestSchema.parse({
        ...BASE_REQUEST,
        salary_min: 40000,
        salary_max: 25000,
      }),
    ).toThrow("salary_min must be less than or equal to salary_max");

    // An equal pair stays valid, so the guard is a range check, not a strict one.
    expect(
      createJobRequestSchema.parse({
        ...BASE_REQUEST,
        salary_min: 25000,
        salary_max: 25000,
      }),
    ).toMatchObject({ salary_min: 25000, salary_max: 25000 });
  });
});

describe("prototype model source boundary", () => {
  it("imports no schema, client, transport, or contract-form module", () => {
    // A local-only model has no dependency at all: nothing can leak inward.
    expect(prototypeSource).not.toMatch(/^import\s/mu);
    expect(prototypeSource).not.toMatch(
      /schemas|createJob|requestJson|lib\/api|lib\/env/,
    );
    expect(prototypeSource).not.toMatch(/form\/model|from "\.\/model"/);
    expect(prototypeSource).not.toMatch(
      /zod|\bz\.object|createJobRequestSchema|VacancyFormValues|VacancyPreview/,
    );
  });

  it("never generates identifiers at runtime", () => {
    expect(prototypeSource).not.toMatch(
      /randomUUID|Math\.random|Date\.now|nanoid|crypto/,
    );
  });

  it("stays unreachable from the contract form model and the create client", () => {
    const formModel = readFileSync(join(formDir, "model.ts"), "utf8");
    expect(formModel).not.toMatch(
      /prototype-model|prototypeModel|VacancyPrototypeValues|PrototypeValues/,
    );

    const createJob = readFileSync(join(createDir, "createJob.ts"), "utf8");
    for (const key of PROTOTYPE_ONLY_KEYS) {
      expect(createJob).not.toContain(key);
    }
  });
});
