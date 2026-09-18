import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { RichTextField } from "./rich-text-field";

const FORM_DIR = join(process.cwd(), "src", "features", "jobs", "create", "form");
const source = readFileSync(join(FORM_DIR, "rich-text-field.tsx"), "utf8");

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

/** Controlled harness: the field never owns its own value. */
function Harness({
  initial = "",
  label = "Requisitos obligatorios",
}: {
  initial?: string;
  label?: string;
}) {
  const [value, setValue] = useState(initial);

  return (
    <RichTextField
      id="campo-en-prueba"
      label={label}
      value={value}
      onChange={setValue}
    />
  );
}

function textbox(name: string): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name }) as HTMLTextAreaElement;
}

describe("RichTextField accessible surface", () => {
  it("renders a labelled textarea with the five Spanish formatting actions", () => {
    render(
      <RichTextField
        id="descripcion"
        label="Descripción del puesto"
        value=""
        onChange={vi.fn()}
      />,
    );

    expect(textbox("Descripción del puesto").tagName).toBe("TEXTAREA");
    expect(
      screen.getByRole("toolbar", { name: "Formato de Descripción del puesto" }),
    ).toBeVisible();

    for (const name of ACTIONS) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeVisible();
      // Toolbar controls must never submit the surrounding form.
      expect(button).toHaveAttribute("type", "button");
    }
  });

  it("discloses that the formatting is a prototype and that nothing is saved", () => {
    render(
      <RichTextField
        id="descripcion"
        label="Descripción del puesto"
        value=""
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText(DISCLOSURE)).toBeVisible();
  });

  it("marks a prototype surface and leaves a contract surface unmarked", () => {
    const { rerender } = render(
      <RichTextField id="r" label="Requisitos obligatorios" value="" onChange={vi.fn()} prototype />,
    );
    expect(screen.getByText("Prototipo")).toBeVisible();

    rerender(
      <RichTextField
        id="r"
        label="Descripción del puesto"
        value=""
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("Prototipo")).toBeNull();
  });

  it("wires an optional error to aria-invalid and the error slot", () => {
    render(
      <RichTextField
        id="vacancy-description"
        label="Descripción del puesto"
        value=""
        onChange={vi.fn()}
        error="Ingresá una descripción para la vacante."
      />,
    );

    const control = textbox("Descripción del puesto");
    const error = screen.getByRole("alert");

    expect(error).toHaveAttribute("id", "vacancy-description-error");
    expect(error).toHaveTextContent("Ingresá una descripción para la vacante.");
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveAttribute(
      "aria-describedby",
      "vacancy-description-disclosure vacancy-description-error",
    );
  });

  it("always references the prototype disclosure from the textarea", () => {
    render(
      <RichTextField
        id="campo"
        label="Requisitos obligatorios"
        value=""
        onChange={vi.fn()}
      />,
    );

    const control = textbox("Requisitos obligatorios");

    expect(control).toHaveAttribute("aria-describedby", "campo-disclosure");
    expect(document.getElementById("campo-disclosure")).toHaveTextContent(
      DISCLOSURE,
    );
    expect(control).toHaveAccessibleDescription(DISCLOSURE);
  });

  it("adds the error slot to the disclosure instead of replacing it", () => {
    render(
      <RichTextField
        id="campo"
        label="Requisitos obligatorios"
        value=""
        onChange={vi.fn()}
        error="Falta la descripción."
      />,
    );

    const control = textbox("Requisitos obligatorios");

    expect(control).toHaveAttribute(
      "aria-describedby",
      "campo-disclosure campo-error",
    );
    // The computed accessible description carries both referenced nodes.
    expect(control).toHaveAccessibleDescription(
      `${DISCLOSURE} Falta la descripción.`,
    );
  });

  /** Every id `RichTextField` owns for a given `id`; none may be shadowed. */
  const RESERVED_OWNED_IDS = [
    "campo",
    "campo-disclosure",
    "campo-link",
    "campo-link-error",
  ];

  it.each(RESERVED_OWNED_IDS)(
    "reserves the component id namespace and repoints a colliding errorId %s",
    (colliding) => {
      render(
        <RichTextField
          id="campo"
          label="Requisitos obligatorios"
          value=""
          onChange={vi.fn()}
          error="Falta la descripción."
          errorId={colliding}
        />,
      );

      const control = textbox("Requisitos obligatorios");
      const error = screen.getByRole("alert");

      // A collision never wins: the field error resolves deterministically.
      expect(error).toHaveAttribute("id", "campo-error");
      expect(error).toHaveTextContent("Falta la descripción.");
      expect(control).toHaveAttribute(
        "aria-describedby",
        "campo-disclosure campo-error",
      );

      // The rendered component ids stay unique, and each has one owner.
      expect(document.querySelectorAll("#campo")).toHaveLength(1);
      expect(document.querySelectorAll("#campo-disclosure")).toHaveLength(1);
      expect(document.querySelectorAll("#campo-link")).toHaveLength(1);
      expect(document.querySelectorAll("#campo-error")).toHaveLength(1);
    },
  );

  it.each(["campo-error", "campo-mensaje"])(
    "keeps a non-reserved caller error id verbatim: %s",
    (errorId) => {
      render(
        <RichTextField
          id="campo"
          label="Requisitos obligatorios"
          value=""
          onChange={vi.fn()}
          error="Falta la descripción."
          errorId={errorId}
        />,
      );

      expect(screen.getByRole("alert")).toHaveAttribute("id", errorId);
      expect(textbox("Requisitos obligatorios")).toHaveAttribute(
        "aria-describedby",
        `campo-disclosure ${errorId}`,
      );
    },
  );

  it("keeps field and link errors distinct when both validate at once", () => {
    render(
      <RichTextField
        id="campo"
        label="Requisitos obligatorios"
        value="Mirá la guía"
        onChange={vi.fn()}
        error="Falta la descripción."
        errorId="campo-link-error"
      />,
    );

    fireEvent.change(screen.getByLabelText("Dirección del enlace"), {
      target: { value: "javascript:alert(1)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agregar enlace" }));

    const control = textbox("Requisitos obligatorios");
    const linkInput = screen.getByLabelText("Dirección del enlace");

    // Both alerts are present with their own distinct ids.
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    for (const owned of [
      "campo",
      "campo-disclosure",
      "campo-link",
      "campo-link-error",
      "campo-error",
    ]) {
      expect(
        document.querySelectorAll(`#${owned}`),
        `#${owned} must have exactly one owner`,
      ).toHaveLength(1);
    }

    expect(document.getElementById("campo-error")).toHaveTextContent(
      "Falta la descripción.",
    );
    expect(document.getElementById("campo-link-error")).toHaveTextContent(
      "Ingresá un enlace que empiece con http:// o https://.",
    );

    // Each control references its own distinct error.
    expect(control).toHaveAttribute(
      "aria-describedby",
      "campo-disclosure campo-error",
    );
    expect(linkInput).toHaveAttribute("aria-describedby", "campo-link-error");
    expect(control).toHaveAccessibleDescription(
      `${DISCLOSURE} Falta la descripción.`,
    );
  });
});

