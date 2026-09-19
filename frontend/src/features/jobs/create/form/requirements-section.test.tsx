import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { RequirementsSection } from "./requirements-section";
import { sectionAnchorId, sectionTitle } from "./section-metadata";

const FORM_DIR = join(process.cwd(), "src", "features", "jobs", "create", "form");
const source = readFileSync(join(FORM_DIR, "requirements-section.tsx"), "utf8");

const DISCLOSURE = "Formato visual de prototipo; todavía no se guarda.";
const ACTIONS = [
  "Negrita",
  "Cursiva",
  "Lista con viñetas",
  "Lista numerada",
  "Agregar enlace",
];

afterEach(() => {
  cleanup();
});

function renderSection(
  overrides: { descriptionError?: string; descriptionRich?: string } = {},
) {
  const onChangeDescriptionRich = vi.fn();
  const onChangeRequiredRequirements = vi.fn();
  const onChangePreferredRequirements = vi.fn();

  render(
    <RequirementsSection
      descriptionRich={overrides.descriptionRich ?? ""}
      requiredRequirements=""
      preferredRequirements=""
      descriptionError={overrides.descriptionError}
      onChangeDescriptionRich={onChangeDescriptionRich}
      onChangeRequiredRequirements={onChangeRequiredRequirements}
      onChangePreferredRequirements={onChangePreferredRequirements}
    />,
  );

  return {
    onChangeDescriptionRich,
    onChangeRequiredRequirements,
    onChangePreferredRequirements,
  };
}

function textbox(name: string): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name }) as HTMLTextAreaElement;
}

describe("RequirementsSection composition", () => {
  it("composes the contract description and both prototype requirement fields", () => {
    renderSection();

    expect(
      screen.getByRole("heading", { name: "Descripción y requisitos" }),
    ).toBeVisible();
    expect(textbox("Descripción del puesto").tagName).toBe("TEXTAREA");
    expect(textbox("Requisitos obligatorios").tagName).toBe("TEXTAREA");
    expect(textbox("Requisitos deseables").tagName).toBe("TEXTAREA");
  });

  it("offers the same formatting actions on all three fields", () => {
    renderSection();

    for (const label of [
      "Descripción del puesto",
      "Requisitos obligatorios",
      "Requisitos deseables",
    ]) {
      expect(
        screen.getByRole("toolbar", { name: `Formato de ${label}` }),
      ).toBeVisible();
    }
    for (const action of ACTIONS) {
      expect(screen.getAllByRole("button", { name: action })).toHaveLength(3);
    }
  });

  it("discloses the prototype formatting on every field and marks only the prototype ones", () => {
    renderSection();

    // The formatting surface is a prototype on all three fields, but only the
    // two fields without a contract counterpart carry the prototype badge.
    expect(screen.getAllByText(DISCLOSURE)).toHaveLength(3);
    expect(screen.getAllByText("Prototipo")).toHaveLength(2);
  });

  it("renders the tokenized prototype description on the contract field", () => {
    renderSection({ descriptionRich: "**Fuerte** experiencia" });

    // The editing surface owns the rich value; the contract owns derived text.
    expect(textbox("Descripción del puesto")).toHaveValue(
      "**Fuerte** experiencia",
    );
  });

  it("wires the contract description error slot for the integrated form", () => {
    renderSection({ descriptionError: "Ingresá una descripción para la vacante." });

    const control = textbox("Descripción del puesto");
    const error = screen.getByRole("alert");

    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAttribute(
      "aria-describedby",
      "vacancy-description-disclosure vacancy-description-error",
    );
    expect(error).toHaveAttribute("id", "vacancy-description-error");
  });
});

describe("RequirementsSection callbacks", () => {
  it("reports each field through its own callback only", () => {
    const spies = renderSection();

    fireEvent.change(textbox("Requisitos obligatorios"), {
      target: { value: "5 años de experiencia con React." },
    });

    expect(spies.onChangeRequiredRequirements).toHaveBeenCalledTimes(1);
    expect(spies.onChangeRequiredRequirements).toHaveBeenCalledWith(
      "5 años de experiencia con React.",
    );
    expect(spies.onChangeDescriptionRich).not.toHaveBeenCalled();
    expect(spies.onChangePreferredRequirements).not.toHaveBeenCalled();

    fireEvent.change(textbox("Requisitos deseables"), {
      target: { value: "Experiencia con PostgreSQL." },
    });

    expect(spies.onChangePreferredRequirements).toHaveBeenCalledTimes(1);
    expect(spies.onChangePreferredRequirements).toHaveBeenCalledWith(
      "Experiencia con PostgreSQL.",
    );
    expect(spies.onChangeDescriptionRich).not.toHaveBeenCalled();

    fireEvent.change(textbox("Descripción del puesto"), {
      target: { value: "Diseñá los servicios core." },
    });

    expect(spies.onChangeDescriptionRich).toHaveBeenCalledTimes(1);
    expect(spies.onChangeDescriptionRich).toHaveBeenCalledWith(
      "Diseñá los servicios core.",
    );
  });

  it("keeps each field's toolbar bound to its own callback", () => {
    const spies = renderSection();

    const preferred = textbox("Requisitos deseables");
    preferred.setSelectionRange(0, 0);

    fireEvent.click(
      screen.getAllByRole("button", { name: "Lista numerada" })[2],
    );

    expect(spies.onChangePreferredRequirements).toHaveBeenCalledTimes(1);
    expect(spies.onChangeRequiredRequirements).not.toHaveBeenCalled();
    expect(spies.onChangeDescriptionRich).not.toHaveBeenCalled();
  });
});

describe("RequirementsSection layout foundation", () => {
  it("renders one migrated foundation card anchored on the canonical metadata", () => {
    renderSection();

    const card = screen
      .getByRole("heading", {
        level: 2,
        name: sectionTitle("description-requirements"),
      })
      .closest('[data-slot="card"]');

    expect(card).toHaveAttribute("data-pf-section-card");
    expect(card).toHaveAttribute(
      "id",
      sectionAnchorId("description-requirements"),
    );
    expect(card).toHaveAttribute("data-size", "sm");
    expect(card?.className).toContain("h-fit");
    // One card only: it owns its section chrome and no legacy shell survives.
    expect(document.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
    expect(card?.querySelector(".size-8.rounded-xl")).toBeNull();
  });

  it("composes the shared card through the canonical section metadata", () => {
    expect(source).toMatch(/from "\.\/form-section-card"/);
    expect(source).toMatch(/<FormSectionCard/);
    expect(source).toMatch(/sectionAnchorId\("description-requirements"\)/);
    expect(source).toMatch(/sectionTitle\("description-requirements"\)/);
    expect(source).not.toMatch(/from "\.\/controls"/);
    expect(source).not.toMatch(/<FormSection[\s>]/);
  });
});

describe("RequirementsSection boundaries", () => {
  it("delegates all formatting to the shared safe field without duplicating it", () => {
    expect(source).toMatch(/from "\.\/rich-text-field"/);
    expect(source).not.toMatch(
      /parseRichText|sanitizeLinkUrl|applyBold|applyItalic|applyBulletList|applyNumberedList|applyLink/,
    );
    expect(source).not.toMatch(/dangerouslySetInnerHTML|innerHTML|contentEditable/);
  });

  it("stays off the request contract and the network layer", () => {
    expect(source).not.toMatch(
      /createJob|requestJson|schemas|zod|lib\/api|createJobRequestSchema/,
    );
    expect(source).not.toMatch(/\bfetch\s*\(/u);
  });
});
