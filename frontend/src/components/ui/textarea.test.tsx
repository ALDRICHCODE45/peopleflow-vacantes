import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { Textarea } from "./textarea";

afterEach(() => cleanup());

describe("Textarea primitive", () => {
  it("renders a native textarea with the local data-slot convention", () => {
    render(<Textarea aria-label="Descripción del puesto" />);

    const textarea = screen.getByRole("textbox", {
      name: "Descripción del puesto",
    });

    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).toHaveAttribute("data-slot", "textarea");
  });

  it("forwards the ref to the native textarea element", () => {
    const ref = createRef<HTMLTextAreaElement>();

    render(<Textarea ref={ref} aria-label="Descripción del puesto" />);

    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
    expect(ref.current?.tagName).toBe("TEXTAREA");
  });

  it("forwards native attributes and change events to the element", () => {
    const onChange = vi.fn();

    render(
      <Textarea
        aria-label="Descripción del puesto"
        name="description"
        rows={6}
        placeholder="Describí el rol y el equipo"
        aria-invalid="true"
        onChange={onChange}
      />,
    );

    const textarea = screen.getByRole("textbox", {
      name: "Descripción del puesto",
    });

    expect(textarea).toHaveAttribute("name", "description");
    expect(textarea).toHaveAttribute("rows", "6");
    expect(textarea).toHaveAttribute(
      "placeholder",
      "Describí el rol y el equipo",
    );
    expect(textarea).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(textarea, { target: { value: "Diseñá los servicios core." } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(textarea).toHaveValue("Diseñá los servicios core.");
  });

  it("composes the caller className with the shared local control recipe", () => {
    render(
      <Textarea
        aria-label="Descripción del puesto"
        className="min-h-32 resize-none leading-relaxed"
      />,
    );

    const textarea = screen.getByRole("textbox", {
      name: "Descripción del puesto",
    });

    // Caller layout intent survives.
    expect(textarea.className).toContain("min-h-32");
    expect(textarea.className).toContain("resize-none");
    expect(textarea.className).toContain("leading-relaxed");
    // The shared Input recipe survives, so the primitive stays theme-compatible.
    expect(textarea.className).toContain("bg-input/50");
    expect(textarea.className).toContain("aria-invalid:border-destructive");
    expect(textarea.className).toContain("placeholder:text-muted-foreground");
  });

  it("keeps the disabled state handled by the shared recipe", () => {
    render(<Textarea aria-label="Descripción del puesto" disabled />);

    expect(
      screen.getByRole("textbox", { name: "Descripción del puesto" }),
    ).toBeDisabled();
  });
});
