import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { RequirementsSection } from "./requirements-section";

const FORM_DIR = join(process.cwd(), "src", "features", "jobs", "create", "form");
const source = readFileSync(join(FORM_DIR, "requirements-section.tsx"), "utf8");

const FORMAT_ACTIONS = [
  "Negrita",
  "Cursiva",
  "Lista con viñetas",
  "Lista numerada",
  "Enlace",
];

afterEach(() => {
  cleanup();
});

function renderSection(
  overrides: {
    descriptionError?: string;
    descriptionRich?: string;
    requiredRequirements?: string;
    preferredRequirements?: string;
  } = {},
) {
  const onChangeDescriptionRich = vi.fn();
  const onChangeRequiredRequirements = vi.fn();
  const onChangePreferredRequirements = vi.fn();

  render(
    <RequirementsSection
      descriptionRich={overrides.descriptionRich ?? ""}
      requiredRequirements={overrides.requiredRequirements ?? ""}
      preferredRequirements={overrides.preferredRequirements ?? ""}
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
  it("composes the contract description and both plain requirement fields", () => {
    renderSection();

    // The step shell owns the heading; this module is a card-less field group.
    expect(screen.queryByRole("heading")).toBeNull();
    expect(textbox("Descripción del puesto").tagName).toBe("TEXTAREA");
    expect(textbox("Requisitos obligatorios").tagName).toBe("TEXTAREA");
    expect(textbox("Requisitos deseables").tagName).toBe("TEXTAREA");

    // The description keeps its taller editor; the requirements keep their rows.
    expect(textbox("Descripción del puesto")).toHaveAttribute("rows", "6");
    expect(textbox("Descripción del puesto")).toHaveAttribute(
      "placeholder",
      "Describe el rol, el equipo y el impacto del puesto.",
    );
    expect(textbox("Requisitos obligatorios")).toHaveAttribute("rows", "4");
    expect(textbox("Requisitos deseables")).toHaveAttribute("rows", "4");
  });

  it("keeps the formatting toolbar on the description only", () => {
    renderSection();

    const toolbars = screen.getAllByRole("toolbar");
    expect(toolbars).toHaveLength(1);
    expect(toolbars[0]).toHaveAccessibleName("Formato de Descripción del puesto");

    // Every formatting action exists exactly once, on the description.
    for (const action of FORMAT_ACTIONS) {
      expect(screen.getAllByRole("button", { name: action })).toHaveLength(1);
    }

    // The requirement surfaces carry no editor toolbars and no mode switch.
    expect(
      screen.queryByRole("toolbar", { name: "Formato de Requisitos obligatorios" }),
    ).toBeNull();
    expect(
      screen.queryByRole("toolbar", { name: "Formato de Requisitos deseables" }),
    ).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("renders no implementation-status copy or prototype badge on any field", () => {
    renderSection();

    expect(screen.queryByText(/prototipo|todavía no se guarda/i)).toBeNull();
    expect(screen.queryByText("Prototipo")).toBeNull();
  });

  it("renders the tokenized description on the contract field", () => {
    renderSection({ descriptionRich: "**Fuerte** experiencia" });

    // The editing surface owns the rich value; the contract owns derived text.
    expect(textbox("Descripción del puesto")).toHaveValue(
      "**Fuerte** experiencia",
    );
  });

  it("keeps the requirement values untouched by the control change", () => {
    renderSection({
      requiredRequirements: "5 años de experiencia con React.",
      preferredRequirements: "Experiencia con PostgreSQL.",
    });

    expect(textbox("Requisitos obligatorios")).toHaveValue(
      "5 años de experiencia con React.",
    );
    expect(textbox("Requisitos deseables")).toHaveValue(
      "Experiencia con PostgreSQL.",
    );
  });

  it("wires the contract description error slot for the integrated form", () => {
    renderSection({ descriptionError: "Ingresa una descripción para la vacante." });

    const control = textbox("Descripción del puesto");
    const error = screen.getByRole("alert");

    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAttribute(
      "aria-describedby",
      "vacancy-description-error",
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

  it("keeps the plain requirement change contract free of formatting", () => {
    const spies = renderSection();

    const required = textbox("Requisitos obligatorios");
    expect(required.closest('[role="group"]')).not.toBeNull();

    // A plain textarea reports the raw value: no toolbar can rewrite it.
    fireEvent.change(required, { target: { value: "- texto plano **sin formato**" } });
    expect(spies.onChangeRequiredRequirements).toHaveBeenCalledWith(
      "- texto plano **sin formato**",
    );
    expect(screen.getAllByRole("toolbar")).toHaveLength(1);
  });

  it("keeps the description toolbar bound to the description callback", () => {
    const spies = renderSection();

    const description = textbox("Descripción del puesto");
    description.setSelectionRange(0, 0);

    fireEvent.click(screen.getByRole("button", { name: "Lista numerada" }));

    expect(spies.onChangeDescriptionRich).toHaveBeenCalledTimes(1);
    expect(spies.onChangeRequiredRequirements).not.toHaveBeenCalled();
    expect(spies.onChangePreferredRequirements).not.toHaveBeenCalled();
  });

  it("keeps the description mode switch free of any value callback", () => {
    const spies = renderSection();

    fireEvent.click(screen.getByRole("tab", { name: "Vista previa" }));

    expect(spies.onChangeDescriptionRich).not.toHaveBeenCalled();
    expect(spies.onChangeRequiredRequirements).not.toHaveBeenCalled();
    expect(spies.onChangePreferredRequirements).not.toHaveBeenCalled();

    const preview = screen.getByRole("region", {
      name: "Vista previa de Descripción del puesto",
    });
    expect(within(preview).getByText("Sin contenido todavía.")).toBeVisible();
  });
});

describe("RequirementsSection field-group boundary", () => {
  it("renders one field group with no card chrome of its own", () => {
    const { container } = render(
      <RequirementsSection
        descriptionRich=""
        requiredRequirements=""
        preferredRequirements=""
        onChangeDescriptionRich={vi.fn()}
        onChangeRequiredRequirements={vi.fn()}
        onChangePreferredRequirements={vi.fn()}
      />,
    );

    // The wizard step shell owns the single card of the step.
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(0);
    expect(container.querySelector('[data-slot="field-group"]')).not.toBeNull();
  });

  it("keeps the card out of the field group and delegates chrome to the step", () => {
    expect(source).not.toMatch(/from "\.\/form-section-card"/);
    expect(source).not.toMatch(/<FormSectionCard/);
    expect(source).not.toMatch(/sectionAnchorId|sectionTitle/);
    expect(source).not.toMatch(/from "\.\/controls"/);
    expect(source).not.toMatch(/<FormSection[\s>]/);
  });
});

describe("RequirementsSection boundaries", () => {
  it("delegates all description formatting to the shared safe field", () => {
    expect(source).toMatch(/from "\.\/rich-text-field"/);
    expect(source).not.toMatch(
      /parseRichText|sanitizeLinkUrl|applyBold|applyItalic|applyBulletList|applyNumberedList|applyLink/,
    );
    expect(source).not.toMatch(/dangerouslySetInnerHTML|innerHTML|contentEditable/);
  });

  it("renders the requirement surfaces with the installed textarea primitive", () => {
    expect(source).toMatch(/from "@\/components\/ui\/textarea"/);
    expect(source).toMatch(/<Textarea/);
    // No second rich surface is composed here.
    expect(source.match(/<RichTextField/g)).toHaveLength(1);
  });

  it("stays off the request contract and the network layer", () => {
    expect(source).not.toMatch(
      /createJob|requestJson|schemas|zod|lib\/api|createJobRequestSchema/,
    );
    expect(source).not.toMatch(/\bfetch\s*\(/u);
  });
});
