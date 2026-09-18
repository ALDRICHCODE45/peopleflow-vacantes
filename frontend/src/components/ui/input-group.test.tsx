import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FormEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import * as InputGroupModule from "./input-group";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "./input-group";

const source = readFileSync(
  join(process.cwd(), "src", "components", "ui", "input-group.tsx"),
  "utf8",
);

const importSources = [...source.matchAll(/from\s+"([^"]+)"/gu)].map(
  (match) => match[1],
);

afterEach(() => cleanup());

const input = () => screen.getByPlaceholderText("25,000") as HTMLInputElement;

describe("InputGroup primitive surface", () => {
  it("exports every documented slot", () => {
    expect(Object.keys(InputGroupModule).sort()).toEqual(
      [
        "InputGroup",
        "InputGroupAddon",
        "InputGroupButton",
        "InputGroupInput",
        "InputGroupText",
        "InputGroupTextarea",
      ].sort(),
    );
  });

  it("renders the group, addon, and control slots with the local conventions", () => {
    render(
      <InputGroup aria-label="Salario mínimo">
        <InputGroupAddon align="inline-start">
          <InputGroupText>MXN</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput placeholder="25,000" inputMode="numeric" />
      </InputGroup>,
    );

    const group = screen.getByRole("group", { name: "Salario mínimo" });
    expect(group).toHaveAttribute("data-slot", "input-group");

    const addon = within(group).getByText("MXN").closest(
      '[data-slot="input-group-addon"]',
    );
    expect(addon).not.toBeNull();
    expect(addon).toHaveAttribute("data-align", "inline-start");

    // The control overrides the inner primitive slot so the group can style it.
    expect(input()).toHaveAttribute("data-slot", "input-group-control");
    expect(input()).toHaveAttribute("inputmode", "numeric");
  });

  it("focuses the embedded control when the addon is clicked", () => {
    render(
      <InputGroup>
        <InputGroupAddon align="inline-start" data-testid="addon">
          <InputGroupText>$</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput placeholder="25,000" />
      </InputGroup>,
    );

    expect(input()).not.toHaveFocus();

    fireEvent.click(screen.getByTestId("addon"));

    expect(input()).toHaveFocus();
  });

  it("keeps embedded buttons as type=button by default", () => {
    render(
      <InputGroup>
        <InputGroupInput placeholder="25,000" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton>Buscar</InputGroupButton>
          <InputGroupButton type="submit">Enviar</InputGroupButton>
        </InputGroupAddon>
      </InputGroup>,
    );

    const search = screen.getByRole("button", { name: "Buscar" });
    expect(search).toHaveAttribute("type", "button");
    // The default must not submit an enclosing form.
    expect(search).not.toHaveAttribute("type", "submit");

    // An explicit type is still honored.
    expect(screen.getByRole("button", { name: "Enviar" })).toHaveAttribute(
      "type",
      "submit",
    );
  });

  it("supports a block addon with a textarea control", () => {
    render(
      <InputGroup>
        <InputGroupAddon align="block-start">
          <InputGroupText>Descripción</InputGroupText>
        </InputGroupAddon>
        <InputGroupTextarea placeholder="Escribí los requisitos" />
      </InputGroup>,
    );

    const textarea = screen.getByPlaceholderText(
      "Escribí los requisitos",
    ) as HTMLTextAreaElement;
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).toHaveAttribute("data-slot", "input-group-control");
    const addon = document.querySelector('[data-slot="input-group-addon"]');
    expect(addon).toHaveAttribute("data-align", "block-start");
  });

  it("focuses the embedded textarea when a block addon is clicked", () => {
    render(
      <InputGroup>
        <InputGroupAddon align="block-start" data-testid="addon">
          <InputGroupText>Descripción</InputGroupText>
        </InputGroupAddon>
        <InputGroupTextarea placeholder="Escribí los requisitos" />
      </InputGroup>,
    );

    const textarea = screen.getByPlaceholderText(
      "Escribí los requisitos",
    ) as HTMLTextAreaElement;
    expect(textarea).not.toHaveFocus();

    fireEvent.click(screen.getByTestId("addon"));

    expect(textarea).toHaveFocus();
  });

  it("keeps a click on an embedded button from stealing focus", () => {
    render(
      <InputGroup>
        <InputGroupInput placeholder="25,000" />
        <InputGroupAddon align="inline-end" data-testid="addon">
          <InputGroupButton>Buscar</InputGroupButton>
        </InputGroupAddon>
      </InputGroup>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));

    // The button owns its activation; the addon must not focus the control.
    expect(input()).not.toHaveFocus();
  });

  it("does not submit an enclosing form when an embedded button is activated by keyboard", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
    });

    render(
      <form onSubmit={onSubmit}>
        <InputGroup>
          <InputGroupInput placeholder="25,000" />
          <InputGroupAddon align="inline-end">
            <InputGroupButton>Buscar</InputGroupButton>
            <InputGroupButton type="submit">Enviar</InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>,
    );

    const search = screen.getByRole("button", { name: "Buscar" });
    search.focus();
    await user.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();

    // An explicit submit button keeps its native form behavior.
    const submit = screen.getByRole("button", { name: "Enviar" });
    submit.focus();
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("forwards the caller className and native events to the control", () => {
    const onChange = vi.fn();

    render(
      <InputGroup className="max-w-48">
        <InputGroupInput
          placeholder="25,000"
          className="text-right"
          onChange={onChange}
        />
      </InputGroup>,
    );

    expect(screen.getByRole("group").className).toContain("max-w-48");
    expect(input().className).toContain("text-right");

    fireEvent.change(input(), { target: { value: "25000" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("InputGroup source boundary", () => {
  it("composes only existing project primitives and dependencies", () => {
    const allowed = new Set([
      "react",
      "cn",
      "class-variance-authority",
      "@/components/ui/button",
      "@/components/ui/input",
      "@/components/ui/textarea",
    ]);
    expect(importSources.length).toBeGreaterThan(0);
    for (const specifier of importSources) {
      expect(allowed.has(specifier)).toBe(true);
    }

    // The embedded controls must be the project's own Base UI-backed primitives.
    expect(source).toMatch(/from "@\/components\/ui\/button"/);
    expect(source).toMatch(/from "@\/components\/ui\/input"/);
    expect(source).toMatch(/from "@\/components\/ui\/textarea"/);
    expect(source).not.toMatch(/@\/registry|icon-placeholder/);

    for (const primitive of ["button", "input", "textarea"]) {
      expect(() =>
        readFileSync(
          join(process.cwd(), "src", "components", "ui", `${primitive}.tsx`),
          "utf8",
        ),
      ).not.toThrow();
    }
  });

  it("defaults the embedded button to a non-submitting type in source", () => {
    expect(source).toMatch(/type = "button"/);
  });
});
