import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import { PROTOTYPE_COMPANY_ID } from "../company-profile/model";
import type { CompanyProfile } from "../company-profile/model";
import { ACME_PROTOTYPE_PROFILE } from "../company-profile/prototype-companies";
import {
  PROTOTYPE_JOB_ENRICHMENTS,
  enrichJob,
  enrichmentForJob,
  jobsForPrototypeCompany,
} from "./enrich";
import type { JobLanguage, JobLanguageLevel, JobPayFrequency, PrototypeJobEnrichment, PrototypeJobView } from "./enrich";
import { jobItemSchema } from "./schemas";
import type { JobItem } from "./types";
const enrichSource = readFileSync(join(process.cwd(), "src", "features", "jobs", "enrich.ts"), "utf8");
const FRONTEND_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const GO_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d92";
const DEMO_JOB_IDS = [FRONTEND_ID, GO_ID] as const;
/** Canonical wire keys of `frontendJob`, enrichment key excluded. */
const WIRE_KEYS = ["company", "description", "employment_type", "id", "salary_currency", "seniority", "title", "work_mode"] as const;
const ENTRIES: PrototypeJobEnrichment[] = DEMO_JOB_IDS.map((id) => PROTOTYPE_JOB_ENRICHMENTS[id]);
/** Minimal schema-shaped wire job; the prototype only reads its id and company. */
function wireJob(id: string, company: JobItem["company"], extra: Partial<JobItem> = {}): JobItem {
  return { id, title: "Vacante", description: "Descripción de prueba.", work_mode: "remote", employment_type: "full_time", seniority: "senior", salary_currency: "MXN", company, ...extra };
}
const frontendJob = wireJob(FRONTEND_ID, { id: PROTOTYPE_COMPANY_ID, name: "Acme" });
/** The demo Go vacancy: same display name, different wire company id. */
const goJob = wireJob(GO_ID, { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d93", name: "Acme" }, { work_mode: "hybrid", employment_type: "contract", seniority: "lead", location: "Monterrey, Nuevo León", salary_min: 30000, salary_max: 45000, published_at: "2026-02-14T09:30:00Z" });
const otherJob = wireJob("0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d91", { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d94", name: "Consultoría Integral de Ingeniería de Software" });
/** The same display name in the wrong casing: no fuzzy match may accept it. */
const lowercaseJob: JobItem = { ...otherJob, id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d95", company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d96", name: "acme" } };
describe("prototype enrichment fixtures", () => {
  it("enriches exactly the two demo vacancies with frozen display data", () => {
    expect(Object.keys(PROTOTYPE_JOB_ENRICHMENTS)).toEqual([...DEMO_JOB_IDS]);
    expect(goJob.company.id).not.toBe(PROTOTYPE_COMPANY_ID);
    for (const [index, entry] of ENTRIES.entries()) {
      expect([Object.isFrozen(entry), Object.isFrozen(entry.skills), Object.isFrozen(entry.benefits), Object.isFrozen(entry.languages), Object.isFrozen(entry.applicationQuestions)], DEMO_JOB_IDS[index]).toEqual([true, true, true, true, true]);
      for (const language of entry.languages ?? []) expect(Object.isFrozen(language)).toBe(true);
      expect([entry.department.trim().length > 0, entry.skills.length >= 2, entry.skills.length <= 4, new Set(entry.skills).size === entry.skills.length]).toEqual([true, true, true, true]);
      expect([entry.benefits.length >= 2, new Set(entry.benefits).size === entry.benefits.length, entry.requiredRequirements.length >= 1, entry.preferredRequirements.length >= 1]).toEqual([true, true, true, true]);
      for (const text of [...entry.benefits, ...entry.requiredRequirements, ...entry.preferredRequirements]) expect(text.trim()).toBe(text);
      expect(entry.payFrequency).toMatch(/^(monthly|yearly|hourly)$/u);
      expect(Number.isInteger(entry.applicantCount) && entry.applicantCount > 0).toBe(true);
      expect(Number.isInteger(entry.responseTimeDays) && entry.responseTimeDays > 0).toBe(true);
      expect([typeof entry.featured, typeof entry.verifiedByPeopleFlow]).toEqual(["boolean", "boolean"]);
      expect([entry.experienceLabel, entry.publishedAgoLabel].map((label) => label.trim().length > 0 && label.trim() === label)).toEqual([true, true]);
      expect(entry.experienceLabel).toMatch(/^\d+\+ años$/u);
      expect(entry.publishedAgoLabel).toMatch(/^Hace \d+ h$/u);
      expect(JSON.stringify(entry)).not.toMatch(/rating|reviews|views|popularity|puntaje|score|%/u);
    }
  });
  it("freezes each language and both optional lists against mutation", () => {
    for (const entry of ENTRIES) {
      expect(Object.isFrozen(entry.languages)).toBe(true);
      expect(Object.isFrozen(entry.applicationQuestions)).toBe(true);
      expect(entry.languages!.length).toBeGreaterThan(0);
      expect(entry.applicationQuestions!.length).toBeGreaterThan(0);
      for (const language of entry.languages!) {
        expect(Reflect.set(language, "name", "Otro")).toBe(false);
        expect(language.name).not.toBe("Otro");
      }
      expect(Reflect.set(entry.languages!, 0, { name: "Otro" })).toBe(false);
      expect(Reflect.set(entry.applicationQuestions!, 0, "Otra pregunta")).toBe(false);
    }
  });
  it("keeps the CEFR level optional and the authored copies blank-free and typed", () => {
    const levels = ENTRIES.flatMap((entry) => entry.languages!.map((language) => language.level));
    expect(levels).toContain(undefined);
    expect(levels.filter((level) => level !== undefined).length).toBeGreaterThan(0);
    for (const entry of ENTRIES) {
      for (const language of entry.languages!) {
        expect(language.name.trim().length > 0 && language.name.trim() === language.name).toBe(true);
        if (language.level !== undefined) expect(language.level).toMatch(/^[ABC][12]$/u);
      }
      for (const question of entry.applicationQuestions!) expect(question.trim().length > 0 && question.trim() === question).toBe(true);
    }
    expectTypeOf<JobLanguageLevel>().toEqualTypeOf<"A1" | "A2" | "B1" | "B2" | "C1" | "C2">();
    expectTypeOf<JobLanguage["level"]>().toEqualTypeOf<JobLanguageLevel | undefined>();
    expectTypeOf<PrototypeJobEnrichment["languages"]>().toEqualTypeOf<readonly JobLanguage[] | undefined>();
    expectTypeOf<PrototypeJobEnrichment["applicationQuestions"]>().toEqualTypeOf<readonly string[] | undefined>();
  });
  it("publishes one frozen metric set per demo vacancy and no extra field", () => {
    const fields = ["applicantCount", "applicationQuestions", "benefits", "closingDate", "department", "experienceLabel", "featured", "languages", "payFrequency", "preferredRequirements", "publishedAgoLabel", "requiredRequirements", "responseTimeDays", "skills", "verifiedByPeopleFlow"];
    expect(Object.keys(ENTRIES[0]).sort()).toEqual([...fields].sort());
    expect(ENTRIES[0]).toMatchObject({ applicantCount: 24, responseTimeDays: 3, featured: true, verifiedByPeopleFlow: true, experienceLabel: "5+ años", publishedAgoLabel: "Hace 2 h" });
    expect(ENTRIES[1]).toMatchObject({ applicantCount: 41, responseTimeDays: 2, featured: false, verifiedByPeopleFlow: true, experienceLabel: "6+ años", publishedAgoLabel: "Hace 5 h" });
    expect(ENTRIES[0].languages).toEqual([{ name: "Español" }, { name: "Inglés", level: "B2" }]);
    expect(ENTRIES[1].languages).toEqual([{ name: "Español" }, { name: "Inglés", level: "B1" }, { name: "Portugués", level: "A2" }]);
    expect(ENTRIES[0].applicationQuestions).toHaveLength(3);
    expect(ENTRIES[1].applicationQuestions).toHaveLength(2);
    expect(Reflect.set(ENTRIES[0], "applicantCount", 99)).toBe(false);
    expect(ENTRIES[0].applicantCount).toBe(24);
  });
  it("keeps the closing date optional, well formed, and typed", () => {
    const dates = ENTRIES.map((entry) => entry.closingDate);
    expect(dates).toContain(undefined);
    expect(dates.filter((date) => date !== undefined)).toHaveLength(1);
    for (const date of dates) if (date !== undefined) expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expectTypeOf<JobPayFrequency>().toEqualTypeOf<"monthly" | "yearly" | "hourly">();
  });
});
describe("enrichJob", () => {
  it("preserves every canonical wire field and never mutates its input", () => {
    const view = enrichJob(frontendJob);
    const snapshot = JSON.parse(JSON.stringify(frontendJob));
    expect(Object.keys(view).sort()).toEqual([...WIRE_KEYS, "prototype"].sort());
    expect(view).toMatchObject(frontendJob);
    expect(view.prototype).toBe(PROTOTYPE_JOB_ENRICHMENTS[FRONTEND_ID]);
    expect(view.prototype).toBe(enrichmentForJob(FRONTEND_ID));
    for (const key of WIRE_KEYS) expect(view[key]).toEqual(frontendJob[key]);
    expect(frontendJob).toEqual(snapshot);
    expect(Object.hasOwn(frontendJob, "prototype")).toBe(false);
    expect(view).not.toBe(frontendJob);
  });
  it("copies an unknown id untouched and stays outside the wire contract", () => {
    const unknown = enrichJob(otherJob);
    expect(Object.hasOwn(unknown, "prototype")).toBe(false);
    expect(unknown).toEqual(otherJob);
    expect(unknown).not.toBe(otherJob);
    expect(Object.keys(unknown).sort()).toEqual([...WIRE_KEYS].sort());
    expect(enrichmentForJob("0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d97")).toBeUndefined();
    expectTypeOf<PrototypeJobView>().toMatchTypeOf<JobItem>();
    expectTypeOf<PrototypeJobView["prototype"]>().toEqualTypeOf<PrototypeJobEnrichment | undefined>();
    expectTypeOf<Extract<"prototype", keyof JobItem>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<keyof PrototypeJobEnrichment, keyof JobItem>>().toEqualTypeOf<never>();
    expectTypeOf<PrototypeJobEnrichment["closingDate"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<PrototypeJobEnrichment>().toMatchTypeOf<{ applicantCount: number; responseTimeDays: number; featured: boolean; verifiedByPeopleFlow: boolean; experienceLabel: string; publishedAgoLabel: string }>();
    // The wire schema still strips the enrichment, so nothing persisted changes.
    const parsed = jobItemSchema.safeParse(enrichJob(frontendJob));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(Object.keys(parsed.data).sort()).toEqual([...WIRE_KEYS].sort());
    expect(Object.hasOwn(parsed.data, "prototype")).toBe(false);
  });
});
describe("jobsForPrototypeCompany", () => {
  it("associates by exact id or exact source name only, in caller order", () => {
    const views = jobsForPrototypeCompany([frontendJob, otherJob, goJob], ACME_PROTOTYPE_PROFILE);
    expect(views.map((view: PrototypeJobView) => view.id)).toEqual([FRONTEND_ID, GO_ID]);
    expect(views[0].prototype).toBe(PROTOTYPE_JOB_ENRICHMENTS[FRONTEND_ID]);
    expect(views[1].prototype).toBe(PROTOTYPE_JOB_ENRICHMENTS[GO_ID]);
    expect(jobsForPrototypeCompany([goJob, frontendJob], ACME_PROTOTYPE_PROFILE).map((view: PrototypeJobView) => view.id)).toEqual([GO_ID, FRONTEND_ID]);
    const unknownProfile: CompanyProfile = { ...ACME_PROTOTYPE_PROFILE, companyId: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d99", sourceName: "Otra Empresa" };
    expect(jobsForPrototypeCompany([otherJob, lowercaseJob], ACME_PROTOTYPE_PROFILE)).toEqual([]);
    expect(jobsForPrototypeCompany([frontendJob], unknownProfile)).toEqual([]);
    expect(jobsForPrototypeCompany([], ACME_PROTOTYPE_PROFILE)).toEqual([]);
    expect(lowercaseJob.company.name).toBe("acme");
    expect(goJob.company.name).toBe("Acme");
    const jobs = [otherJob, frontendJob];
    const snapshot = JSON.parse(JSON.stringify(jobs));
    expect(jobsForPrototypeCompany(jobs, ACME_PROTOTYPE_PROFILE).map((view: PrototypeJobView) => view.id)).toEqual([FRONTEND_ID]);
    expect(jobs).toEqual(snapshot);
  });
});
describe("enrichment source boundary", () => {
  it("type-imports only the wire type and the sibling profile model", () => {
    const specifiers = [...enrichSource.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]);
    const imports = enrichSource.match(/^import .*$/gmu) ?? [];
    expect([...specifiers].sort()).toEqual(["./types", "../company-profile/model"].sort());
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) expect(line.startsWith("import type ")).toBe(true);
  });
  it("stays free of transport, schema, state, form, and generated values", () => {
    expect(enrichSource).not.toMatch(/\bfetch\(|XMLHttpRequest|axios|require\(/u);
    expect(enrichSource).not.toMatch(/from "[^"]*schemas"|from "[^"]*zod"|from "[^"]*create/u);
    expect(enrichSource).not.toMatch(/"use client"|useState\(|useEffect\(/u);
    expect(enrichSource).not.toMatch(/Math\.random|Date\.now|new Date\(|randomUUID|crypto\./u);
    expect(enrichSource).not.toMatch(/localStorage|sessionStorage|indexedDB/u);
  });
});
