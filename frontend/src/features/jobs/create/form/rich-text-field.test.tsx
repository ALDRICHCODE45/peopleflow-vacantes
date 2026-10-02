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

/**
 * Base UI's portalled popup waits on browser positioning and exit transitions
 * that jsdom cannot complete, which makes opening it many times per file very
 * slow. This layered adapter keeps the component's real controlled
 * open/onValueChange contract, its title/description relationship, and its
 * `finalFocus` restore executable; the installed popup itself is covered by
 * `src/components/ui/popover.test.tsx`.
 */
vi.mock("@/components/ui/popover", async () => {
  const React = await import("react");
  type PopoverState = Readonly<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    labelId: string | null;
    descriptionId: string | null;
    setLabelId: (id: string) => void;
    setDescriptionId: (id: string) => void;
  }>;
  const Context = React.createContext<PopoverState | null>(null);

  function usePopover(): PopoverState {
    const state = React.useContext(Context);
    if (state === null) throw new Error("Popover part requires Popover");
    return state;
  }

  function Popover({
    open = false,
    onOpenChange = () => undefined,
    children,
  }: Readonly<{
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children?: React.ReactNode;
  }>) {
    const [labelId, setLabelId] = React.useState<string | null>(null);
    const [descriptionId, setDescriptionId] = React.useState<string | null>(null);
    return (
      <Context.Provider
        value={{
          open,
          onOpenChange,
          labelId,
          descriptionId,
          setLabelId,
          setDescriptionId,
        }}
      >
        {children}
      </Context.Provider>
    );
  }

  function PopoverTrigger({
    render,
    ...props
  }: Readonly<{
    render?: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
  }>) {
    const state = usePopover();
    if (render === undefined) throw new Error("PopoverTrigger requires a render element");
    const { onClick, ...rest } = render.props;
    return React.cloneElement(render, {
      ...rest,
      ...props,
      "aria-expanded": state.open,
      "aria-haspopup": "dialog",
      onClick: (event: React.MouseEvent<HTMLElement>) => {
        onClick?.(event);
        if (!event.defaultPrevented) state.onOpenChange(!state.open);
      },
    } as React.HTMLAttributes<HTMLElement>);
  }

  function PopoverContent({
    finalFocus,
    children,
  }: Readonly<{
    finalFocus?: React.RefObject<HTMLElement | null>;
    children?: React.ReactNode;
  }>) {
    const state = usePopover();
    const wasOpen = React.useRef(false);

    React.useEffect(() => {
      if (wasOpen.current && !state.open) finalFocus?.current?.focus();
      wasOpen.current = state.open;
    }, [state.open, finalFocus]);

    if (!state.open) return null;
    return (
      <div
        role="dialog"
        data-slot="popover-content"
        aria-labelledby={state.labelId ?? undefined}
        aria-describedby={state.descriptionId ?? undefined}
      >
        {children}
      </div>
    );
  }

  function PopoverHeader({ children }: Readonly<{ children?: React.ReactNode }>) {
    return <div data-slot="popover-header">{children}</div>;
  }

  function PopoverTitle({ children }: Readonly<{ children?: React.ReactNode }>) {
    const { setLabelId } = usePopover();
    const id = React.useId();
    React.useEffect(() => setLabelId(id), [id, setLabelId]);
    return (
      <div data-slot="popover-title" id={id}>
        {children}
      </div>
    );
  }

  function PopoverDescription({ children }: Readonly<{ children?: React.ReactNode }>) {
    const { setDescriptionId } = usePopover();
    const id = React.useId();
    React.useEffect(() => setDescriptionId(id), [id, setDescriptionId]);
    return (
      <p data-slot="popover-description" id={id}>
        {children}
      </p>
    );
  }

  return {
    Popover,
    PopoverTrigger,
    PopoverContent,
    PopoverHeader,
    PopoverTitle,
    PopoverDescription,
  };
});

