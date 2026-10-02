import { describe, expect, it } from "vitest";

import { emptyCompanySiteContent } from "@/features/company-profile/company-site-content";
import {
  EMPLOYER_SITE_IDENTITY_NAME,
  createEmployerSiteDraft,
  draftToSiteContent,
  updateDraftField,
} from "./employer-site-draft";

describe("createEmployerSiteDraft", () => {
  it("starts from the employer identity with every story field empty", () => {
    const draft = createEmployerSiteDraft();

    expect(EMPLOYER_SITE_IDENTITY_NAME).toBe("Nexo Labs");
    expect(draft).toEqual({
      name: EMPLOYER_SITE_IDENTITY_NAME,
      tagline: "",
      about: "",
      mission: "",
      whatWeDo: "",
    });
    // The starting draft carries one identity and no other company's content.
    expect(JSON.stringify(draft)).not.toMatch(/Acme|montacargas|acme-cover/iu);
  });
});

describe("draftToSiteContent", () => {
  it("omits every unauthored field so the preview keeps its honest placeholders", () => {
    expect(draftToSiteContent(createEmployerSiteDraft())).toEqual(
      emptyCompanySiteContent(EMPLOYER_SITE_IDENTITY_NAME),
    );

    const blank = draftToSiteContent({
      name: EMPLOYER_SITE_IDENTITY_NAME,
      tagline: " ",
      about: "",
      mission: "\n",
      whatWeDo: "   ",
    });
    expect(Object.keys(blank)).toEqual(["name"]);
  });

  it("carries only the authored fields into the renderer presentation contract", () => {
    const content = draftToSiteContent({
      name: "Nexo Labs",
      tagline: "Talento para equipos que crecen.",
      about: "Somos un equipo de producto.",
      mission: "Hacer simple el reclutamiento.",
      whatWeDo: "Diseñamos software, acompañamos equipos",
    });

    expect(content).toEqual({
      name: "Nexo Labs",
      tagline: "Talento para equipos que crecen.",
      about: "Somos un equipo de producto.",
      mission: "Hacer simple el reclutamiento.",
      whatWeDo: "Diseñamos software, acompañamos equipos",
    });
    // No fact, metric, benefit, credential or cover can be manufactured here.
    for (const key of [
      "location",
      "companySize",
      "foundedYear",
      "website",
      "workStyle",
      "coverPhoto",
      "benefits",
      "stats",
      "team",
      "rating",
      "testimonials",
    ]) {
      expect(Object.hasOwn(content, key)).toBe(false);
    }
  });

  it("keeps the employer identity as the heading when the name field is blank", () => {
    const content = draftToSiteContent({
      ...createEmployerSiteDraft(),
      name: "   ",
    });

    expect(content.name).toBe(EMPLOYER_SITE_IDENTITY_NAME);
  });
});

describe("updateDraftField", () => {
  it("replaces one field without mutating the previous draft", () => {
    const before = createEmployerSiteDraft();
    const after = updateDraftField(before, "tagline", "Hola");

    expect(after).toEqual({ ...before, tagline: "Hola" });
    expect(before.tagline).toBe("");
    expect(after).not.toBe(before);
  });
});
