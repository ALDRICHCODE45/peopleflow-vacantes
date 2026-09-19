import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import type { PrototypeJobView } from "../jobs/enrich";
import { ACME_PROTOTYPE_JOBS } from "../jobs/prototype-jobs";
import { CompanyCareersView } from "./company-careers-view";
import { ACME_PROTOTYPE_PROFILE } from "./prototype-companies";

const profile = ACME_PROTOTYPE_PROFILE;
const view = (jobs: readonly PrototypeJobView[] = []) => render(<CompanyCareersView profile={profile} jobs={jobs} />);
/** The capability list of the page, scoped so vacancy cards never leak into it. */
const capabilityItems = (container: HTMLElement) => Array.from(container.querySelector("h2#que-hacemos")?.closest("section")?.querySelectorAll("li") ?? []).map((item) => item.textContent ?? "");
/** Claim-like or action-like copy this prototype must never render. */
const FORBIDDEN_COPY = /aplicar|postular|guardar|verificad|popular|recomendad|candidat|opiniones|calificaci|\d+\s*%|\+?\d+\s*(empleados|contrataciones|clientes)/iu;

afterEach(() => cleanup());

describe("CompanyCareersView headings and narrative", () => {
  it("renders one H1 and exactly the three H2 sections in document order", () => {
    view(ACME_PROTOTYPE_JOBS);
    const headings = screen.getAllByRole("heading").filter((node) => node.tagName === "H1" || node.tagName === "H2");
    expect(headings.map((node) => node.tagName)).toEqual(["H1", "H2", "H2", "H2"]);
    expect(headings[0]).toHaveTextContent(profile.name);
    expect(headings.slice(1).map((node) => node.textContent)).toEqual([`Sobre ${profile.name}`, "Qué hacemos", "Vacantes"]);
  });

  it("renders the profile narrative and a list of its own capabilities", () => {
    const { container } = view();
    for (const value of [profile.tagline, profile.about, profile.mission]) expect(container.textContent).toContain(value);
    const highlights = capabilityItems(container);
    expect(highlights.length).toBeGreaterThanOrEqual(3);
    // Every highlight is verbatim profile content, never an invented claim.
    for (const highlight of highlights) expect(profile.whatWeDo.toLowerCase()).toContain(highlight.toLowerCase());
  });

  it("keeps the whole sentence when a profile has nothing to enumerate", () => {
    const whatWeDo = "Operamos bodegas.";
    const { container } = render(<CompanyCareersView profile={{ ...profile, whatWeDo }} jobs={[]} />);
    expect(capabilityItems(container)).toEqual([whatWeDo]);
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
    expect(image?.getAttribute("alt")).toBe(profile.coverPhoto.alt);
    // next/image may serve the byte-identical local file through its optimizer,
    // so the resolved URL only has to point at the asset this repo ships.
    const src = image?.getAttribute("src") ?? "";
    expect(decodeURIComponent(src)).toContain(profile.coverPhoto.url);
    expect(src).not.toMatch(/^(?:https?:)?\/\/|picsum/iu);
    expect([image?.getAttribute("width"), image?.getAttribute("height")]).toEqual(["1600", "900"]);
    expect(image?.getAttribute("sizes")).toBe("(min-width: 1024px) 40vw, 100vw");
    expect(image?.getAttribute("srcset")).toContain(encodeURIComponent(profile.coverPhoto.url));
    expect(image?.className).toContain("object-cover");
    // `priority` keeps the cover from being deferred: it is this route's LCP image.
    expect(image?.getAttribute("loading")).not.toBe("lazy");
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

describe("CompanyCareersView vacancies", () => {
  it("lists the company's own prototype vacancies with the reusable card", () => {
    const { container } = view(ACME_PROTOTYPE_JOBS);
    expect(FORBIDDEN_COPY.test(container.textContent ?? "")).toBe(false);
    const list = screen.getByRole("list", { name: `Vacantes en ${profile.name}` });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(ACME_PROTOTYPE_JOBS.length);
    expect(items.map((item) => item.querySelector("h3")?.textContent)).toEqual(ACME_PROTOTYPE_JOBS.map((job) => job.title));
    expect(items.map((item) => item.querySelector("a")?.getAttribute("href"))).toEqual(ACME_PROTOTYPE_JOBS.map((job) => `/vacantes/${job.id}`));
    for (const item of items) expect(item.querySelector("a")).toHaveTextContent(item.querySelector("h3")?.textContent ?? "");
  });

  it("keeps the company's own name plain text and never links a vacancy back to itself", () => {
    const { container } = view(ACME_PROTOTYPE_JOBS);
    const list = screen.getByRole("list", { name: `Vacantes en ${profile.name}` });
    expect(within(list).getAllByText(profile.name).every((node) => node.closest("a") === null)).toBe(true);
    expect(screen.queryByText(/todavía no lista/iu)).toBeNull();
    expect(Array.from(container.querySelectorAll("a[href^='/empresas']"))).toHaveLength(0);
  });
});