describe("RichTextField live preview", () => {
  it("labels the preview region and explains an empty value", () => {
    render(
      <RichTextField
        id="r"
        label="Requisitos obligatorios"
        value=""
        onChange={vi.fn()}
      />,
    );

    const preview = screen.getByRole("region", {
      name: "Vista previa de Requisitos obligatorios",
    });

    expect(preview).toHaveAttribute("aria-live", "polite");
    expect(within(preview).getByText("Sin contenido todavía.")).toBeVisible();
  });

  it("renders the safe model as real elements for bold, lists, and links", () => {
    render(
      <RichTextField
        id="r"
        label="Requisitos"
        value={"**Fuerte**\n\n- React\n\n[Guía](https://empresa.example)"}
        onChange={vi.fn()}
      />,
    );

    const preview = screen.getByRole("region", {
      name: "Vista previa de Requisitos",
    });

    expect(within(preview).getByText("Fuerte").tagName).toBe("STRONG");
    expect(within(preview).getByRole("list")).toBeVisible();
    expect(within(preview).getByRole("listitem")).toHaveTextContent("React");
    expect(within(preview).getByRole("link", { name: "Guía" })).toHaveAttribute(
      "href",
      "https://empresa.example",
    );
  });

  it("renders an unsafe link inert instead of as an anchor", () => {
    render(
      <RichTextField
        id="r"
        label="Requisitos"
        value={"[Peligro](javascript:alert(1))"}
        onChange={vi.fn()}
      />,
    );

    const preview = screen.getByRole("region", {
      name: "Vista previa de Requisitos",
    });

    expect(within(preview).queryByRole("link")).toBeNull();
    expect(within(preview).getByText("Peligro")).toBeVisible();
  });
});

