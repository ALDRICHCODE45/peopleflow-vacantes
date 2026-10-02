import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

import { talentPersonSchema, type TalentPerson } from "./model";
import { TalentWorkspace } from "./talent-workspace";

// jsdom implements neither matchMedia nor ResizeObserver; the combobox, the
// menu and the Base UI dialog all read them.
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

/**
 * DatePickerField boundary. The real Base UI popover close path refocus-loops
 * under jsdom no matter how the popup is closed, exactly like the committed
 * DatePickerField suite documents. The field is therefore exercised through a
 * small controlled harness that keeps its props and emitted civil dates
 * observable; real browser behaviour is asserted in Playwright, never here.
 * The open state lives in a context so several date fields on one screen stay
 * independent instead of sharing one module-level flag.
 */
vi.mock("@/components/ui/popover", () => {
  const PopoverTestContext = React.createContext<{
    open: boolean;
    setOpen?: (next: boolean) => void;
  }>({ open: false });

  return {
    Popover: ({
      open,
      onOpenChange,
      children,
    }: {
      open?: boolean;
      onOpenChange?: (next: boolean) => void;
      children?: React.ReactNode;
    }) => (
      <PopoverTestContext.Provider
        value={{ open: Boolean(open), setOpen: onOpenChange }}
      >
        <div data-slot="talento-test-popover">{children}</div>
      </PopoverTestContext.Provider>
    ),
    PopoverTrigger: ({
      render,
    }: {
      render: React.ReactElement<{ onClick?: () => void }>;
    }) => {
      const { setOpen } = React.useContext(PopoverTestContext);
      return React.cloneElement(render, { onClick: () => setOpen?.(true) });
    },
    PopoverContent: ({ children }: { children?: React.ReactNode }) => {
      const { open } = React.useContext(PopoverTestContext);
      return open ? <div role="dialog">{children}</div> : null;
    },
  };
});

const calendar = vi.hoisted(() => ({ props: undefined as unknown }));
vi.mock("@/components/ui/calendar", () => ({
  Calendar: (props: {
    disabled?: { before?: Date; after?: Date };
    onSelect?: (date: Date | undefined) => void;
  }) => {
    calendar.props = props;
    return (
      <div data-slot="talento-test-calendar">
        {[1, 3, 5, 10].map((day) => (
          <button
            key={day}
            type="button"
            aria-label={`Día ${day}`}
            onClick={() => props.onSelect?.(new Date(2026, 2, day))}
          />
        ))}
      </div>
    );
  },
}));

/**
 * Combobox jsdom boundary. Base UI's anchored portal popup repositions in an
 * update loop under jsdom that costs seconds and leaks into later tests (the
 * committed combobox suite documents the same boundary). Only the portal
 * wrapper is replaced: the list renders inline, which Base UI also supports, so
 * the real options, filtering, chips and selection stay exercised while the
 * expensive positioning is skipped. The portal composition itself is covered by
 * `combobox.test.tsx` and must be proven in a real browser, never here.
 */
vi.mock("@/components/ui/combobox", async () => {
  const actual =
    await vi.importActual<typeof import("@/components/ui/combobox")>(
      "@/components/ui/combobox",
    );
  return {
    ...actual,
    ComboboxContent: ({ children }: { children?: React.ReactNode }) => (
      <>{children}</>
    ),
  };
});

/**
 * DropdownMenu jsdom boundary. Base UI's floating positioner runs an
 * `autoUpdate` loop that never settles under jsdom (the same class of boundary
 * the committed combobox and DatePickerField suites document), turning a single
 * menu open into tens of seconds. The real menu primitive is replaced by a
 * small implementation that keeps every observable contract the product relies
 * on: `aria-haspopup`/`aria-expanded`, `role="menu"`, `role="menuitem"`,
 * `role="menuitemcheckbox"` with `aria-checked`, `aria-disabled`, close on item
 * activation, stay-open on checkbox toggles, and Escape to close. Real menu
 * geometry and positioning are proven in Playwright, never here.
 */
