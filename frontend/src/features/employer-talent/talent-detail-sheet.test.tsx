import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { formatTalentDate, talentPersonSchema, type TalentPerson } from "./model";
import {
  TALENT_AVAILABILITY_VARIANT,
  TALENT_MODALITY_VARIANT,
  TalentDetailSheet,
} from "./talent-detail-sheet";

// jsdom implements neither matchMedia nor ResizeObserver; the Base UI dialog
// reads both. Stubbing them mirrors the committed employer-talent suite.
function stubBrowserApis() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("innerWidth", 375);
}

const VACANCY_TITLES: Readonly<Record<string, string>> = {
  "frontend-engineer-react": "Frontend Engineer (React)",
  "fullstack-developer": "Fullstack Developer",
};

/**
 * One person with the complete profile surface and two application records, so
 * the history order (most recent first) and every field can be asserted from a
 * single render.
 */
const PERSON: TalentPerson = talentPersonSchema.parse({
  id: "gabriela-soto",
  fullName: "Gabriela Soto",
  professionalTitle: "Frontend Engineer",
  email: "gabriela-soto@ejemplo.mx",
  phone: "+52 55 1013 1007",
  location: "Guadalajara",
  industry: "Tecnología",
  currentCompany: "Pixelaria",
  yearsOfExperience: 5,
  skills: ["React", "TypeScript"],
  education: "Licenciatura en Ingeniería en Computación",
  languages: [
    { name: "Español", level: "native" },
    { name: "Inglés", level: "advanced" },
  ],
  preferredModality: "hybrid",
  availability: "two_weeks",
  applications: [
    {
      id: "gabriela-soto-postulacion-1",
      vacancyId: "frontend-engineer-react",
      stage: "in_review",
      source: "linkedin",
      appliedAt: "2026-03-11T15:00:00Z",
    },
    {
      id: "gabriela-soto-postulacion-2",
      vacancyId: "fullstack-developer",
      stage: "submitted",
      source: "direct",
      appliedAt: "2026-03-14T09:30:00Z",
    },
  ],
});

function renderSheet(
  person: TalentPerson | null = PERSON,
  vacancyTitleById: Readonly<Record<string, string>> = VACANCY_TITLES,
) {
  const onOpenChange = vi.fn();
  const view = render(
    <TalentDetailSheet
      person={person}
      vacancyTitleById={vacancyTitleById}
      open={person !== null}
      onOpenChange={onOpenChange}
    />,
  );
  return { onOpenChange, ...view };
}

/**
 * A 120-char token with no spaces or break opportunities is the worst case for
 * horizontal clipping: without `overflow-wrap: anywhere` it cannot shrink below
 * its own width and pushes the panel into horizontal overflow.
 */
const LONG_WORD = "a".repeat(120);
const LONG_EMAIL = `${"b".repeat(105)}@ejemplo.mx`;

/**
 * The same complete surface, but every free-text field is one unbroken token.
 * Used to prove the long-text wrapping contract.
 */
const LONG_PERSON: TalentPerson = talentPersonSchema.parse({
  ...PERSON,
  id: "long-person",
  fullName: LONG_WORD,
  professionalTitle: LONG_WORD,
  currentCompany: LONG_WORD,
  email: LONG_EMAIL,
  applications: [
    {
      id: "long-person-postulacion-1",
      vacancyId: "long-vacancy",
      stage: "submitted",
      source: "direct",
      appliedAt: "2026-03-14T09:30:00Z",
    },
  ],
});

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

function sheetBody(): HTMLElement {
  const body = document.querySelector<HTMLElement>(
    "[data-pf-talento-sheet-body]",
  );
  expect(body, "sheet body").not.toBeNull();
  return body as HTMLElement;
}

function sectionTitles(): string[] {
  return screen
    .getAllByRole("heading", { level: 3 })
    .map((heading) => heading.textContent ?? "");
}

