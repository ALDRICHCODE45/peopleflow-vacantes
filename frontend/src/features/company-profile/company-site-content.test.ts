import { describe, expect, it } from "vitest";

import {
  companySiteHeadings,
  emptyCompanySiteContent,
  siteContentFromProfile,
} from "./company-site-content";
import { ACME_PROTOTYPE_PROFILE } from "./prototype-companies";

const profile = ACME_PROTOTYPE_PROFILE;
const content = siteContentFromProfile(profile);
/** Claim-like keys the presentation contract must never grow. */
const FORBIDDEN_METRIC_KEYS = ["rating", "reviews", "verified", "applicants", "testimonials", "benefits", "team", "stats"];

describe("siteContentFromProfile", () => {
  it("derives every approved public field and the cover from the profile", () => {
    expect(content).toEqual({
      name: profile.name,
      tagline: profile.tagline,
      about: profile.about,
      mission: profile.mission,
      whatWeDo: profile.whatWeDo,
      location: profile.location,
      companySize: profile.companySize,
      foundedYear: profile.foundedYear,
      website: profile.website,
      workStyle: profile.workStyle,
      coverPhoto: profile.coverPhoto,
    });
    for (const key of FORBIDDEN_METRIC_KEYS) expect(Object.keys(content)).not.toContain(key);
  });

  it("leaves the approved profile untouched and unlinked", () => {
    const before = JSON.parse(JSON.stringify(profile)) as unknown;
    siteContentFromProfile(profile);
    expect(JSON.parse(JSON.stringify(profile))).toEqual(before);
    expect(Object.keys(profile)).toEqual([
      "companyId",
      "sourceName",
      "name",
      "tagline",
      "about",
      "mission",
      "whatWeDo",
      "location",
      "companySize",
      "foundedYear",
      "website",
      "workStyle",
      "coverPhoto",
    ]);
  });
});

describe("emptyCompanySiteContent", () => {
  it("keeps only the identity of a company without an approved story", () => {
    const draft = emptyCompanySiteContent("Nexo Labs");
    expect(draft).toEqual({ name: "Nexo Labs" });
    expect(JSON.stringify(draft)).not.toMatch(/Acme|montacargas|logístic|operacion/iu);
    for (const key of ["tagline", "about", "mission", "whatWeDo", "location", "companySize", "foundedYear", "website", "workStyle", "coverPhoto"]) {
      expect(Object.hasOwn(draft, key)).toBe(false);
    }
  });
});

describe("companySiteHeadings", () => {
  it("maps the public base level to H1 plus H2 sections with stable anchor ids", () => {
    expect(companySiteHeadings()).toEqual({
      nameTag: "h1",
      sectionTag: "h2",
      nameId: "empresa",
      storyId: "sobre-empresa",
      capabilitiesId: "que-hacemos",
      jobsId: "vacantes",
    });
  });

  it("maps an embedded preview level to H2 plus H3 sections under a configurable id prefix", () => {
    expect(companySiteHeadings(2, "preview-")).toEqual({
      nameTag: "h2",
      sectionTag: "h3",
      nameId: "preview-empresa",
      storyId: "preview-sobre-empresa",
      capabilitiesId: "preview-que-hacemos",
      jobsId: "preview-vacantes",
    });
    // The anchor suffix survives the prefix, so a preview anchor stays derivable.
    expect(companySiteHeadings(2).storyId).toBe("sobre-empresa");
    expect(companySiteHeadings(1, "preview-").storyId).toBe("preview-sobre-empresa");
  });
});