vi.mock("@/components/ui/dropdown-menu", () => {
  const MenuContext = React.createContext<{
    open: boolean;
    setOpen: (next: boolean) => void;
  } | null>(null);

  function useMenuContext() {
    const context = React.useContext(MenuContext);
    if (context === null) throw new Error("DropdownMenu context is missing");
    return context;
  }

  return {
    DropdownMenu: ({ children }: { children?: React.ReactNode }) => {
      const [open, setOpen] = React.useState(false);
      return (
        <MenuContext.Provider value={{ open, setOpen }}>
          <div>{children}</div>
        </MenuContext.Provider>
      );
    },
    DropdownMenuTrigger: ({
      render,
      children,
    }: {
      render?: React.ReactElement<Record<string, unknown>>;
      children?: React.ReactNode;
    }) => {
      const { open, setOpen } = useMenuContext();
      const props = {
        onClick: () => setOpen(!open),
        "aria-haspopup": "menu" as const,
        "aria-expanded": open,
      };
      return render
        ? React.cloneElement(render, props, children)
        : (
            <button type="button" {...props}>
              {children}
            </button>
          );
    },
    DropdownMenuContent: ({
      children,
      ...props
    }: React.ComponentProps<"div"> & {
      align?: string;
      alignOffset?: number;
      side?: string;
      sideOffset?: number;
    }) => {
      const { align, alignOffset, side, sideOffset, ...domProps } = props;
      void align;
      void alignOffset;
      void side;
      void sideOffset;
      const { open } = useMenuContext();
      return open ? (
        <div role="menu" {...domProps}>
          {children}
        </div>
      ) : null;
    },
    DropdownMenuGroup: ({ children }: { children?: React.ReactNode }) => (
      <div role="group">{children}</div>
    ),
    DropdownMenuLabel: ({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    ),
    DropdownMenuItem: ({
      children,
      disabled,
      onClick,
      ...props
    }: React.ComponentProps<"div"> & { disabled?: boolean }) => (
      <div
        role="menuitem"
        tabIndex={-1}
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (!disabled) onClick?.({} as React.MouseEvent<HTMLDivElement>);
        }}
        {...props}
      >
        {children}
      </div>
    ),
    DropdownMenuCheckboxItem: ({
      children,
      checked,
      disabled,
      onCheckedChange,
      ...props
    }: React.ComponentProps<"div"> & {
      checked?: boolean;
      disabled?: boolean;
      onCheckedChange?: (checked: boolean) => void;
    }) => (
      <div
        role="menuitemcheckbox"
        tabIndex={-1}
        aria-checked={checked}
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (!disabled) onCheckedChange?.(!checked);
        }}
        {...props}
      >
        {children}
      </div>
    ),
    DropdownMenuSeparator: () => <div role="separator" />,
  };
});

const VACANCY_TITLES: Readonly<Record<string, string>> = {
  "backend-developer-senior": "Backend Developer (Senior)",
  "frontend-engineer-react": "Frontend Engineer (React)",
  "fullstack-developer": "Fullstack Developer",
  "devops-engineer": "DevOps Engineer",
  "qa-automation-engineer": "QA Automation Engineer",
  "data-analyst": "Data Analyst",
};

const BASE = {
  id: "persona-base",
  fullName: "Persona Base",
  professionalTitle: "Desarrolladora Frontend",
  email: "persona-base@ejemplo.mx",
  phone: "+52 55 1000 2000",
  location: "Guadalajara",
  industry: "Tecnología",
  currentCompany: "Estudio Base",
  yearsOfExperience: 5,
  skills: ["React"],
  education: "Licenciatura en Ingeniería en Software",
  languages: [{ name: "Español", level: "native" }],
  preferredModality: "remote",
  availability: "immediate",
  applications: [
    {
      id: "persona-base-postulacion-1",
      vacancyId: "frontend-engineer-react",
      stage: "submitted",
      source: "direct",
      appliedAt: "2026-03-01T00:00:00Z",
    },
  ],
};

function makePerson(overrides: Record<string, unknown> = {}): TalentPerson {
  return talentPersonSchema.parse({ ...BASE, ...overrides });
}

/** Two separate applications to two vacancies — the same-application case. */
const DUAL = makePerson({
  id: "persona-dual",
  fullName: "Persona Dual",
  yearsOfExperience: 7,
  skills: ["Go"],
  applications: [
    {
      id: "persona-dual-postulacion-1",
      vacancyId: "frontend-engineer-react",
      stage: "submitted",
      source: "direct",
      appliedAt: "2026-03-01T00:00:00Z",
    },
    {
      id: "persona-dual-postulacion-2",
      vacancyId: "backend-developer-senior",
      stage: "hired",
      source: "referral",
      appliedAt: "2026-03-05T00:00:00Z",
    },
  ],
});

const SIMPLE = makePerson({
  id: "persona-simple",
  fullName: "Persona Simple",
  yearsOfExperience: 2,
  skills: ["Figma"],
  industry: "Salud",
  location: "Mérida",
  applications: [
    {
      id: "persona-simple-postulacion-1",
      vacancyId: "data-analyst",
      stage: "submitted",
      source: "direct",
      appliedAt: "2026-03-02T00:00:00Z",
    },
  ],
});

function renderWorkspace(people: readonly TalentPerson[], pageSize = 10) {
  return render(
    <TalentWorkspace
      people={people}
      vacancyTitleById={VACANCY_TITLES}
      pageSize={pageSize}
    />,
  );
}

