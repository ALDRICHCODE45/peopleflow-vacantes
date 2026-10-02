import { describe, expect, it } from "vitest";

import { emptyCompanySiteContent } from "@/features/company-profile/company-site-content";
import {
  EMPLOYER_SITE_IDENTITY_NAME,
  confirmEmployerSiteName,
  createEmployerSiteDraft,
  createEmployerSiteProfileState,
  draftToSiteContent,
  isEmployerSiteProfileReady,
  updateDraftField,
  updateEmployerSiteProfileField,
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

describe("createEmployerSiteProfileState", () => {
  it("starts from the identity draft with the name still unconfirmed", () => {
    const state = createEmployerSiteProfileState();

    expect(state.draft).toEqual(createEmployerSiteDraft());
    expect(state.nameConfirmed).toBe(false);
  });
});

describe("isEmployerSiteProfileReady", () => {
  it("never lets the seeded fallback name establish a confirmed identity", () => {
    const state = createEmployerSiteProfileState();

    expect(isEmployerSiteProfileReady(state)).toBe(false);
    // The About field alone is not enough either: the name is unconfirmed.
    const authored = updateEmployerSiteProfileField(state, "about", "Somos un equipo de producto.");
    expect(isEmployerSiteProfileReady(authored)).toBe(false);
    expect(isEmployerSiteProfileReady(confirmEmployerSiteName(authored))).toBe(true);
  });

  it("requires an authored About even after the name is confirmed", () => {
    const state = confirmEmployerSiteName(createEmployerSiteProfileState());

    expect(isEmployerSiteProfileReady(state)).toBe(false);
    expect(
      isEmployerSiteProfileReady(
        updateEmployerSiteProfileField(state, "about", "Somos un equipo de producto."),
      ),
    ).toBe(true);
  });

  it("rejects a whitespace-only About and a whitespace-only name", () => {
    const blankAbout = confirmEmployerSiteName(
      updateEmployerSiteProfileField(createEmployerSiteProfileState(), "about", "\n  "),
    );
    expect(isEmployerSiteProfileReady(blankAbout)).toBe(false);

    const blankName = updateEmployerSiteProfileField(blankAbout, "name", "   ");
    const renamed = confirmEmployerSiteName(
      updateEmployerSiteProfileField(
        updateEmployerSiteProfileField(blankName, "about", "Somos un equipo de producto."),
        "name",
        "   ",
      ),
    );
    expect(renamed.nameConfirmed).toBe(true);
    expect(isEmployerSiteProfileReady(renamed)).toBe(false);
  });
});

describe("updateEmployerSiteProfileField", () => {
  it("revokes the name confirmation as soon as the company name changes", () => {
    const ready = confirmEmployerSiteName(
      updateEmployerSiteProfileField(createEmployerSiteProfileState(), "about", "Historia"),
    );
    expect(isEmployerSiteProfileReady(ready)).toBe(true);

    const renamed = updateEmployerSiteProfileField(ready, "name", "Nexo Labs MX");
    expect(renamed.nameConfirmed).toBe(false);
    expect(isEmployerSiteProfileReady(renamed)).toBe(false);
  });

  it("keeps the confirmation when any other field changes", () => {
    const confirmed = confirmEmployerSiteName(createEmployerSiteProfileState());

    const edited = updateEmployerSiteProfileField(confirmed, "about", "Historia");
    expect(edited.nameConfirmed).toBe(true);
    expect(edited.draft.about).toBe("Historia");
    expect(confirmed.draft.about).toBe("");
  });
});