describe("RichTextField formatting actions", () => {
  it("reports the typed value through onChange", () => {
    const onChange = vi.fn();
    render(
      <RichTextField id="d" label="Descripción del puesto" value="" onChange={onChange} />,
    );

    fireEvent.change(textbox("Descripción del puesto"), {
      target: { value: "Diseñá los servicios core." },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("Diseñá los servicios core.");
  });

  it("applies bold to the current textarea selection and restores the selection", () => {
    render(<Harness initial="hola mundo" />);
    const control = textbox("Requisitos obligatorios");
    control.setSelectionRange(0, 4);

    fireEvent.click(screen.getByRole("button", { name: "Negrita" }));

    expect(control).toHaveValue("**hola** mundo");
    expect(control.selectionStart).toBe(2);
    expect(control.selectionEnd).toBe(6);
  });

  it("applies a bullet list to the caret line", () => {
    render(<Harness initial={"uno\ndos"} />);
    const control = textbox("Requisitos obligatorios");
    control.setSelectionRange(5, 5);

    fireEvent.click(screen.getByRole("button", { name: "Lista con viñetas" }));

    expect(control).toHaveValue("uno\n- dos");
  });





  it("adds a link around the selection for an accepted protocol", () => {
    render(<Harness initial="Mirá la guía" />);
    const control = textbox("Requisitos obligatorios");

    fireEvent.change(screen.getByLabelText("Dirección del enlace"), {
      target: { value: "https://empresa.example/guia" },
    });
    control.setSelectionRange(5, 12);
    fireEvent.click(screen.getByRole("button", { name: "Agregar enlace" }));

    expect(control).toHaveValue("Mirá [la guía](https://empresa.example/guia)");
    expect(control.selectionStart).toBe(6);
    expect(control.selectionEnd).toBe(13);
  });

  it("rejects an unsafe link without touching the value", () => {
    render(<Harness initial="Mirá la guía" />);
    const control = textbox("Requisitos obligatorios");

    fireEvent.change(screen.getByLabelText("Dirección del enlace"), {
      target: { value: "javascript:alert(1)" },
    });
    control.setSelectionRange(5, 12);
    fireEvent.click(screen.getByRole("button", { name: "Agregar enlace" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Ingresá un enlace que empiece con http:// o https://.",
    );
    expect(control).toHaveValue("Mirá la guía");
    expect(screen.getByLabelText("Dirección del enlace")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("rejects a structurally malformed absolute address without touching the value", () => {
    render(<Harness initial="Mirá la guía" />);
    const control = textbox("Requisitos obligatorios");

    fireEvent.change(screen.getByLabelText("Dirección del enlace"), {
      target: { value: "https://)" },
    });
    control.setSelectionRange(5, 12);
    fireEvent.click(screen.getByRole("button", { name: "Agregar enlace" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Ingresá un enlace que empiece con http:// o https://.",
    );
    // No token with surplus punctuation may enter the value.
    expect(control).toHaveValue("Mirá la guía");
  });
});

describe("RichTextField source boundary", () => {
  it("never uses an unsafe rendering escape hatch", () => {
    for (const forbidden of [
      "innerHTML",
      "dangerouslySetInnerHTML",
      "contentEditable",
      "execCommand",
    ]) {
      expect(source).not.toContain(forbidden);
    }
    // No markup-language claim anywhere in the surface.
    expect(source).not.toMatch(/\bHTML\b/u);
  });

  it("reuses the existing shadcn primitives and stays off the request path", () => {
    expect(source).toMatch(/from "@\/components\/ui\/textarea"/);
    expect(source).toMatch(/from "@\/components\/ui\/button"/);
    expect(source).toMatch(/from "@\/components\/ui\/field"/);
    expect(source).toMatch(/from "\.\/rich-text-model"/);
    expect(source).not.toMatch(/createJob|requestJson|schemas|zod|lib\/api/);
    expect(source).not.toMatch(/\bfetch\s*\(/u);
  });
});