function rows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-pf-talento-row]"),
  );
}

function rowIds(): string[] {
  return rows().map((row) => row.getAttribute("data-pf-talento-row") ?? "");
}

function headerIds(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-pf-talento-th]"),
  ).map((th) => th.getAttribute("data-pf-talento-th") ?? "");
}

function searchBox(): HTMLInputElement {
  return screen.getByLabelText("Buscar talento") as HTMLInputElement;
}

const filterTrigger = () =>
  screen.getByRole("button", { name: /^Filtros/ });

function filterSheet(): HTMLElement {
  const sheet = document.querySelector<HTMLElement>("[data-pf-talento-filters]");
  expect(sheet, "filter sheet").not.toBeNull();
  return sheet as HTMLElement;
}

async function openFilters(user: ReturnType<typeof userEvent.setup>) {
  await user.click(filterTrigger());
  await waitFor(() => {
    expect(document.querySelector("[data-pf-talento-filters]")).not.toBeNull();
  });
  return filterSheet();
}

/**
 * Selects one option inside a facet's searchable multi-select. Options use the
 * real Base UI combobox list and the real vocabulary values.
 */
function selectFacetOption(facet: string, optionLabel: string) {
  expect(
    document.getElementById(`talento-filtro-${facet}`),
    `facet input ${facet}`,
  ).not.toBeNull();
  const option = screen.getByRole("option", { name: optionLabel });
  fireEvent.click(option);
}

function openHeaderMenu(id: string): HTMLElement {
  const trigger = document.querySelector<HTMLElement>(
    `[data-pf-talento-column-menu="${id}"]`,
  );
  expect(trigger, `header menu trigger for ${id}`).not.toBeNull();
  fireEvent.click(trigger!);
  const menu = document.querySelector<HTMLElement>(
    `[data-pf-talento-column-menu-content="${id}"]`,
  );
  expect(menu, `header menu for ${id}`).not.toBeNull();
  return menu as HTMLElement;
}

function openColumnsMenu(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "Columnas" }));
  const menu = document.querySelector<HTMLElement>(
    "[data-pf-talento-columns-menu]",
  );
  expect(menu, "columns menu").not.toBeNull();
  return menu as HTMLElement;
}

function columnsToggle(menu: HTMLElement, id: string): HTMLElement {
  const item = menu.querySelector<HTMLElement>(
    `[data-pf-talento-column-toggle="${id}"]`,
  );
  expect(item, `columns toggle ${id}`).not.toBeNull();
  return item!;
}

