import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { CompanyCareersView } from "./company-careers-view";
import { ACME_PROTOTYPE_PROFILE } from "./prototype-companies";

const profile = ACME_PROTOTYPE_PROFILE;
const view = () => render(<CompanyCareersView profile={profile} />);
/** Claim-like or action-like copy this prototype must never render. */
const FORBIDDEN_COPY = /aplicar|postular|guardar|verificad|popular|recomendad|candidat|opiniones|calificaci|\d+\s*%|\+?\d+\s*(empleados|contrataciones|clientes)/iu;

afterEach(() => cleanup());

describe("CompanyCareersView headings and narrative", () => {
  it("renders one H1 and exactly the three H2 sections in document order", () => {
    view();
    const headings = screen.getAllByRole("heading");
    expect(headings.map((node) => node.tagName)).toEqual(["H1", "H2", "H2", "H2"]);
    expect(headings[0]).toHaveTextContent(profile.name);
    expect(headings.slice(1).map((node) => node.textContent)).toEqual([`Sobre ${profile.name}`, "Qué hacemos", "Vacantes"]);
  });

  it("renders the profile narrative and a list of its own capabilities", () => {
    const { container } = view();
    for (const value of [profile.tagline, profile.about, profile.mission]) expect(container.textContent).toContain(value);
    const highlights = Array.from(container.querySelectorAll("li")).map((item) => item.textContent ?? "");
    expect(highlights.length).toBeGreaterThanOrEqual(3);
    // Every highlight is verbatim profile content, never an invented claim.
    for (const highlight of highlights) expect(profile.whatWeDo.toLowerCase()).toContain(highlight.toLowerCase());
  });

  it("keeps the whole sentence when a profile has nothing to enumerate", () => {
    const whatWeDo = "Operamos bodegas.";
    const { container } = render(<CompanyCareersView profile={{ ...profile, whatWeDo }} />);
    expect(Array.from(container.querySelectorAll("li")).map((item) => item.textContent)).toEqual([whatWeDo]);
  });

  it("lists the profile facts in a description list", () => {
    const { container } = view();
    const descriptionList = container.querySelector("dl");
    expect(Array.from(descriptionList?.querySelectorAll("dt") ?? []).map((term) => term.textContent)).toEqual(["Ubicación", "Tamaño del equipo", "Fundada", "Forma de trabajo"]);
    expect(Array.from(descriptionList?.querySelectorAll("dd") ?? []).map((value) => value.textContent)).toEqual([profile.location, profile.companySize, String(profile.foundedYear), profile.workStyle]);
  });
});

describe("CompanyCareersView media, disclosure, and honesty", () => {
  it("shows the disclosure and one safe external link, never a clickable cover", () => {
    const { container } = view();
    expect(container.textContent).toContain(profile.disclosure.label);
    expect(container.textContent).toContain(profile.disclosure.statement);
    const image = container.querySelector("img");
    expect([image?.getAttribute("alt"), image?.getAttribute("src")]).toEqual([profile.coverPhoto.alt, profile.coverPhoto.url]);
    expect([image?.getAttribute("width"), image?.getAttribute("height")]).toEqual(["1600", "900"]);
    expect([image?.getAttribute("loading"), image?.getAttribute("fetchpriority")]).toEqual(["eager", "high"]);
    expect(image?.closest("a")).toBeNull();
    expect(image?.parentElement?.className).toContain("bg-muted");
    const external = Array.from(container.querySelectorAll("a[href^='http']"));
    expect(external.map((anchor) => [anchor.getAttribute("href"), anchor.getAttribute("target"), anchor.getAttribute("rel")])).toEqual([[profile.website, "_blank", "noopener noreferrer"]]);
  });

  it("keeps the vacancy section an honest placeholder with one board link", () => {
    const { container } = view();
    expect(FORBIDDEN_COPY.test(container.textContent ?? "")).toBe(false);
    const vacancySection = container.querySelector("h2#vacantes")?.closest("section");
    expect(vacancySection?.textContent).toMatch(/prototipo|todavía no lista/iu);
    expect(vacancySection?.textContent).toContain(profile.name);
    expect(Array.from(vacancySection?.querySelectorAll("a") ?? []).map((anchor) => anchor.getAttribute("href"))).toEqual(["/vacantes"]);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});
