import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import * as ComboboxModule from "./combobox";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxClear,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from "./combobox";

const SKILLS = ["React", "TypeScript", "Node.js"];
const DEPARTMENTS = ["Ingeniería", "Producto", "Diseño"];

const source = readFileSync(
  join(process.cwd(), "src", "components", "ui", "combobox.tsx"),
  "utf8",
);

const importSources = [...source.matchAll(/from\s+"([^"]+)"/gu)].map(
  (match) => match[1],
);

// jsdom implements neither matchMedia nor ResizeObserver; the combobox reads
// both while it lays out its input group and list.
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
  vi.stubGlobal("innerWidth", 1280);
}

beforeEach(() => {
  stubBrowserApis();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * Documented `multiple` + chips composition (`Combobox` + `ComboboxChips` +
 * `ComboboxValue` + `ComboboxChip` + `ComboboxChipsInput`).
 *
 * The list renders inline instead of inside the portal popup: Base UI supports
 * both, and under jsdom the anchored portal popup repositions in an update loop
 * that costs seconds per test and leaks into later tests. The documented portal
 * composition is covered by its own test at the end of this file.
 */
function renderChipCombobox(selected: string[]) {
  const onValueChange = vi.fn();

  render(
    <Combobox multiple value={selected} onValueChange={onValueChange}>
      <ComboboxChips>
        <ComboboxValue>
          {(value: string[]) => (
            <>
              {value.map((skill) => (
                <ComboboxChip key={skill} aria-label={skill}>
                  {skill}
                </ComboboxChip>
              ))}
              <ComboboxChipsInput aria-label="Tecnologías" />
            </>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxEmpty>Sin resultados</ComboboxEmpty>
      <ComboboxList>
        {SKILLS.map((skill) => (
          <ComboboxItem key={skill} value={skill}>
            {skill}
          </ComboboxItem>
        ))}
      </ComboboxList>
    </Combobox>,
  );

  return { onValueChange };
}

function chipsContainer(): HTMLElement {
  const container = document.querySelector('[data-slot="combobox-chips"]');
  if (container === null) {
    throw new Error("The combobox chips container was not rendered");
  }
  return container as HTMLElement;
}

function chips(): HTMLElement[] {
  return Array.from(
    chipsContainer().querySelectorAll('[data-slot="combobox-chip"]'),
  ) as HTMLElement[];
}

describe("Combobox primitive surface", () => {
  it("exports the documented Base UI combobox parts", () => {
    expect(Object.keys(ComboboxModule).sort()).toEqual(
      [
        "Combobox",
        "ComboboxChip",
        "ComboboxChips",
        "ComboboxChipsInput",
        "ComboboxClear",
        "ComboboxCollection",
        "ComboboxContent",
        "ComboboxEmpty",
        "ComboboxGroup",
        "ComboboxInput",
        "ComboboxItem",
        "ComboboxLabel",
        "ComboboxList",
        "ComboboxSeparator",
        "ComboboxTrigger",
        "ComboboxValue",
        "useComboboxAnchor",
      ].sort(),
    );
  });

  it("renders an accessible multiselect combobox with the documented chips", () => {
    renderChipCombobox(["React", "TypeScript"]);

    const input = screen.getByRole("combobox", { name: "Tecnologías" });
    expect(input.tagName).toBe("INPUT");

    const listbox = screen.getByRole("listbox");
    expect(listbox).toHaveAttribute("aria-multiselectable", "true");
    expect(within(listbox).getAllByRole("option").map((o) => o.textContent)).toEqual(
      SKILLS,
    );

    const rendered = chips();
    expect(rendered).toHaveLength(2);
    expect(rendered.map((chip) => chip.textContent)).toEqual([
      "React",
      "TypeScript",
    ]);
    for (const [index, chip] of rendered.entries()) {
      // Each chip carries the local data-slot convention and a remove control
      // that names itself from the chip text.
      expect(chip).toHaveAttribute("data-slot", "combobox-chip");
      const remove = within(chip).getByRole("button", {
        name: `Quitar ${["React", "TypeScript"][index]}`,
      });
      expect(remove).toHaveAttribute("data-slot", "combobox-chip-remove");
      expect(remove).toHaveAttribute("type", "button");
    }
  });

  it("names every remove control, deriving the Spanish label from string children", () => {
    render(
      <Combobox
        multiple
        value={["React", "TypeScript", "Node.js"]}
        onValueChange={vi.fn()}
      >
        <ComboboxChips>
          <ComboboxValue>
            {() => (
              <>
                <ComboboxChip>React</ComboboxChip>
                <ComboboxChip removeLabel="Quitar TypeScript del stack">
                  TypeScript
                </ComboboxChip>
                <ComboboxChip>
                  <span>Node.js</span>
                </ComboboxChip>
                <ComboboxChipsInput aria-label="Tecnologías" />
              </>
            )}
          </ComboboxValue>
        </ComboboxChips>
      </Combobox>,
    );

    const rendered = chips();
    expect(rendered).toHaveLength(3);

    // Derived from the string child, exactly.
    expect(
      within(rendered[0]).getByRole("button", { name: "Quitar React" }),
    ).toBeVisible();
    // An explicit label always wins.
    expect(
      within(rendered[1]).getByRole("button", {
        name: "Quitar TypeScript del stack",
      }),
    ).toBeVisible();
    // Non-string children fall back to the generic Spanish label.
    expect(
      within(rendered[2]).getByRole("button", { name: "Quitar opción" }),
    ).toBeVisible();
  });

  it("reports a value change when a chip is removed", () => {
    const { onValueChange } = renderChipCombobox(["React", "TypeScript"]);

    fireEvent.click(
      within(chips()[0]).getByRole("button", { name: "Quitar React" }),
    );

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0][0]).toEqual(["TypeScript"]);
  });

  it("reports a value change when an item is selected in multiple mode", () => {
    const { onValueChange } = renderChipCombobox(["React"]);

    fireEvent.click(screen.getByRole("option", { name: "Node.js" }));

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0][0]).toEqual(["React", "Node.js"]);
  });

  it("supports the simple composition with an empty state", () => {
    render(
      <Combobox>
        <ComboboxInput aria-label="Departamento" placeholder="Elegí un área" />
        <ComboboxEmpty>Sin resultados</ComboboxEmpty>
        <ComboboxList />
      </Combobox>,
    );

    // The embedded input group keeps the combobox role on the real input.
    expect(screen.getByRole("combobox", { name: "Departamento" })).toHaveAttribute(
      "placeholder",
      "Elegí un área",
    );
    // Base UI appends a word joiner, so the assertion matches readable text.
    expect(screen.getByText(/Sin resultados/u)).toBeInTheDocument();
    expect(screen.getByText(/Sin resultados/u)).toHaveAttribute(
      "data-slot",
      "combobox-empty",
    );
  });

  it("selects an item from the simple composition", () => {
    const onValueChange = vi.fn();

    render(
      <Combobox onValueChange={onValueChange}>
        <ComboboxInput aria-label="Departamento" placeholder="Elegí un área" />
        <ComboboxEmpty>Sin resultados</ComboboxEmpty>
        <ComboboxList>
          {DEPARTMENTS.map((department) => (
            <ComboboxItem key={department} value={department}>
              {department}
            </ComboboxItem>
          ))}
        </ComboboxList>
      </Combobox>,
    );

    fireEvent.click(screen.getByRole("option", { name: "Ingeniería" }));

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0][0]).toBe("Ingeniería");
  });
});