function appliedFromTrigger(): HTMLElement {
  const field = filterSheet().querySelector<HTMLElement>(
    "[data-pf-talento-applied-from]",
  );
  expect(field, "applied-from field").not.toBeNull();
  return within(field!).getByRole("button");
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("employer talent workspace rows", () => {
  beforeEach(stubBrowserApis);

  it("renders one stable row per unique person", () => {
    renderWorkspace([DUAL, SIMPLE]);

    expect(rowIds()).toEqual(["persona-dual", "persona-simple"]);
    expect(new Set(rowIds()).size).toBe(rowIds().length);
    expect(
      document.querySelector("[data-pf-talento-workspace]"),
    ).not.toBeNull();
  });

  it("shows the progressive-detail default columns and hides the advanced ones", () => {
    renderWorkspace([DUAL]);

    for (const label of ["Persona", "Ubicación", "Experiencia", "Habilidades"]) {
      expect(
        screen.getByRole("columnheader", { name: new RegExp(label) }),
      ).toBeInTheDocument();
    }
    for (const hidden of ["Correo", "Teléfono", "Formación", "Idiomas"]) {
      expect(
        screen.queryByRole("columnheader", { name: new RegExp(hidden) }),
      ).toBeNull();
    }
  });
});

describe("employer talent workspace search and facets", () => {
  beforeEach(stubBrowserApis);

  it("filters rows through the real search box and exposes a removable chip", async () => {
    const user = userEvent.setup();
    renderWorkspace([DUAL, SIMPLE]);

    await user.type(searchBox(), "dual");
    expect(rowIds()).toEqual(["persona-dual"]);

    const chip = screen.getByRole("button", { name: /Búsqueda: dual/ });
    expect(chip).toBeInTheDocument();

    await user.click(chip);
    expect(searchBox()).toHaveValue("");
    expect(rowIds()).toEqual(["persona-dual", "persona-simple"]);
  });

  it("opens one lateral filter Sheet with a heading, a scroll body and close/reset", async () => {
    const user = userEvent.setup();
    renderWorkspace([DUAL, SIMPLE]);

    const sheet = await openFilters(user);
    expect(within(sheet).getByText("Filtros")).toBeInTheDocument();
    // Every facet control is a searchable, named multi-select combobox.
    for (const legend of ["Puesto", "Industria", "Ubicación", "Habilidades"]) {
      expect(
        within(sheet).getByRole("combobox", { name: legend }),
        `facet combobox ${legend}`,
      ).toBeInTheDocument();
    }
    expect(sheet.querySelector("[data-pf-talento-filters-close]")).not.toBeNull();
    expect(sheet.querySelector("[data-pf-talento-clear]")).not.toBeNull();
    expect(
      sheet.querySelector("[data-pf-talento-applied-from]"),
    ).not.toBeNull();
    expect(
      sheet.querySelector("[data-pf-talento-applied-to]"),
    ).not.toBeNull();
  });

  it("traps focus in the filter Sheet, closes with Escape and returns focus", async () => {
    const user = userEvent.setup();
    renderWorkspace([DUAL, SIMPLE]);

    const trigger = filterTrigger();
    await user.click(trigger);
    await waitFor(() => {
      expect(
        document.activeElement?.closest("[data-pf-talento-filters]"),
      ).not.toBeNull();
    });

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    await waitFor(() => {
      expect(document.querySelector("[data-pf-talento-filters]")).toBeNull();
    });
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });

  it("ANDs independent facets and ORs values inside one facet", async () => {
    const user = userEvent.setup();
    renderWorkspace([DUAL, SIMPLE]);

    await openFilters(user);
    selectFacetOption("industry", "Tecnología");
    expect(rowIds()).toEqual(["persona-dual"]);

    selectFacetOption("industry", "Salud");
    expect(rowIds()).toEqual(["persona-dual", "persona-simple"]);

    selectFacetOption("location", "Mérida");
    expect(rowIds()).toEqual(["persona-simple"]);
  });

  it("filters a facet's options by the typed query and reports the empty result", async () => {
    const user = userEvent.setup();
    renderWorkspace([DUAL, SIMPLE]);
    await openFilters(user);

    const facet = document.querySelector<HTMLElement>(
      '[data-pf-talento-facet="position"]',
    );
    expect(facet, "position facet").not.toBeNull();
    const input = document.getElementById(
      "talento-filtro-position",
    ) as HTMLInputElement;
    expect(input).not.toBeNull();

    // A typed query filters the real Base UI items list: the matching option
    // stays while a non-matching one is removed from the rendered list.
    await user.type(input, "front");
    expect(
      within(facet!).getByRole("option", { name: "Frontend Engineer (React)" }),
    ).toBeInTheDocument();
    expect(
      within(facet!).queryByRole("option", { name: "Data Analyst" }),
    ).toBeNull();

    // No match shows the truthful empty message and renders no option at all.
    await user.clear(input);
    await user.type(input, "zzz-no-option");
    expect(within(facet!).queryAllByRole("option")).toHaveLength(0);
    expect(within(facet!).getByText("Sin resultados")).toBeInTheDocument();

    // Clearing the query restores the full list and hides the empty message.
    await user.clear(input);
    expect(
      within(facet!).getByRole("option", { name: "Data Analyst" }),
    ).toBeInTheDocument();
    expect(within(facet!).queryByText("Sin resultados")).toBeNull();
  });

  it("renders a removable chip for a selected multi-select value", async () => {
    const user = userEvent.setup();
    renderWorkspace([DUAL, SIMPLE]);

    const sheet = await openFilters(user);
    selectFacetOption("industry", "Salud");

    // The selected value is a chip inside the control, and the toolbar exposes
    // the same criterion as one removable chip.
    const chip = sheet.querySelector('[data-slot="combobox-chip"]');
    expect(chip).toHaveTextContent("Salud");
    const remove = within(chip as HTMLElement).getByRole("button", {
      name: "Quitar Salud",
    });
    fireEvent.click(remove);
    expect(rowIds()).toEqual(["persona-dual", "persona-simple"]);

    selectFacetOption("industry", "Salud");
    const toolbarChip = document.querySelector<HTMLElement>(
      '[data-pf-talento-chip="industry:Salud"]',
    );
    expect(toolbarChip).not.toBeNull();
    await user.click(toolbarChip!);
    expect(rowIds()).toEqual(["persona-dual", "persona-simple"]);
  });

  it("requires application criteria to match the same application", async () => {
    const user = userEvent.setup();
    renderWorkspace([DUAL, SIMPLE]);

    await openFilters(user);
    selectFacetOption("position", "Frontend Engineer (React)");
    expect(rowIds()).toEqual(["persona-dual"]);

    // A stage that only the other application reaches removes the person.
    selectFacetOption("stage", "Contratado");
    expect(rowIds()).toEqual([]);

    // The stage that the frontend application does reach brings them back.
    const hiredChip = document.querySelector<HTMLElement>(
      '[data-pf-talento-chip="stage:hired"]',
    );
    expect(hiredChip).not.toBeNull();
    await user.click(hiredChip!);
    selectFacetOption("stage", "Nuevo");
    expect(rowIds()).toEqual(["persona-dual"]);
  });

  it("resets search and every facet from the Sheet clear control", async () => {
    const user = userEvent.setup();
    renderWorkspace([DUAL, SIMPLE]);

    await user.type(searchBox(), "dual");
    await openFilters(user);
    selectFacetOption("industry", "Tecnología");
    expect(rowIds()).toEqual(["persona-dual"]);

    fireEvent.click(filterSheet().querySelector("[data-pf-talento-clear]")!);

    expect(searchBox()).toHaveValue("");
    expect(screen.queryByRole("button", { name: /Búsqueda:/ })).toBeNull();
    expect(rowIds()).toEqual(["persona-dual", "persona-simple"]);
  });

  it("renders a truthful empty state when nothing matches", async () => {
    const user = userEvent.setup();
    renderWorkspace([DUAL, SIMPLE]);

    await user.type(searchBox(), "zzz-no-match");

    const empty = document.querySelector("[data-pf-talento-empty]");
    expect(empty).not.toBeNull();
    expect(empty).toHaveTextContent(/Sin resultados/);
    expect(rowIds()).toEqual([]);
  });
});

describe("employer talent workspace table controls", () => {
  beforeEach(stubBrowserApis);

  function manyPeople(count: number): TalentPerson[] {
    return Array.from({ length: count }, (_, index) =>
      makePerson({
        id: `persona-${index}`,
        fullName: `Persona ${index}`,
        email: `persona-${index}@ejemplo.mx`,
        yearsOfExperience: index,
        applications: [
          {
            id: `persona-${index}-postulacion-1`,
            vacancyId: "frontend-engineer-react",
            stage: "submitted",
            source: "direct",
            appliedAt: `2026-03-${String((index % 20) + 1).padStart(2, "0")}T00:00:00Z`,
          },
        ],
      }),
    );
  }

  it("paginates the filtered people", async () => {
    const user = userEvent.setup();
    renderWorkspace(manyPeople(25), 10);

    expect(rows()).toHaveLength(10);
    await user.click(
      screen.getByRole("button", { name: "Ir a la página siguiente" }),
    );
    expect(rows()).toHaveLength(10);
    await user.click(
      screen.getByRole("button", { name: "Ir a la página siguiente" }),
    );
    expect(rows()).toHaveLength(5);
  });

  it("sorts by a column through its header control", async () => {
    const user = userEvent.setup();
    renderWorkspace([SIMPLE, DUAL]); // experience 2 then 7

    const sortButton = document.querySelector<HTMLElement>(
      '[data-pf-talento-sort="yearsOfExperience"]',
    );
    expect(sortButton).not.toBeNull();
    // Numeric columns start descending in this table (TanStack v9 auto-sort).
    await user.click(sortButton!);
    expect(rowIds()[0]).toBe("persona-dual");

    await user.click(sortButton!);
    expect(rowIds()[0]).toBe("persona-simple");
  });

  it("exposes a drag handle, a sortable label and a menu on every header", () => {
    renderWorkspace([DUAL]);

    for (const id of ["fullName", "professionalTitle", "location"]) {
      const handle = document.querySelector<HTMLElement>(
        `[data-pf-talento-column-handle="${id}"]`,
      );
      expect(handle, `drag handle ${id}`).not.toBeNull();
      expect(handle).toHaveAttribute("draggable", "true");
      expect(
        document.querySelector(`[data-pf-talento-sort="${id}"]`),
      ).not.toBeNull();
      expect(
        document.querySelector(`[data-pf-talento-column-menu="${id}"]`),
      ).not.toBeNull();
    }

    // The header cell itself is not the pointer drag source.
    const header = document.querySelector<HTMLElement>(
      '[data-pf-talento-th="location"]',
    );
    expect(header).not.toHaveAttribute("draggable");
  });

  it("toggles column visibility from the compact toolbar menu", () => {
    renderWorkspace([DUAL]);

    const menu = openColumnsMenu();
    fireEvent.click(columnsToggle(menu, "location"));
    expect(
      screen.queryByRole("columnheader", { name: /Ubicación/ }),
    ).toBeNull();

    // Checkbox items keep the menu open so several columns can be toggled.
    expect(
      document.querySelector("[data-pf-talento-columns-menu]"),
    ).not.toBeNull();
    fireEvent.click(columnsToggle(menu, "email"));
    expect(
      screen.getByRole("columnheader", { name: /Correo/ }),
    ).toBeInTheDocument();
  });

  it("keeps the identity column always visible", () => {
    renderWorkspace([DUAL]);

    const menu = openColumnsMenu();
    const identity = columnsToggle(menu, "fullName");
    expect(identity).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(identity);
    expect(
      screen.getByRole("columnheader", { name: /Persona/ }),
    ).toBeInTheDocument();
  });

  it("pins a column to the start from its header menu and exposes a pixel sticky offset", async () => {
    const user = userEvent.setup();
    renderWorkspace([DUAL]);

    const menu = openHeaderMenu("location");
    await user.click(
      within(menu).getByRole("menuitem", { name: "Fijar Ubicación al inicio" }),
    );

    const locationHeader = document.querySelector<HTMLElement>(
      "[data-pf-talento-th='location']",
    );
    expect(locationHeader).not.toBeNull();
    expect(locationHeader).toHaveAttribute("data-pinned", "start");
    expect(locationHeader!.style.left).toBe("240px");
    expect(
      document.querySelector("[data-pf-talento-pinned-indicator='location']"),
    ).not.toBeNull();

    // The same control toggles the column back to the center region.
    const reopen = openHeaderMenu("location");
    await user.click(
      within(reopen).getByRole("menuitem", {
        name: "Quitar Ubicación del inicio",
      }),
    );
    expect(
      document.querySelector("[data-pf-talento-th='location']"),
    ).not.toHaveAttribute("data-pinned", "start");
  });

  it("reorders columns with the accessible move alternatives in the header menu", async () => {
    const user = userEvent.setup();
    renderWorkspace([DUAL]);

    expect(headerIds().slice(0, 4)).toEqual([
      "fullName",
      "professionalTitle",
      "industry",
      "location",
    ]);

    // The first column of a region cannot move toward the start.
    const firstMenu = openHeaderMenu("professionalTitle");
    expect(
      within(firstMenu).getByRole("menuitem", {
        name: "Mover a la izquierda",
      }),
    ).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(document.body, { key: "Escape" });

    const menu = openHeaderMenu("location");
    await user.click(
      within(menu).getByRole("menuitem", { name: "Mover a la izquierda" }),
    );

    expect(headerIds().slice(0, 4)).toEqual([
      "fullName",
      "professionalTitle",
      "location",
      "industry",
    ]);
  });

  it("moves columns past visible neighbors and disables the visible edges", async () => {
    const user = userEvent.setup();
    renderWorkspace([DUAL]);

    // currentCompany is hidden by default, so professionalTitle is the visible
    // leading column of the center region and both moves toward the start stay
    // disabled even though a hidden column still precedes it.
    const leading = openHeaderMenu("professionalTitle");
    expect(
      within(leading).getByRole("menuitem", { name: "Mover a la izquierda" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      within(leading).getByRole("menuitem", { name: "Mover al inicio" }),
    ).toHaveAttribute("aria-disabled", "true");

    // lastApplicationAt is the visible trailing column, so both moves toward the
    // end stay disabled while hidden columns still follow it.
    const trailing = openHeaderMenu("lastApplicationAt");
    expect(
      within(trailing).getByRole("menuitem", { name: "Mover a la derecha" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      within(trailing).getByRole("menuitem", { name: "Mover al final" }),
    ).toHaveAttribute("aria-disabled", "true");

    // One click moves industry past its visible neighbour professionalTitle,
    // skipping the hidden currentCompany instead of becoming an invisible no-op.
    expect(headerIds().slice(0, 3)).toEqual([
      "fullName",
      "professionalTitle",
      "industry",
    ]);
    await user.click(
      within(openHeaderMenu("industry")).getByRole("menuitem", {
        name: "Mover a la izquierda",
      }),
    );
    expect(headerIds().slice(0, 3)).toEqual([
      "fullName",
      "industry",
      "professionalTitle",
    ]);
    // The hidden column keeps its hidden state and its place out of the order.
    expect(
      screen.queryByRole("columnheader", { name: /Empresa actual/ }),
    ).toBeNull();
  });

  it("reorders columns through native drag started on the handle", () => {
    renderWorkspace([DUAL]);

    const handle = document.querySelector<HTMLElement>(
      "[data-pf-talento-column-handle='location']",
    )!;
    const target = document.querySelector<HTMLElement>(
      "[data-pf-talento-th='industry']",
    )!;

    fireEvent.dragStart(handle, { dataTransfer: { setData: vi.fn() } });
    fireEvent.dragOver(target, { dataTransfer: { dropEffect: "" } });
    fireEvent.drop(target, { dataTransfer: { dropEffect: "" } });

    expect(headerIds().slice(0, 4)).toEqual([
      "fullName",
      "professionalTitle",
      "location",
      "industry",
    ]);
  });
});

describe("employer talent date range filter", () => {
  beforeEach(() => {
    stubBrowserApis();
    vi.setSystemTime(new Date(2026, 2, 15, 12));
  });

  it("filters by a past application date picked through DatePickerField", async () => {
    const user = userEvent.setup();
    renderWorkspace([DUAL, SIMPLE]);

    await openFilters(user);
    await user.click(appliedFromTrigger());
    fireEvent.click(screen.getByRole("button", { name: "Día 3" }));

    const chip = document.querySelector<HTMLElement>(
      '[data-pf-talento-chip="appliedFrom"]',
    );
    expect(chip).toHaveTextContent("Postuladas desde: 2026-03-03");
    // Only the person whose application is on/after that day survives.
    expect(rowIds()).toEqual(["persona-dual"]);
  });

  it("keeps the applied range inside the past window", async () => {
    const user = userEvent.setup();
    renderWorkspace([DUAL, SIMPLE]);

    await openFilters(user);
    await user.click(appliedFromTrigger());

    const props = calendar.props as {
      disabled?: { before?: Date; after?: Date };
    };
    expect(props.disabled?.before).toBeUndefined();
    expect(props.disabled?.after).toEqual(new Date(2026, 2, 15));
  });
});

describe("employer talent global totals", () => {
  beforeEach(stubBrowserApis);

  function statText(id: string): string {
    const node = document.querySelector<HTMLElement>(
      `[data-pf-talento-stat-value="${id}"]`,
    );
    expect(node, `stat ${id}`).not.toBeNull();
    return (node!.textContent ?? "").trim();
  }

  function wholeBaseTotals() {
    return {
      people: statText("people"),
      applications: statText("applications"),
      immediate: statText("immediate"),
      vacancies: statText("vacancies"),
    };
  }

  const IMMEDIATE = makePerson({
    id: "persona-inmediata",
    fullName: "Persona Inmediata",
    availability: "immediate",
  });
  const LATER = makePerson({
    id: "persona-tarde",
    fullName: "Persona Tarde",
    availability: "two_weeks",
    skills: ["Go"],
    applications: [
      {
        id: "persona-tarde-postulacion-1",
        vacancyId: "data-analyst",
        stage: "submitted",
        source: "direct",
        appliedAt: "2026-03-02T00:00:00Z",
      },
      {
        id: "persona-tarde-postulacion-2",
        vacancyId: "devops-engineer",
        stage: "in_review",
        source: "referral",
        appliedAt: "2026-03-03T00:00:00Z",
      },
    ],
  });

  it("keeps the whole-base totals untouched by filters, empty results, reset and pagination", async () => {
    const user = userEvent.setup();
    renderWorkspace([IMMEDIATE, LATER], 1);

    // Computed from the whole base: 2 people, 3 applications, 1 immediate,
    // 3 distinct represented vacancies.
    const base = {
      people: "2",
      applications: "3",
      immediate: "1",
      vacancies: "3",
    };
    expect(wholeBaseTotals()).toEqual(base);

    // A search that narrows the table to one person moves no counter.
    await user.type(searchBox(), "inmediata");
    expect(rowIds()).toEqual(["persona-inmediata"]);
    expect(wholeBaseTotals()).toEqual(base);

    // An empty result set moves no counter either.
    await user.clear(searchBox());
    await user.type(searchBox(), "zzz-no-match");
    expect(rowIds()).toEqual([]);
    expect(wholeBaseTotals()).toEqual(base);

    // Resetting the criteria leaves the whole-base totals identical.
    await user.clear(searchBox());
    expect(rowIds()).toEqual(["persona-inmediata"]);
    expect(wholeBaseTotals()).toEqual(base);

    // Paging the table never re-scopes the cards to the current page.
    await user.click(
      screen.getByRole("button", { name: "Ir a la página siguiente" }),
    );
    expect(rowIds()).toEqual(["persona-tarde"]);
    expect(wholeBaseTotals()).toEqual(base);
  });
});

describe("employer talent table density", () => {
  beforeEach(stubBrowserApis);

  it("gives every data row an airy height and generous cell padding", () => {
    renderWorkspace([DUAL, SIMPLE]);

    const dataRows = rows();
    expect(dataRows).toHaveLength(2);
    for (const row of dataRows) {
      expect(row.className).toContain("h-[70px]");
    }

    const cell = document.querySelector<HTMLElement>("[data-pf-talento-row] td");
    expect(cell).not.toBeNull();
    expect(cell!.className).toContain("px-4");
    expect(cell!.className).toContain("py-3");

    const header = document.querySelector<HTMLElement>("[data-pf-talento-th]");
    expect(header).not.toBeNull();
    expect(header!.className).toContain("px-4");
  });

  it("keeps the identity name as the exact accessible name with a decorative avatar", () => {
    renderWorkspace([DUAL]);

    const name = screen.getByRole("button", { name: "Persona Dual" });
    // The avatar's initials and the secondary line never join the name.
    expect(name).toHaveAccessibleName("Persona Dual");

    const identityCell = name.closest("td") as HTMLElement;
    expect(identityCell).not.toBeNull();
    const avatar = identityCell.querySelector("[data-slot='avatar']");
    expect(avatar).not.toBeNull();
    expect(avatar).toHaveAttribute("aria-hidden", "true");
    expect(
      identityCell.querySelector("[data-slot='avatar-fallback']"),
    ).toHaveTextContent(/^PD$/u);
    // The hierarchy is name first, professional title as the secondary line.
    expect(identityCell.textContent).toContain("Desarrolladora Frontend");
  });

  it("preserves the pixel pinned geometry and the opaque pinned surfaces", () => {
    renderWorkspace([DUAL]);

    const header = document.querySelector<HTMLElement>(
      "[data-pf-talento-th='fullName']",
    );
    expect(header).not.toBeNull();
    expect(header).toHaveAttribute("data-pinned", "start");
    expect(header!.style.left).toBe("0px");
    expect(header!.style.width).toBe("240px");
    expect(header!.className).toContain("bg-muted");

    const cell = document.querySelector<HTMLElement>(
      "[data-pf-talento-row] td[data-pinned='start']",
    );
    expect(cell).not.toBeNull();
    expect(cell!.style.left).toBe("0px");
    expect(cell!.style.width).toBe("240px");
    expect(cell!.className).toContain("bg-background");
  });
});

describe("employer talent detail sheet", () => {
  beforeEach(stubBrowserApis);

  it("opens one sheet outside the table loop with the full application history", async () => {
    const user = userEvent.setup();
    renderWorkspace([DUAL, SIMPLE]);

    await user.click(screen.getByRole("button", { name: "Persona Dual" }));

    const sheet = screen.getByRole("dialog");
    expect(document.querySelectorAll("[data-slot='sheet-content']")).toHaveLength(
      1,
    );
    expect(
      document
        .querySelector("[data-pf-talento-table]")!
        .contains(document.querySelector("[data-slot='sheet-content']")),
    ).toBe(false);

    expect(within(sheet).getByText("Persona Dual")).toBeInTheDocument();
    expect(within(sheet).getByText("Backend Developer (Senior)")).toBeInTheDocument();
    expect(within(sheet).getByText("Frontend Engineer (React)")).toBeInTheDocument();
    expect(within(sheet).getByText("Contratado")).toBeInTheDocument();
    expect(within(sheet).getByText("Nuevo")).toBeInTheDocument();
  });

  it("closes with Escape and returns focus to the row control", async () => {
    const user = userEvent.setup();
    renderWorkspace([DUAL, SIMPLE]);

    const trigger = screen.getByRole("button", { name: "Persona Dual" });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    await waitFor(() => {
      expect(trigger).toHaveFocus();
    });
  });

  it("offers no fake contact or export action and only enabled inert demo Currículum controls", async () => {
    const user = userEvent.setup();
    renderWorkspace([DUAL, SIMPLE]);

    await user.click(screen.getByRole("button", { name: "Persona Dual" }));
    const sheet = screen.getByRole("dialog");

    for (const fake of [/contactar/i, /exportar/i, /enviar/i, /guardar/i]) {
      expect(
        within(sheet).queryByRole("button", { name: fake }),
      ).toBeNull();
      expect(within(sheet).queryByRole("link", { name: fake })).toBeNull();
    }
    expect(within(sheet).queryByText(/match|score|compatibilidad/i)).toBeNull();

    // The only download-shaped affordance is the demo Currículum placeholder, and
    // the durable rule keeps it enabled, focusable and inert: there is still no
    // download link and no real file behind it.
    const descargar = within(sheet).getByRole("button", { name: "Descargar" });
    const verCv = within(sheet).getByRole("button", { name: "Ver CV" });
    expect(descargar).toBeEnabled();
    expect(verCv).toBeEnabled();
    expect(within(sheet).queryByRole("link", { name: /descargar/i })).toBeNull();
    expect(within(sheet).queryByRole("link", { name: /ver cv/i })).toBeNull();

    // Clicking is inert: the sheet stays open on the same person instead of
    // closing, navigating or reporting a fake success.
    await user.click(verCv);
    await user.click(descargar);
    expect(screen.getByRole("dialog")).toBe(sheet);
    expect(within(sheet).getByText("Persona Dual")).toBeInTheDocument();
    expect(
      within(sheet).queryByText(/descargado|descarga iniciada|éxito|abriendo/i),
    ).toBeNull();
  });
});