const FORM_DIR = join(process.cwd(), "src", "features", "jobs", "create", "form");
const source = readFileSync(join(FORM_DIR, "rich-text-field.tsx"), "utf8");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The formatting actions the safe model supports, plus the link editor. */
const FORMAT_ACTIONS = [
  "Negrita",
  "Cursiva",
  "Lista con viñetas",
  "Lista numerada",
  "Enlace",
];
const MODES = ["Escribir", "Vista previa"];
const UNSAFE_LINK_MESSAGE =
  "Ingresa un enlace que empiece con http:// o https://.";

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

/** Switches the editor between its two explicit modes. */
function showMode(mode: (typeof MODES)[number]) {
  fireEvent.click(screen.getByRole("tab", { name: mode }));
}

/** Opens the link editor through its toolbar trigger. */
function openLinkEditor() {
  fireEvent.click(screen.getByRole("button", { name: "Enlace" }));
}

/**
 * Dismisses the portalled editor so an open popup never blocks test teardown;
 * the Base UI exit transition otherwise keeps the environment alive.
 */
function dismissLinkEditor() {
  const dialog = screen.queryByRole("dialog");
  if (dialog === null) return;
  fireEvent.keyDown(dialog, { key: "Escape" });
}

describe("RichTextField accessible surface", () => {
  it("renders a labelled textarea with the formatting toolbar and the two editor modes", () => {
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

    for (const name of FORMAT_ACTIONS) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeVisible();
      // Toolbar controls must never submit the surrounding form.
      expect(button).toHaveAttribute("type", "button");
      // Standalone toolbar actions keep a 40px target.
      expect(button).toHaveClass("h-10");
    }

    for (const name of MODES) {
      expect(screen.getByRole("tab", { name })).toBeVisible();
    }
    expect(screen.getByRole("tab", { name: "Escribir" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // The link editor stays closed until the recruiter asks for it.
    expect(
      screen.queryByRole("button", { name: "Agregar enlace" }),
    ).toBeNull();
  });

  it("renders no implementation-status copy beside the formatting surface", () => {
    render(
      <RichTextField
        id="descripcion"
        label="Descripción del puesto"
        value=""
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByText(/prototipo/i)).toBeNull();
    expect(screen.queryByText(/todavía no se guarda/i)).toBeNull();
    expect(screen.queryByText(/exploratori/i)).toBeNull();
  });

  it("renders no prototype badge on a local-only surface or a contract surface", () => {
    const { rerender } = render(
      <RichTextField id="r" label="Requisitos obligatorios" value="" onChange={vi.fn()} prototype />,
    );
    expect(screen.queryByText("Prototipo")).toBeNull();

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
        error="Ingresa una descripción para la vacante."
      />,
    );

    const control = textbox("Descripción del puesto");
    const error = screen.getByRole("alert");

    expect(error).toHaveAttribute("id", "vacancy-description-error");
    expect(error).toHaveTextContent("Ingresa una descripción para la vacante.");
    expect(control).toHaveAttribute("aria-invalid", "true");
    expect(control).toHaveClass("text-foreground");
    expect(control).toHaveAttribute(
      "aria-describedby",
      "vacancy-description-error",
    );
  });

  it("references no description while the field is valid", () => {
    render(
      <RichTextField
        id="campo"
        label="Requisitos obligatorios"
        value=""
        onChange={vi.fn()}
      />,
    );

    const control = textbox("Requisitos obligatorios");

    expect(control).not.toHaveAttribute("aria-describedby");
    expect(document.getElementById("campo-disclosure")).toBeNull();
    expect(control).toHaveAccessibleDescription("");
  });

  it("describes the control with the error slot only", () => {
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

    expect(control).toHaveAttribute("aria-describedby", "campo-error");
    expect(control).toHaveAccessibleDescription("Falta la descripción.");
  });

  /** Every id `RichTextField` owns for a given `id`; none may be shadowed. */
  const RESERVED_OWNED_IDS = ["campo", "campo-link", "campo-link-error"];

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

      openLinkEditor();

      const control = textbox("Requisitos obligatorios");
      const error = screen.getByRole("alert");

      // A collision never wins: the field error resolves deterministically.
      expect(error).toHaveAttribute("id", "campo-error");
      expect(error).toHaveTextContent("Falta la descripción.");
      expect(control).toHaveAttribute("aria-describedby", "campo-error");

      // The rendered component ids stay unique, and each has one owner.
      expect(document.querySelectorAll("#campo")).toHaveLength(1);
      expect(document.querySelectorAll("#campo-link")).toHaveLength(1);
      expect(document.querySelectorAll("#campo-error")).toHaveLength(1);

      dismissLinkEditor();
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
        errorId,
      );
    },
  );

  it("states the link editor description in neutral Mexican Spanish", () => {
    render(<Harness />);
    openLinkEditor();

    expect(
      screen.getByText("Pega una dirección que empiece con http:// o https://."),
    ).toBeVisible();
    dismissLinkEditor();
  });

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

    openLinkEditor();
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
      UNSAFE_LINK_MESSAGE,
    );

    // Each control references its own distinct error.
    expect(control).toHaveAttribute("aria-describedby", "campo-error");
    expect(linkInput).toHaveAttribute("aria-describedby", "campo-link-error");
    expect(control).toHaveAccessibleDescription("Falta la descripción.");

    dismissLinkEditor();
  });
});