/**
 * The single-select composition shared by the accessible-name and keyboard
 * tests: an `InputGroup`-based `ComboboxInput` plus an inline list.
 */
function renderSelectCombobox(options: {
  defaultValue?: string;
  showTrigger?: boolean;
  showClear?: boolean;
  triggerLabel?: string;
  clearLabel?: string;
} = {}) {
  const onValueChange = vi.fn();

  render(
    <Combobox defaultValue={options.defaultValue} onValueChange={onValueChange}>
      <ComboboxInput
        aria-label="Departamento"
        showTrigger={options.showTrigger ?? true}
        showClear={options.showClear ?? false}
        triggerLabel={options.triggerLabel}
        clearLabel={options.clearLabel}
      />
      <ComboboxList>
        {DEPARTMENTS.map((department) => (
          <ComboboxItem key={department} value={department}>
            {department}
          </ComboboxItem>
        ))}
      </ComboboxList>
    </Combobox>,
  );

  return { onValueChange };
}

describe("Combobox action control names", () => {
  it("names the icon-only trigger and clear controls in Spanish by default", () => {
    renderSelectCombobox({ defaultValue: "Ingeniería", showClear: true });

    // Both controls render only icons, so neither carries a visible name.
    // Inside ComboboxInput the InputGroupButton's own data-slot wins the render
    // merge, so the trigger is identified by its accessible name alone.
    const trigger = screen.getByRole("button", { name: "Mostrar opciones" });
    expect(trigger).toHaveAttribute("type", "button");
    expect(
      screen.getByRole("button", { name: "Limpiar selección" }),
    ).toHaveAttribute("data-slot", "combobox-clear");

    // The default labels must not leak onto the combobox input itself.
    expect(screen.getByRole("combobox", { name: "Departamento" })).toBeVisible();
  });

  it("lets callers replace the trigger and clear labels through ComboboxInput", () => {
    renderSelectCombobox({
      defaultValue: "Ingeniería",
      showClear: true,
      triggerLabel: "Abrir áreas",
      clearLabel: "Quitar el área elegida",
    });

    expect(
      screen.getByRole("button", { name: "Abrir áreas" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Quitar el área elegida" }),
    ).toBeInTheDocument();

    // The Spanish defaults are replaced, not duplicated.
    expect(
      screen.queryByRole("button", { name: "Mostrar opciones" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Limpiar selección" }),
    ).toBeNull();
  });

  it("keeps a native aria-label authoritative on a composed trigger", () => {
    render(
      <Combobox defaultValue="Ingeniería">
        <ComboboxInput aria-label="Departamento" showTrigger={false} />
        <ComboboxTrigger aria-label="Abrir el listado de áreas" />
        <ComboboxList>
          {DEPARTMENTS.map((department) => (
            <ComboboxItem key={department} value={department}>
              {department}
            </ComboboxItem>
          ))}
        </ComboboxList>
      </Combobox>,
    );

    expect(
      screen.getByRole("button", { name: "Abrir el listado de áreas" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mostrar opciones" }),
    ).toBeNull();
  });

  it("leaves a trigger that renders its own text to name itself", () => {
    render(
      <Combobox defaultValue="Ingeniería">
        <ComboboxInput aria-label="Departamento" showTrigger={false} />
        <ComboboxTrigger>Ver todas las áreas</ComboboxTrigger>
        <ComboboxList>
          {DEPARTMENTS.map((department) => (
            <ComboboxItem key={department} value={department}>
              {department}
            </ComboboxItem>
          ))}
        </ComboboxList>
      </Combobox>,
    );

    const trigger = screen.getByRole("button", {
      name: "Ver todas las áreas",
    });
    // A default aria-label would contradict the visible text (WCAG 2.5.3).
    expect(trigger).not.toHaveAttribute("aria-label");
  });
});

describe("Combobox clear slot", () => {
  it("composes standalone, self-names, and clears the selection", () => {
    const onValueChange = vi.fn();

    render(
      <Combobox defaultValue="Ingeniería" onValueChange={onValueChange}>
        <ComboboxInput aria-label="Departamento" showClear={false} />
        {/* Composed outside the input-group addon, which the export enables. */}
        <ComboboxClear />
        <ComboboxClear aria-label="Quitar el área elegida" />
        <ComboboxList>
          {DEPARTMENTS.map((department) => (
            <ComboboxItem key={department} value={department}>
              {department}
            </ComboboxItem>
          ))}
        </ComboboxList>
      </Combobox>,
    );

    const byDefault = screen.getByRole("button", { name: "Limpiar selección" });
    expect(byDefault).toHaveAttribute("data-slot", "combobox-clear");
    expect(byDefault).toHaveAttribute("type", "button");
    expect(
      screen.getByRole("button", { name: "Quitar el área elegida" }),
    ).toBeInTheDocument();

    fireEvent.click(byDefault);

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0][0]).toBeNull();
  });
});

describe("Combobox render-prop accessible names", () => {
  it("lets a caller-rendered trigger keep its visible text as its name", () => {
    render(
      <Combobox defaultValue="Ingeniería">
        <ComboboxInput aria-label="Departamento" showTrigger={false} />
        <ComboboxTrigger render={<button>Ver áreas</button>} />
        <ComboboxList>
          {DEPARTMENTS.map((department) => (
            <ComboboxItem key={department} value={department}>
              {department}
            </ComboboxItem>
          ))}
        </ComboboxList>
      </Combobox>,
    );

    // The caller's render element owns its markup and its visible text, so the
    // wrapper must not attach a default name that contradicts it (WCAG 2.5.3).
    const trigger = screen.getByRole("button", { name: "Ver áreas" });
    expect(trigger).not.toHaveAttribute("aria-label");
    expect(
      screen.queryByRole("button", { name: "Mostrar opciones" }),
    ).toBeNull();
  });

  it("lets a caller-rendered clear control keep its visible text as its name", () => {
    render(
      <Combobox defaultValue="Ingeniería">
        <ComboboxInput aria-label="Departamento" showClear={false} />
        <ComboboxClear render={<button>Quitar el área</button>} />
        <ComboboxList>
          {DEPARTMENTS.map((department) => (
            <ComboboxItem key={department} value={department}>
              {department}
            </ComboboxItem>
          ))}
        </ComboboxList>
      </Combobox>,
    );

    const clear = screen.getByRole("button", { name: "Quitar el área" });
    expect(clear).not.toHaveAttribute("aria-label");
    expect(
      screen.queryByRole("button", { name: "Limpiar selección" }),
    ).toBeNull();
  });

  it("lets a render-function trigger name itself without introspection", () => {
    render(
      <Combobox defaultValue="Ingeniería">
        <ComboboxInput aria-label="Departamento" showTrigger={false} />
        <ComboboxTrigger
          render={(triggerProps) => (
            <button {...triggerProps}>Ver todas las áreas</button>
          )}
        />
        <ComboboxList>
          {DEPARTMENTS.map((department) => (
            <ComboboxItem key={department} value={department}>
              {department}
            </ComboboxItem>
          ))}
        </ComboboxList>
      </Combobox>,
    );

    const trigger = screen.getByRole("button", {
      name: "Ver todas las áreas",
    });
    expect(trigger).not.toHaveAttribute("aria-label");
  });

  it("keeps an explicit aria-label authoritative over rendered text", () => {
    render(
      <Combobox defaultValue="Ingeniería">
        <ComboboxInput aria-label="Departamento" showTrigger={false} />
        <ComboboxTrigger
          render={<button>Ver áreas</button>}
          aria-label="Abrir áreas"
        />
        <ComboboxList>
          {DEPARTMENTS.map((department) => (
            <ComboboxItem key={department} value={department}>
              {department}
            </ComboboxItem>
          ))}
        </ComboboxList>
      </Combobox>,
    );

    const trigger = screen.getByRole("button", { name: "Abrir áreas" });
    expect(trigger).toHaveAttribute("aria-label", "Abrir áreas");
    expect(
      screen.queryByRole("button", { name: "Mostrar opciones" }),
    ).toBeNull();
  });

  it("keeps aria-labelledby authoritative for a caller-rendered control", () => {
    render(
      <>
        <span id="areas-disponibles">Áreas disponibles</span>
        <Combobox defaultValue="Ingeniería">
          <ComboboxInput aria-label="Departamento" showTrigger={false} />
          <ComboboxTrigger
            render={<button />}
            aria-labelledby="areas-disponibles"
          />
          <ComboboxList>
            {DEPARTMENTS.map((department) => (
              <ComboboxItem key={department} value={department}>
                {department}
              </ComboboxItem>
            ))}
          </ComboboxList>
        </Combobox>
      </>,
    );

    const trigger = screen.getByRole("button", {
      name: "Áreas disponibles",
    });
    expect(trigger).not.toHaveAttribute("aria-label");
    expect(trigger).toHaveAttribute("aria-labelledby", "areas-disponibles");
  });
});

describe("Combobox clear children ownership", () => {
  /**
   * The single-select scaffold for the clear-ownership tests: the default value
   * makes the clear control visible, and the list stays inline for jsdom speed.
   */
  function renderClearOwnership(clear: ReactNode) {
    render(
      <Combobox defaultValue="Ingeniería">
        <ComboboxInput aria-label="Departamento" showClear={false} />
        {clear}
        <ComboboxList>
          {DEPARTMENTS.map((department) => (
            <ComboboxItem key={department} value={department}>
              {department}
            </ComboboxItem>
          ))}
        </ComboboxList>
      </Combobox>,
    );
  }

  it("renders direct children instead of the wrapper icon and names from their text", () => {
    renderClearOwnership(<ComboboxClear>Quitar el área</ComboboxClear>);

    const clear = screen.getByRole("button", { name: "Quitar el área" });
    expect(clear).toHaveTextContent("Quitar el área");
    // Caller children own the content, so no wrapper icon and no default name.
    expect(clear.querySelector("svg")).toBeNull();
    expect(clear).not.toHaveAttribute("aria-label");
    expect(
      screen.queryByRole("button", { name: "Limpiar selección" }),
    ).toBeNull();
  });

  it("keeps an explicit aria-label authoritative over direct children text", () => {
    renderClearOwnership(
      <ComboboxClear aria-label="Quitar el área elegida">
        Quitar el área
      </ComboboxClear>,
    );

    const clear = screen.getByRole("button", {
      name: "Quitar el área elegida",
    });
    expect(clear).toHaveAttribute("aria-label", "Quitar el área elegida");
    expect(clear).toHaveTextContent("Quitar el área");
  });

  it("keeps aria-labelledby authoritative over direct children text", () => {
    render(
      <>
        <span id="quitar-area">Quitar el área</span>
        <Combobox defaultValue="Ingeniería">
          <ComboboxInput aria-label="Departamento" showClear={false} />
          <ComboboxClear aria-labelledby="quitar-area">Quitar</ComboboxClear>
          <ComboboxList>
            {DEPARTMENTS.map((department) => (
              <ComboboxItem key={department} value={department}>
                {department}
              </ComboboxItem>
            ))}
          </ComboboxList>
        </Combobox>
      </>,
    );

    const clear = screen.getByRole("button", { name: "Quitar el área" });
    expect(clear).toHaveTextContent("Quitar");
    expect(clear).not.toHaveAttribute("aria-label");
  });

  it("keeps the wrapper icon and Spanish default for wrapper-owned content", () => {
    renderClearOwnership(<ComboboxClear />);

    const clear = screen.getByRole("button", { name: "Limpiar selección" });
    expect(clear).toHaveAttribute("data-slot", "combobox-clear");
    expect(clear.querySelector("svg")).not.toBeNull();
  });
});

describe("Combobox keyboard interaction", () => {
  it("opens the list from the trigger with ArrowDown and selects with Enter", async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderSelectCombobox();

    // ComboboxInput renders the trigger inside the input-group addon; the
    // addon holds a single button while `showClear` is off.
    const addon = document.querySelector(
      '[data-slot="input-group-addon"]',
    ) as HTMLElement;
    const trigger = within(addon).getByRole("button");
    const input = screen.getByRole("combobox", { name: "Departamento" });

    trigger.focus();
    await user.keyboard("{ArrowDown}");

    // Base UI opens the list and returns the virtual focus to the input.
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0][0]).toBe("Ingeniería");
  });

  it("clears the selection with Escape while the list stays closed", async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderSelectCombobox({
      defaultValue: "Ingeniería",
      showClear: true,
    });

    const input = screen.getByRole("combobox", { name: "Departamento" });
    expect(input).toHaveAttribute("aria-expanded", "false");

    input.focus();
    await user.keyboard("{Escape}");

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0][0]).toBeNull();
  });

  it("removes the last chip with Backspace from an empty chips input", async () => {
    const user = userEvent.setup();
    const { onValueChange } = renderChipCombobox(["React", "TypeScript"]);

    const input = screen.getByRole("combobox", { name: "Tecnologías" });
    input.focus();
    await user.keyboard("{Backspace}");

    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange.mock.calls[0][0]).toEqual(["React"]);
  });
});