function badgeOf(label: string): HTMLElement {
  const badge = within(dialog()).getByText(label).closest("[data-slot='badge']");
  expect(badge, `badge ${label}`).not.toBeNull();
  return badge as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TalentDetailSheet interior", () => {
  beforeEach(stubBrowserApis);

  it("keeps the exact accessible dialog name and the title/company subtitle", () => {
    renderSheet();

    expect(
      screen.getByRole("dialog", { name: "Gabriela Soto" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Frontend Engineer · Pixelaria"),
    ).toBeInTheDocument();
    expect(
      document.querySelector("[data-pf-talento-sheet-name]"),
    ).toHaveTextContent("Gabriela Soto");
  });

  it("renders the cover and identity inside the single scrolling body", () => {
    renderSheet();

    const body = sheetBody();
    const cover = document.querySelector("[data-pf-talento-sheet-cover]");
    expect(cover, "cover").not.toBeNull();
    expect(cover!.className).toContain("bg-primary");
    expect(cover!.className).toContain("w-full");
    // The cover and identity scroll with the content instead of being fixed
    // chrome, so a short viewport can never be pinned by chrome taller than the
    // panel itself.
    expect(body).toContainElement(cover as HTMLElement);
    const header = body.querySelector("[data-slot='sheet-header']");
    expect(header).not.toBeNull();
    const avatar = header!.querySelector("[data-slot='avatar']");
    expect(avatar, "identity avatar").not.toBeNull();
    expect(avatar).toHaveAttribute("aria-hidden", "true");
    expect(
      header!.querySelector("[data-slot='avatar-fallback']"),
    ).toHaveTextContent(/^GS$/u);
    // The body is the flex child that owns the scroll and is allowed to shrink.
    expect(body.className).toContain("overflow-y-auto");
    expect(body.className).toContain("min-h-0");
    expect(body.className).toContain("flex-1");
  });

  it("keeps the footer and both close controls outside the scrolling body", () => {
    renderSheet();

    const body = sheetBody();
    const footer = document.querySelector<HTMLElement>(
      "[data-slot='sheet-footer']",
    );
    expect(footer, "footer").not.toBeNull();
    expect(footer!.closest("[data-pf-talento-sheet-body]")).toBeNull();

    const close = document.querySelector("[data-pf-talento-sheet-close]");
    expect(close, "footer close").not.toBeNull();
    expect(close!.closest("[data-pf-talento-sheet-body]")).toBeNull();
    expect(footer).toContainElement(close as HTMLElement);

    // The shared primitive's own close button also stays at panel level, so it
    // remains reachable over the cover and after the body scrolls.
    const nativeClose = document.querySelector("[data-slot='sheet-close']");
    expect(nativeClose, "native close").not.toBeNull();
    expect(nativeClose!.closest("[data-pf-talento-sheet-body]")).toBeNull();

    const content = document.querySelector<HTMLElement>(
      "[data-slot='sheet-content']",
    );
    expect(content).not.toBeNull();
    expect(content!.className).toContain("min-h-0");
    expect(content!.className).toContain("flex-col");
    // A shrink-0 footer never collapses the close target on a short panel.
    expect(footer!.className).toContain("shrink-0");
    expect(body.className).toContain("flex-1");
  });

  it("keeps the dialog name, the sections and both close actions accessible after the cover scrolls", () => {
    renderSheet();

    const body = sheetBody();
    expect(
      screen.getByRole("dialog", { name: "Gabriela Soto" }),
    ).toBeInTheDocument();
    // Every section and the full history live inside the scrolling body, so
    // they stay reachable once the identity has scrolled off.
    const sectionHeadings = Array.from(body.querySelectorAll("h3")).map(
      (heading) => heading.textContent ?? "",
    );
    expect(sectionHeadings).toEqual([
      "Habilidades",
      "Preferencias laborales",
      "Datos de contacto",
      "Perfil profesional",
      "Currículum",
      "Historial de postulaciones",
    ]);
    expect(body.querySelectorAll("[data-pf-talento-history-item]")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("wraps long unbroken identity, contact and history text instead of clipping it", () => {
    renderSheet(LONG_PERSON, { "long-vacancy": LONG_WORD });

    // `overflow-wrap: anywhere` also lowers the intrinsic min-content width,
    // which is what stops an unbroken 120-char token from forcing the panel into
    // horizontal overflow.
    const name = document.querySelector<HTMLElement>(
      "[data-pf-talento-sheet-name]",
    );
    expect(name, "sheet name").not.toBeNull();
    expect(name!.className).toContain("min-w-0");
    expect(name!.className).toContain("break-words");
    expect(name!.className).toContain("[overflow-wrap:anywhere]");
    expect(name).toHaveTextContent(LONG_WORD);

    const identityRow = name!.parentElement as HTMLElement;
    expect(identityRow.className).toContain("min-w-0");

    const description = document.querySelector<HTMLElement>(
      "[data-slot='sheet-description']",
    );
    expect(description, "sheet description").not.toBeNull();
    expect(description!.className).toContain("break-words");
    expect(description!.className).toContain("[overflow-wrap:anywhere]");

    // The identity badge is a fixed short enum value, so only the free-text
    // identity row needs the wrapping contract.
    const emailValue = within(dialog()).getByText(LONG_EMAIL);
    expect(emailValue.className).toContain("min-w-0");
    expect(emailValue.className).toContain("break-words");
    expect(emailValue.className).toContain("[overflow-wrap:anywhere]");

    const historyTitle = dialog().querySelector<HTMLElement>(
      "[data-pf-talento-history] span.min-w-0",
    );
    expect(historyTitle, "history vacancy title").not.toBeNull();
    expect(historyTitle!.className).toContain("break-words");
    expect(historyTitle!.className).toContain("[overflow-wrap:anywhere]");
    expect(historyTitle).toHaveTextContent(LONG_WORD);
  });

  it("renders the approved section order", () => {
    renderSheet();

    expect(sectionTitles()).toEqual([
      "Habilidades",
      "Preferencias laborales",
      "Datos de contacto",
      "Perfil profesional",
      "Currículum",
      "Historial de postulaciones",
    ]);
  });

  it("renders the Currículum placeholder card with a candidate-derived name and enabled inert actions", () => {
    renderSheet();

    const heading = screen.getByRole("heading", {
      level: 3,
      name: "Currículum",
    });
    const section = heading.closest("section") as HTMLElement;
    expect(section, "curriculum section").not.toBeNull();

    // The demo filename is derived from the candidate only: no invented file
    // size, no upload date and no other metadata is shown.
    expect(
      within(section).getByText("CV-Gabriela-Soto.pdf"),
    ).toBeInTheDocument();
    // The placeholder carries no visible demo/prototype disclaimer and no note id.
    expect(section.querySelector("#talento-detalle-curriculum-demo")).toBeNull();
    expect(within(section).queryByText(/demostración|prototipo/iu)).toBeNull();

    // The durable rule reserves `disabled` for real data/state restrictions and
    // keeps presentation placeholders enabled, focusable and inert. Both
    // affordances therefore stay standard enabled buttons.
    const verCv = within(section).getByRole("button", { name: "Ver CV" });
    const descargar = within(section).getByRole("button", {
      name: "Descargar",
    });
    for (const control of [verCv, descargar]) {
      expect(control).toBeEnabled();
      expect(control).toHaveAttribute("type", "button");
      expect(control).not.toHaveAttribute("aria-describedby");
      control.focus();
      expect(control).toHaveFocus();
    }

    // There is still no real file behind them: no link, no href, no `download`
    // and no `target`, so nothing can open a window, fetch or store anything.
    expect(within(section).queryAllByRole("link")).toHaveLength(0);
    expect(section.querySelector("a[href]")).toBeNull();
    expect(section.querySelector("[download]")).toBeNull();
    expect(section.querySelector("[href]")).toBeNull();
    expect(section.querySelector("[target]")).toBeNull();
  });

  it("gives the Currículum filename a usable width and moves its actions to a separate equal-column row", () => {
    renderSheet();

    const section = screen
      .getByRole("heading", { level: 3, name: "Currículum" })
      .closest("section") as HTMLElement;
    const card = section.querySelector<HTMLElement>(
      "[data-pf-talento-curriculum]",
    );
    expect(card, "curriculum card").not.toBeNull();

    // The card composes from its own local width. A `sm:` viewport row is the
    // regression: the floating Sheet panel is capped at 24rem even on a wide
    // desktop viewport, so a viewport breakpoint squeezes the filename into a
    // few-letters vertical column while the buttons keep their intrinsic width.
    expect(card!.className).toContain("flex-col");
    expect(card!.className).not.toContain("sm:flex-row");
    expect(card!.className).not.toContain("sm:items-center");

    const textRow = card!.querySelector<HTMLElement>(
      "[data-pf-talento-curriculum-text]",
    );
    const actionsRow = card!.querySelector<HTMLElement>(
      "[data-pf-talento-curriculum-actions]",
    );
    expect(textRow, "curriculum text row").not.toBeNull();
    expect(actionsRow, "curriculum actions row").not.toBeNull();

    // The actions are a sibling row below the text, not a third column in the
    // same horizontal row as the icon and filename.
    expect(textRow!.contains(actionsRow)).toBe(false);
    expect(
      textRow!.compareDocumentPosition(actionsRow!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(textRow!.className).toContain("min-w-0");

    // The filename owns the flexible width and can shrink below its intrinsic
    // size; the full name stays available through the title and the text node.
    const filename = card!.querySelector<HTMLElement>(
      "[data-pf-talento-curriculum-filename]",
    );
    expect(filename, "curriculum filename").not.toBeNull();
    expect(filename!.className).toContain("min-w-0");
    expect(filename!.className).toContain("truncate");
    expect(filename).toHaveTextContent("CV-Gabriela-Soto.pdf");
    expect(filename).toHaveAttribute("title", "CV-Gabriela-Soto.pdf");

    const textColumn = filename!.parentElement as HTMLElement;
    expect(textColumn.className).toContain("min-w-0");
    expect(textColumn.className).toContain("flex-1");
    // The filename rides alone in the flexible column: no disclaimer copy sits
    // beneath it.
    expect(textColumn).toContainElement(filename);
    expect(card!.querySelector("#talento-detalle-curriculum-demo")).toBeNull();

    // The action row is an equal-column wrapping grid: no intrinsic-width row
    // can push the panel wide, and both controls stay full-width targets.
    expect(actionsRow!.className).toContain("grid");
    expect(actionsRow!.className).toContain(
      "grid-cols-[repeat(auto-fit,minmax(7rem,1fr))]",
    );
    expect(actionsRow!.className).toContain("min-w-0");
    const verCv = within(card!).getByRole("button", { name: "Ver CV" });
    const descargar = within(card!).getByRole("button", {
      name: "Descargar",
    });
    for (const control of [verCv, descargar]) {
      expect(actionsRow).toContainElement(control);
      expect(control.className).toContain("w-full");
      expect(control.className).toContain("min-w-0");
    }
  });

  it("keeps the demo filename from forcing the panel wide for an unbroken name", () => {
    renderSheet(LONG_PERSON, { "long-vacancy": LONG_WORD });

    const filename = document.querySelector<HTMLElement>(
      "[data-pf-talento-curriculum-filename]",
    );
    expect(filename, "curriculum filename").not.toBeNull();
    expect(filename!.className).toContain("min-w-0");
    expect(filename!.className).toContain("truncate");
    const expected = `CV-${LONG_WORD}.pdf`;
    expect(filename).toHaveTextContent(expected);
    expect(filename).toHaveAttribute("title", expected);
  });

  it("keeps the Currículum placeholders inert: clicking neither changes the sheet nor reports success", () => {
    const { onOpenChange } = renderSheet();

    const section = screen
      .getByRole("heading", { level: 3, name: "Currículum" })
      .closest("section") as HTMLElement;
    const before = section.textContent;
    const verCv = within(section).getByRole("button", { name: "Ver CV" });
    const descargar = within(section).getByRole("button", {
      name: "Descargar",
    });

    fireEvent.click(verCv);
    fireEvent.click(descargar);

    // No handler, no navigation, no download and no fake success feedback: the
    // rendered surface is identical and the sheet stays open on the same person.
    expect(section.textContent).toBe(before);
    expect(
      screen.getByRole("dialog", { name: "Gabriela Soto" }),
    ).toBeInTheDocument();
    expect(verCv).toBeEnabled();
    expect(descargar).toBeEnabled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(
      within(section).queryByText(
        /descargado|descarga iniciada|éxito|abriendo|preparando/i,
      ),
    ).toBeNull();
  });

  it("preserves every profile field on the redesigned interior", () => {
    renderSheet();

    const sheet = dialog();
    // The industry appears on the identity badge and again in the profile tile.
    expect(within(sheet).getAllByText("Tecnología")).toHaveLength(2);
    expect(within(sheet).getByText("React")).toBeInTheDocument();
    expect(within(sheet).getByText("TypeScript")).toBeInTheDocument();
    expect(within(sheet).getByText("Híbrido")).toBeInTheDocument();
    expect(within(sheet).getByText("En dos semanas")).toBeInTheDocument();
    expect(within(sheet).getByText("gabriela-soto@ejemplo.mx")).toBeInTheDocument();
    expect(within(sheet).getByText("+52 55 1013 1007")).toBeInTheDocument();
    expect(within(sheet).getByText("Guadalajara")).toBeInTheDocument();
    expect(
      within(sheet).getByText("Licenciatura en Ingeniería en Computación"),
    ).toBeInTheDocument();
    expect(
      within(sheet).getByText("Español (Nativo) · Inglés (Avanzado)"),
    ).toBeInTheDocument();
    expect(within(sheet).getByText("5 años")).toBeInTheDocument();
  });

  it("reads the preference badges from the exported variant maps without a lifecycle dot", () => {
    renderSheet();

    const modality = badgeOf("Híbrido");
    expect(modality).toHaveAttribute(
      "data-variant",
      TALENT_MODALITY_VARIANT[PERSON.preferredModality],
    );
    expect(modality).not.toHaveAttribute("data-dot");

    const availability = badgeOf("En dos semanas");
    expect(availability).toHaveAttribute(
      "data-variant",
      TALENT_AVAILABILITY_VARIANT[PERSON.availability],
    );
    expect(availability).not.toHaveAttribute("data-dot");

    // Skills stay outline metadata, never a lifecycle dot.
    const skill = badgeOf("React");
    expect(skill).toHaveAttribute("data-variant", "outline");
    expect(skill).not.toHaveAttribute("data-dot");
  });

  it("renders the history most recent first with status dot, source, date and count", () => {
    renderSheet();

    const history = document.querySelector("[data-pf-talento-history]");
    expect(history, "history list").not.toBeNull();
    const items = Array.from(
      history!.querySelectorAll<HTMLElement>("[data-pf-talento-history-item]"),
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute(
      "data-pf-talento-history-vacancy",
      "fullstack-developer",
    );
    expect(items[1]).toHaveAttribute(
      "data-pf-talento-history-vacancy",
      "frontend-engineer-react",
    );

    expect(items[0]).toHaveTextContent("Fullstack Developer");
    expect(items[0]).toHaveTextContent("Nuevo");
    expect(items[0]).toHaveTextContent(
      `Postulación directa · ${formatTalentDate("2026-03-14T09:30:00Z")}`,
    );
    expect(items[1]).toHaveTextContent("Frontend Engineer (React)");
    expect(items[1]).toHaveTextContent("En revisión");
    expect(items[1]).toHaveTextContent(
      `LinkedIn · ${formatTalentDate("2026-03-11T15:00:00Z")}`,
    );

    // Only the lifecycle stage carries the decorative dot.
    const stage = within(items[0]).getByText("Nuevo").closest("[data-slot='badge']");
    expect(stage).toHaveAttribute("data-dot");
    expect(stage).toHaveAttribute("data-variant", "info");

    // The heading exposes the truthful application count.
    const heading = screen.getByRole("heading", {
      level: 3,
      name: "Historial de postulaciones",
    });
    expect(within(heading.parentElement as HTMLElement).getByText("2")).toBeInTheDocument();
  });

  it("falls back to the raw vacancy id when the title map has no entry", () => {
    renderSheet(PERSON, {});

    const history = document.querySelector("[data-pf-talento-history]");
    expect(history).not.toBeNull();
    expect(history).toHaveTextContent("fullstack-developer");
    expect(history).toHaveTextContent("frontend-engineer-react");
  });

  it("closes through the visible Spanish footer control", () => {
    const { onOpenChange } = renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));

    // Base UI appends its close-reason object after the boolean.
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange.mock.calls[0]?.[0]).toBe(false);
  });

  it("offers no fabricated action beyond the enabled inert Currículum and never invents a person status", () => {
    renderSheet();

    const sheet = dialog();
    for (const fake of [
      /contactar/i,
      /exportar/i,
      /enviar/i,
      /guardar/i,
      /match|score|compatibilidad/i,
    ]) {
      expect(within(sheet).queryByRole("button", { name: fake })).toBeNull();
      expect(within(sheet).queryByRole("link", { name: fake })).toBeNull();
    }

    // The Currículum may expose `Ver CV`/`Descargar`, but only as enabled
    // inert placeholders: no link, href, download or handler behind them.
    expect(within(sheet).getByRole("button", { name: "Ver CV" })).toBeEnabled();
    expect(within(sheet).getByRole("button", { name: "Descargar" })).toBeEnabled();
    expect(within(sheet).queryByRole("link", { name: /descargar/i })).toBeNull();
    expect(within(sheet).queryByRole("link", { name: /ver cv/i })).toBeNull();
    expect(within(sheet).queryByRole("link", { name: /contactar/i })).toBeNull();
  });

  it("renders nothing when no person is selected", () => {
    renderSheet(null);

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