describe("RichTextField editor modes", () => {
  it("shows exactly one surface at a time and keeps the typed value across modes", () => {
    render(<Harness initial="" label="Descripción del puesto" />);
    const control = textbox("Descripción del puesto");

    // The editing surface is the only one mounted by default.
    expect(control).toBeVisible();
    expect(
      screen.queryByRole("region", {
        name: "Vista previa de Descripción del puesto",
      }),
    ).toBeNull();

    fireEvent.change(control, { target: { value: "Diseñá los servicios core." } });

    showMode("Vista previa");
    expect(
      screen.queryByRole("textbox", { name: "Descripción del puesto" }),
    ).toBeNull();
    expect(
      screen.queryByRole("toolbar", {
        name: "Formato de Descripción del puesto",
      }),
    ).toBeNull();
    const preview = screen.getByRole("region", {
      name: "Vista previa de Descripción del puesto",
    });
    expect(preview).toHaveTextContent("Diseñá los servicios core.");

    // Returning to the editing surface keeps the typed value untouched.
    showMode("Escribir");
    expect(textbox("Descripción del puesto")).toHaveValue(
      "Diseñá los servicios core.",
    );
  });

  it("labels the preview region and explains an empty value", () => {
    render(<RichTextField id="r" label="Requisitos obligatorios" value="" onChange={vi.fn()} />);

    showMode("Vista previa");

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

    showMode("Vista previa");

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

    showMode("Vista previa");

    const preview = screen.getByRole("region", {
      name: "Vista previa de Requisitos",
    });

    expect(within(preview).queryByRole("link")).toBeNull();
    expect(within(preview).getByText("Peligro")).toBeVisible();
  });

  it("keeps the field label associated with whichever surface is mounted", () => {
    render(
      <Harness initial="Diseñá los servicios core." label="Descripción del puesto" />,
    );
    const id = "campo-en-prueba";

    // Editing: the label is a real <label> wired to the mounted textarea.
    const editLabel = screen.getByText("Descripción del puesto");
    expect(editLabel.tagName).toBe("LABEL");
    expect(editLabel).toHaveAttribute("for", id);
    expect(textbox("Descripción del puesto")).toBeInTheDocument();

    showMode("Vista previa");

    // Preview: the textarea is unmounted, so no label may still target it.
    expect(document.getElementById(id)).toBeNull();
    expect(document.querySelector(`label[for="${id}"]`)).toBeNull();
    expect(screen.getByText("Descripción del puesto").tagName).not.toBe("LABEL");
    // The preview stays named for assistive technology.
    expect(
      screen.getByRole("region", {
        name: "Vista previa de Descripción del puesto",
      }),
    ).toBeVisible();

    // Switching back restores the association with the remounted control.
    showMode("Escribir");
    const backLabel = screen.getByText("Descripción del puesto");
    expect(backLabel.tagName).toBe("LABEL");
    expect(backLabel).toHaveAttribute("for", id);
    expect(textbox("Descripción del puesto")).toBeInTheDocument();
  });

  it("keeps the label associated with the forced editing surface while invalid", () => {
    render(
      <RichTextField
        id="campo"
        label="Requisitos obligatorios"
        value=""
        onChange={vi.fn()}
        error="Falta la descripción."
      />,
    );

    showMode("Vista previa");

    // Validation forces the editing surface, so the label keeps its control.
    const label = screen.getByText("Requisitos obligatorios");
    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveAttribute("for", "campo");
    expect(textbox("Requisitos obligatorios")).toHaveAttribute(
      "aria-describedby",
      "campo-error",
    );
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

  it("opens the link editor with a clear label, validation hint, and focusable field", () => {
    render(<Harness initial="Mirá la guía" />);

    openLinkEditor();

    const dialog = screen.getByRole("dialog", { name: "Agregar enlace" });
    expect(dialog).toHaveAccessibleDescription(/http:\/\/ o https:\/\//i);

    const linkInput = screen.getByLabelText("Dirección del enlace");
    expect(linkInput).toHaveAttribute("placeholder", "https://ejemplo.com");
    expect(
      screen.getByRole("button", { name: "Agregar enlace" }),
    ).toBeInTheDocument();

    dismissLinkEditor();
  });

  it("adds a link around the captured selection and restores focus and selection", () => {
    render(<Harness initial="Mirá la guía" />);
    const control = textbox("Requisitos obligatorios");

    control.setSelectionRange(5, 12);
    openLinkEditor();

    fireEvent.change(screen.getByLabelText("Dirección del enlace"), {
      target: { value: "https://empresa.example/guia" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agregar enlace" }));

    expect(control).toHaveValue("Mirá [la guía](https://empresa.example/guia)");
    expect(control.selectionStart).toBe(6);
    expect(control.selectionEnd).toBe(13);
    // The editor closes and the caret returns to the edited value.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(control).toHaveFocus();
  });
  it("rejects an unsafe link without touching the value and keeps the editor open", () => {
    render(<Harness initial="Mirá la guía" />);
    const control = textbox("Requisitos obligatorios");

    control.setSelectionRange(5, 12);
    openLinkEditor();

    fireEvent.change(screen.getByLabelText("Dirección del enlace"), {
      target: { value: "javascript:alert(1)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agregar enlace" }));

    expect(screen.getByRole("alert")).toHaveTextContent(UNSAFE_LINK_MESSAGE);
    expect(control).toHaveValue("Mirá la guía");
    expect(screen.getByLabelText("Dirección del enlace")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    // The invalid destination stays editable instead of discarding the attempt.
    expect(
      screen.getByRole("dialog", { name: "Agregar enlace" }),
    ).toBeInTheDocument();

    dismissLinkEditor();
  });

  it("rejects a structurally malformed absolute address without touching the value", () => {
    render(<Harness initial="Mirá la guía" />);
    const control = textbox("Requisitos obligatorios");

    control.setSelectionRange(5, 12);
    openLinkEditor();

    fireEvent.change(screen.getByLabelText("Dirección del enlace"), {
      target: { value: "https://)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agregar enlace" }));

    expect(screen.getByRole("alert")).toHaveTextContent(UNSAFE_LINK_MESSAGE);
    // No token with surplus punctuation may enter the value.
    expect(control).toHaveValue("Mirá la guía");

    dismissLinkEditor();
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
    expect(source).toMatch(/from "@\/components\/ui\/popover"/);
    expect(source).toMatch(/from "@\/components\/ui\/tabs"/);
    expect(source).toMatch(/from "\.\/rich-text-model"/);
    expect(source).not.toMatch(/createJob|requestJson|schemas|zod|lib\/api/);
    expect(source).not.toMatch(/\bfetch\s*\(/u);
    // The disclosure surface left the component with the copy cleanup.
    expect(source).not.toMatch(/FieldDescription|todavía no se guarda/);
  });
});