describe("Combobox source boundary", () => {
  it("builds on the official Base UI combobox primitive", () => {
    expect(
      importSources.some((specifier) =>
        /^@base-ui\/react(\/combobox)?$/u.test(specifier),
      ),
    ).toBe(true);
    expect(source).toMatch(/ComboboxPrimitive\.Root/);
  });

  it("keeps the documented portal, positioner, and popup slots in source", () => {
    expect(source).toMatch(/ComboboxPrimitive\.Portal/);
    expect(source).toMatch(/ComboboxPrimitive\.Positioner/);
    expect(source).toMatch(/ComboboxPrimitive\.Popup/);
    expect(source).toMatch(/data-slot="combobox-content"/);
  });

  it("imports only existing project modules and dependencies", () => {
    const allowed = new Set([
      "react",
      "cn",
      "@base-ui/react",
      "@base-ui/react/combobox",
      "@/components/ui/button",
      "@/components/ui/input-group",
      "lucide-react",
    ]);
    expect(importSources.length).toBeGreaterThan(0);
    for (const specifier of importSources) {
      expect(allowed.has(specifier)).toBe(true);
    }
    expect(source).not.toMatch(/@\/registry|icon-placeholder/);
  });

  it("reuses the existing project button and input-group primitives", () => {
    expect(source).toMatch(/from "@\/components\/ui\/button"/);
    expect(source).toMatch(/from "@\/components\/ui\/input-group"/);
    for (const primitive of ["button", "input-group"]) {
      expect(() =>
        readFileSync(
          join(process.cwd(), "src", "components", "ui", `${primitive}.tsx`),
          "utf8",
        ),
      ).not.toThrow();
    }
  });
});

/**
 * The documented anchored popup composition.
 *
 * This test stays last on purpose: under jsdom the anchored popup repositions in
 * an update loop that costs seconds and leaks into whichever test runs next, so
 * every cheaper assertion runs before it.
 */
describe("Combobox documented popup composition", () => {
  it("mounts the portal popup with an accessible combobox and its empty state", () => {
    render(
      <Combobox defaultOpen>
        <ComboboxInput aria-label="Departamento" placeholder="Elegí un área" />
        <ComboboxContent>
          <ComboboxEmpty>Sin resultados</ComboboxEmpty>
          <ComboboxList />
        </ComboboxContent>
      </Combobox>,
    );

    expect(screen.getByRole("combobox", { name: "Departamento" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText(/Sin resultados/u)).toBeInTheDocument();
    expect(
      document.querySelector('[data-slot="combobox-content"]'),
    ).toHaveAttribute("data-empty");
  });
});
