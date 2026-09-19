import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  PROTOTYPE_COMPANY_ID,
  PROTOTYPE_COMPANY_SOURCE_NAME,
  findCompanyProfile,
} from "./model";
import type { CompanyProfile, PrototypeDisclosure } from "./model";
import {
  ACME_PROTOTYPE_PROFILE,
  PROTOTYPE_COMPANY_PROFILES,
} from "./prototype-companies";
const dir = join(process.cwd(), "src", "features", "company-profile");
const publicDir = join(process.cwd(), "public");
const modelSource = readFileSync(join(dir, "model.ts"), "utf8");
const fixtureSource = readFileSync(join(dir, "prototype-companies.ts"), "utf8");
const profile = ACME_PROTOTYPE_PROFILE;
const known: readonly CompanyProfile[] = PROTOTYPE_COMPANY_PROFILES;
/** Claim-like keys a fictional prototype profile must never own. */
const FORBIDDEN_METRIC_KEYS = ["rating", "reviews", "verified", "verification", "responseRate", "applicants", "views", "popularity", "hires", "customers", "clients", "nps", "retention", "growth", "revenue", "funding"];
/** Conciseness ceiling per Spanish content field. */
const CONTENT_MAX: ReadonlyArray<[keyof CompanyProfile & ("tagline" | "about" | "mission" | "whatWeDo" | "workStyle"), number]> = [["tagline", 90], ["about", 360], ["mission", 220], ["whatWeDo", 220], ["workStyle", 120]];
/** Near misses that must never resolve: matching is exact. */
const UNKNOWN_REFS = [{}, { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d99" }, { name: "acme" }, { name: "Acme " }, { name: "ACME" }, { name: "Acme Logística" }, { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d99", name: "acme" }];
/** The profile's own keys plus the keys of its two nested display blocks. */
const PROFILE_KEYS = Object.entries(profile).flatMap(([key, value]) => typeof value === "object" && value !== null ? [key, ...Object.keys(value)] : [key]);
describe("prototype company fixture", () => {
  it("exposes one frozen profile under the canonical identity", () => {
    expect(PROTOTYPE_COMPANY_ID).toBe("0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f");
    expect(PROTOTYPE_COMPANY_SOURCE_NAME).toBe("Acme");
    expect(PROTOTYPE_COMPANY_PROFILES).toEqual([profile]);
    expect([profile.companyId, profile.sourceName, profile.name]).toEqual([PROTOTYPE_COMPANY_ID, "Acme", "Acme"]);
    for (const value of [profile, profile.coverPhoto, profile.disclosure, PROTOTYPE_COMPANY_PROFILES]) expect(Object.isFrozen(value)).toBe(true);
    expect(() => Object.defineProperty(profile, "name", { value: "Otra" })).toThrow();
  });
  it("carries concise Spanish content and no fabricated metric", () => {
    for (const key of FORBIDDEN_METRIC_KEYS) expect(PROFILE_KEYS).not.toContain(key);
    expect(JSON.stringify(profile)).not.toContain("%");
    for (const [field, max] of CONTENT_MAX) {
      const value = profile[field];
      expect([value.trim() === value, value.length > 0, value.length <= max], field).toEqual([true, true, true]);
    }
    expect(profile.location).toBe("Monterrey, Nuevo León, México");
    expect(profile.companySize).toMatch(/personas/u);
    expect(profile.foundedYear).toBeGreaterThanOrEqual(1900);
    const narrative = `${profile.about} ${profile.mission} ${profile.whatWeDo}`.toLowerCase();
    expect([narrative.includes("logístic"), narrative.includes("operacion")]).toEqual([true, true]);
  });
  it("uses a reserved domain, a provenance-pinned local cover, and an explicit disclosure", () => {
    const website = new URL(profile.website);
    const alt = profile.coverPhoto.alt;
    expect([website.protocol, website.hostname.endsWith(".example")]).toEqual(["https:", true]);
    // The cover is a shipped local asset: never a remote, generated, or placeholder source.
    expect(profile.coverPhoto.url).toBe("/company/acme-cover.webp");
    expect(profile.coverPhoto.url).not.toMatch(/^(?:https?:)?\/\/|data:|\.svg|placeholder/iu);
    const coverBytes = readFileSync(join(publicDir, "company", "acme-cover.webp"));
    expect(coverBytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(coverBytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
    // The asset's provenance travels with the repository, next to the file.
    const provenance = readFileSync(join(publicDir, "company", "acme-cover.PROVENANCE.txt"), "utf8");
    for (const fact of [
      "https://commons.wikimedia.org/wiki/File:Workers_drive_Forklifts_laden_with_USAID_goods_inside_a_large_warehouse_-_20110826-FS-LSC-0138_-_Flickr_-_USDAgov.jpg",
      "https://upload.wikimedia.org/wikipedia/commons/a/a5/Workers_drive_Forklifts_laden_with_USAID_goods_inside_a_large_warehouse_-_20110826-FS-LSC-0138_-_Flickr_-_USDAgov.jpg",
      "U.S. Department of Agriculture",
      "Lance Cheung",
      "20110826-FS-LSC-0138",
      "Public domain",
      "3800x2802",
      "1600x900",
      "WebP",
    ]) {
      expect(provenance, fact).toContain(fact);
    }
    expect([alt.split(" ").length >= 5, /montacargas|almac|bodega|tarima|carga/iu.test(alt), /^(imagen|foto|cover)$/iu.test(alt)]).toEqual([true, true, false]);
    expect(profile.disclosure).toMatchObject({ isPrototype: true });
    expect(profile.disclosure.label).toMatch(/prototipo/iu);
    expect(profile.disclosure.statement).toMatch(/ficticia|prototipo/iu);
    expectTypeOf<CompanyProfile["disclosure"]>().toEqualTypeOf<PrototypeDisclosure>();
    expectTypeOf<PrototypeDisclosure["isPrototype"]>().toEqualTypeOf<true>();
  });
});
describe("findCompanyProfile", () => {
  it("resolves exact ids and exact names only, and never mutates the list", () => {
    expect(findCompanyProfile(known, { id: PROTOTYPE_COMPANY_ID })).toBe(profile);
    expect(findCompanyProfile(known, { name: "Acme" })).toBe(profile);
    expect(findCompanyProfile(known, { id: PROTOTYPE_COMPANY_ID, name: "Acme" })).toBe(profile);
    for (const reference of UNKNOWN_REFS) expect(findCompanyProfile(known, reference)).toBeUndefined();
    expect(findCompanyProfile([], { id: PROTOTYPE_COMPANY_ID })).toBeUndefined();
    expect(known).toEqual([profile]);
    const impostor: CompanyProfile = { ...profile, companyId: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d99" };
    const list = [impostor, profile];
    expect(findCompanyProfile(list, { id: PROTOTYPE_COMPANY_ID, name: "Acme" })).toBe(profile);
    expect(findCompanyProfile(list, { name: "Acme" })).toBe(impostor);
    expect(list).toEqual([impostor, profile]);
  });
});
describe("company profile source boundary", () => {
  it("keeps both modules dependency-free of transport, state, and generation", () => {
    expect(modelSource).not.toMatch(/^import\s/mu);
    expect(modelSource).not.toMatch(/\bfetch\(|XMLHttpRequest|require\(|useState\(|useEffect\(/u);
    expect(modelSource).not.toMatch(/Math\.random|Date\.now|new Date\(|randomUUID|crypto\./u);
    expect([...fixtureSource.matchAll(/from "([^"]+)"/gu)].map((match) => match[1])).toEqual(["./model"]);
    expect(fixtureSource).not.toMatch(/\bfetch\(|require\(|localStorage|sessionStorage/u);
    expect(fixtureSource).not.toMatch(/Math\.random|Date\.now|new Date\(|randomUUID|crypto\./u);
  });
});
