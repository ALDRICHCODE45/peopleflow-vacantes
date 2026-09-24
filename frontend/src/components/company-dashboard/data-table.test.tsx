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
import { readFileSync } from "node:fs";
import { join } from "node:path";

import applicants from "@/app/(empresa)/empresa/dashboard/data.json";
import {
  APPLICANT_SOURCES,
  APPLICANT_STATUSES,
  DataTable,
  formatReceivedDate,
  formatYearsOfExperience,
  schema,
  SOURCE_LABELS,
  STATUS_LABELS,
} from "./data-table";

// Vitest runs from frontend/, so cwd-relative paths keep the assertions stable.
const source = readFileSync(
  join(process.cwd(), "src/components/company-dashboard/data-table.tsx"),
  "utf8",
);

// Validated fixture: the same boundary the component applies before rendering.
const rows = schema.array().parse(applicants);

// The closed vocabulary the backend exposes. Any other stage is a contract bug,
// not a display option.
const EXPECTED_STATUS_DISTRIBUTION = {
  submitted: 5,
  in_review: 3,
  hired: 2,
  rejected: 2,
} as const;

const EXPECTED_SOURCE_DISTRIBUTION = {
  direct: 3,
  referral: 2,
  linkedin: 3,
  job_board: 3,
  other: 1,
} as const;

const EXPECTED_FIELDS = [
  "fullName",
  "id",
  "owner",
  "professionalTitle",
  "receivedAt",
  "source",
  "status",
  "vacancy",
  "yearsOfExperience",
];

// The canonical semantic status vocabulary the shared Badge exposes.
const STATUS_VARIANTS = {
  submitted: "info",
  in_review: "review",
  hired: "success",
  rejected: "danger",
} as const;
const STATUS_TOKENS = {
  submitted: "status-info",
  in_review: "status-review",
  hired: "status-success",
  rejected: "status-danger",
} as const;
/** Any Tailwind palette utility is a raw color: only semantic tokens are allowed. */
const RAW_PALETTE =
  /(?:^|\s|[a-z-]+:)(?:text|bg|border)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)-\d{2,3}(?:\s|$)/;

// jsdom implements neither matchMedia nor ResizeObserver. The drawer direction
// reads the first through `useIsMobile`; the sidebar/chart primitives read both.
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
 * Toggles a checkbox by its Spanish accessible name.
 *
 * The visible Base UI control is a `span` driven by pointer events, and jsdom
 * dispatches mouse events only, so the visually-hidden native input Base UI keeps
 * for form integration is the reliable driver under jsdom. Both paths resolve to
 * the same `onCheckedChange` wiring the component declares.
 */
function toggleCheckbox(name: string) {
  const control = screen.getByRole("checkbox", { name });
  const native = control.parentElement?.querySelector("input[type='checkbox']");
  expect(native, `${name} native input`).not.toBeNull();
  fireEvent.click(native as HTMLElement);
}

function tableBody(): HTMLElement {
  const body = document.querySelector("[data-slot='table-body']");
  expect(body, "table body").not.toBeNull();
  return body as HTMLElement;
}

function bodyRows(): HTMLElement[] {
  return Array.from(tableBody().querySelectorAll("tr"));
}

function statusTab(name: string): HTMLElement {
  return screen.getByRole("tab", {
    name: (accessibleName) => accessibleName.includes(name),
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("company dashboard recent applicants fixture", () => {
  it("accepts only the backend's closed status vocabulary", () => {
    const valid = rows[0];

    for (const status of APPLICANT_STATUSES) {
      expect(
        schema.safeParse({ ...valid, status }).success,
        `${status} must be accepted`,
      ).toBe(true);
    }

    for (const unsupported of [
      "offer",
      "interview",
      "withdrawn",
      "In Process",
      "Done",
      "Not Started",
    ]) {
      expect(
        schema.safeParse({ ...valid, status: unsupported }).success,
        `${unsupported} must be rejected`,
      ).toBe(false);
    }
  });

  it("accepts only the backend's closed application-source vocabulary", () => {
    const valid = rows[0];

    for (const source of APPLICANT_SOURCES) {
      expect(
        schema.safeParse({ ...valid, source }).success,
        `${source} must be accepted`,
      ).toBe(true);
    }

    for (const unsupported of ["twitter", "glassdoor", "agency", "Desktop"]) {
      expect(
        schema.safeParse({ ...valid, source: unsupported }).success,
        `${unsupported} must be rejected`,
      ).toBe(false);
    }
  });

  it("rejects a receivedAt that is not an ISO UTC timestamp", () => {
    const valid = rows[0];

    expect(schema.safeParse({ ...valid, receivedAt: "30/06/2024" }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ ...valid, receivedAt: "2024-06-30" }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ ...valid, receivedAt: "ayer" }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ ...valid, receivedAt: "2024-06-30T15:40:00Z" }).success,
    ).toBe(true);
  });

  it("parses exactly twelve applicant rows", () => {
    expect(rows).toHaveLength(12);
    expect(applicants).toHaveLength(12);
  });

  it("carries only the applicant fields, never the stock document fields", () => {
    for (const row of applicants) {
      expect(Object.keys(row).sort()).toEqual(EXPECTED_FIELDS);
    }

    for (const stock of ["header", "type", "target", "limit", "reviewer"]) {
      expect(
        Object.keys(applicants[0]),
        `${stock} document field must be gone`,
      ).not.toContain(stock);
    }
  });

  it("uses unique numeric ids and plausible experience values", () => {
    const ids = rows.map((row) => row.id);

    expect(new Set(ids).size).toBe(12);
    for (const row of rows) {
      expect(Number.isInteger(row.id), `id ${row.id}`).toBe(true);
      expect(row.id, `id ${row.id}`).toBeGreaterThan(0);
      expect(
        Number.isInteger(row.yearsOfExperience),
        `${row.fullName} years`,
      ).toBe(true);
      expect(row.yearsOfExperience).toBeGreaterThan(0);
      expect(row.yearsOfExperience).toBeLessThan(40);
      expect(row.fullName.trim()).not.toBe("");
      expect(row.professionalTitle.trim()).not.toBe("");
      expect(row.vacancy.trim()).not.toBe("");
      expect(row.owner.trim()).not.toBe("");
    }
  });

  it("exports the exact status and source distributions", () => {
    const countBy = (key: "status" | "source") =>
      rows.reduce<Record<string, number>>((totals, row) => {
        totals[row[key]] = (totals[row[key]] ?? 0) + 1;
        return totals;
      }, {});

    expect(countBy("status")).toEqual(EXPECTED_STATUS_DISTRIBUTION);
    expect(countBy("source")).toEqual(EXPECTED_SOURCE_DISTRIBUTION);
  });

  it("keeps every receivedAt as an ISO UTC timestamp", () => {
    for (const row of rows) {
      expect(row.receivedAt, `${row.fullName} receivedAt`).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
      );
    }
  });
});

describe("company dashboard received-date formatting", () => {
  it("formats in Spanish, pinned to UTC so no row shifts a day", () => {
    // 2024-06-24T02:25:00Z is still 23 June on this host (America/Mexico_City,
    // UTC-6): the UTC pin is what keeps the visible day correct.
    expect(formatReceivedDate("2024-06-24T02:25:00Z")).toBe("24 jun 2024");
    expect(formatReceivedDate("2024-06-24T02:25:00Z")).not.toBe("23 jun 2024");
    expect(formatReceivedDate("2024-06-19T14:50:00Z")).toBe("19 jun 2024");
  });

  it("stays independent from the current clock", () => {
    const first = formatReceivedDate("2024-06-30T15:40:00Z");
    vi.setSystemTime(new Date("2031-01-01T00:00:00Z"));
    try {
      expect(formatReceivedDate("2024-06-30T15:40:00Z")).toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pins the formatter to an explicit UTC time zone", () => {
    expect(source).toMatch(/timeZone:\s*"UTC"/);
  });

  it("pluralizes the experience snapshot in Spanish", () => {
    expect(formatYearsOfExperience(6)).toBe("6 años");
    expect(formatYearsOfExperience(1)).toBe("1 año");
  });
});

describe("company dashboard recent applicants table", () => {
  beforeEach(stubBrowserApis);

  it("keeps exactly one preserved data-table marker on the tabs root", () => {
    render(<DataTable data={applicants} />);

    const markers = document.querySelectorAll("[data-pf-data-table]");
    expect(markers).toHaveLength(1);
    expect(markers[0]).toHaveAttribute("data-pf-data-table", "");
    expect(markers[0]).toHaveAttribute("data-slot", "tabs");
    expect(source.match(/data-pf-data-table=/g)).toHaveLength(1);
  });

  it("titles the surface Candidatos recientes inside the existing toolbar", () => {
    render(<DataTable data={applicants} />);

    const heading = screen.getByRole("heading", { name: "Candidatos recientes" });
    const toolbar = heading.parentElement as HTMLElement;

    // The title shares the toolbar row that already held the view controls, so
    // no new vertical section is introduced above the table.
    expect(within(toolbar).getByRole("tablist")).toBeInTheDocument();
    expect(toolbar.className).toContain("px-4");
    expect(toolbar.className).toContain("lg:px-6");
  });

  it("renames the columns for recruiting semantics", () => {
    render(<DataTable data={applicants} />);

    for (const column of [
      "Candidato",
      "Vacante",
      "Estado",
      "Fuente",
      "Recibida",
      "Responsable",
    ]) {
      expect(
        screen.getByRole("columnheader", { name: new RegExp(column) }),
        `${column} column`,
      ).toBeInTheDocument();
    }

    for (const stock of [
      "Header",
      "Section Type",
      "Target",
      "Limit",
      "Reviewer",
    ]) {
      expect(
        screen.queryByRole("columnheader", { name: stock }),
        `${stock} column must be gone`,
      ).toBeNull();
    }
  });

  it("keeps the first page at ten rows with an unlabelled drag column gone", () => {
    render(<DataTable data={applicants} />);

    expect(bodyRows()).toHaveLength(10);
    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-slot='table-cell']").length).toBe(
      10 * 7,
    );
  });

  it("shows the translated status and source of every visible applicant", () => {
    render(<DataTable data={applicants} />);

    // Page 1 covers all four statuses and all five sources.
    for (const label of ["Nuevo", "En revisión", "Contratado", "Descartado"]) {
      expect(screen.getAllByText(label).length, `${label} status`).toBeGreaterThan(
        0,
      );
    }
    for (const label of [
      "Directa",
      "Referido",
      "LinkedIn",
      "Portal de empleo",
      "Otra",
    ]) {
      expect(screen.getAllByText(label).length, `${label} source`).toBeGreaterThan(
        0,
      );
    }

    expect(
      screen.getByText(formatReceivedDate(rows[0].receivedAt)),
    ).toBeInTheDocument();
    // The owner column repeats across rows, so the assertion is presence-based.
    expect(screen.getAllByText("Elena Márquez").length).toBeGreaterThan(0);
  });

  it("maps every applicant status onto the exact semantic Badge variant with a decorative dot", () => {
    render(<DataTable data={applicants} />);

    const seen = new Set<string>();
    for (const status of APPLICANT_STATUSES) {
      const label = STATUS_LABELS[status];
      // The tab label repeats "En revisión" as its own direct text, so the
      // badges are read from the table body, not from an unqualified text query.
      const badges = Array.from(
        tableBody().querySelectorAll("[data-slot='badge']"),
      ).filter((badge) => badge.textContent === label) as HTMLElement[];
      expect(badges.length, `${label} status`).toBeGreaterThan(0);

      for (const badge of badges) {
        expect(badge).toHaveAttribute("data-slot", "badge");
        expect(badge).toHaveAttribute("data-variant", STATUS_VARIANTS[status]);
        expect(badge).toHaveAttribute("data-dot");
        expect(badge.className).toContain(STATUS_TOKENS[status]);
        expect(RAW_PALETTE.test(badge.className)).toBe(false);
        // The dot is the shared recipe's `::before`, never a manually rendered child.
        expect(badge.childNodes).toHaveLength(1);
        expect(badge.querySelectorAll("*")).toHaveLength(0);
        // The primitive owns the compact geometry: no local padding override.
        expect(badge.className).not.toContain("px-1.5");
      }
      seen.add(STATUS_VARIANTS[status]);
    }

    expect(seen).toEqual(new Set(["info", "review", "success", "danger"]));
    // The raw destructive mapping and its red palette are gone.
    expect(source).toMatch(
      /STATUS_BADGE_VARIANTS: Readonly<Record<ApplicantStatus, BadgeVariant>>/u,
    );
    expect(source).not.toContain("destructive");
    expect(source).not.toMatch(/\b(?:bg|text|border)-red-\d/u);
    expect(source).not.toContain("px-1.5");
  });

  it("keeps the source labels neutral and dotless metadata chips", () => {
    render(<DataTable data={applicants} />);

    for (const sourceValue of APPLICANT_SOURCES) {
      const label = SOURCE_LABELS[sourceValue];
      const nodes = screen.getAllByText(label);
      expect(nodes.length, `${label} source`).toBeGreaterThan(0);

      for (const node of nodes) {
        const badge = node.closest("[data-slot='badge']");
        expect(badge, `${label} badge`).not.toBeNull();
        expect(badge).toHaveAttribute("data-variant", "outline");
        expect(badge).not.toHaveAttribute("data-dot");
        expect((badge as HTMLElement).className).toContain("text-muted-foreground");
        expect(badge!.querySelectorAll("*")).toHaveLength(0);
      }
    }
  });

  it("keeps the tab-count counters neutral, dotless and circular", () => {
    render(<DataTable data={applicants} />);

    const tabList = screen.getByRole("tablist");
    const counters = Array.from(
      tabList.querySelectorAll("[data-slot='badge']"),
    ) as HTMLElement[];

    expect(counters).toHaveLength(4);
    for (const counter of counters) {
      expect(counter).toHaveAttribute("data-variant", "secondary");
      expect(counter).not.toHaveAttribute("data-dot");
      expect(counter.querySelectorAll("*")).toHaveLength(0);
    }

    // The circular size is a counter exception owned by the shared TabsList,
    // not a status Badge geometry override.
    expect(tabList.className).toContain("**:data-[slot=badge]:rounded-full");
    expect(tabList.className).toContain("**:data-[slot=badge]:px-1");
  });

  it("shows coherent pipeline counts on every tab", () => {
    render(<DataTable data={applicants} />);

    expect(statusTab("Todos")).toHaveTextContent("12");
    expect(statusTab("Nuevos")).toHaveTextContent("5");
    expect(statusTab("En revisión")).toHaveTextContent("3");
    expect(statusTab("Contratados")).toHaveTextContent("2");
  });

  it("renders a single table panel instead of the stock placeholder panels", () => {
    render(<DataTable data={applicants} />);

    expect(document.querySelectorAll("[data-slot='tabs-content']")).toHaveLength(
      1,
    );
  });
});

describe("company dashboard pipeline tabs", () => {
  beforeEach(stubBrowserApis);

  it("filters the rows down to the new applicants", async () => {
    const user = userEvent.setup();
    render(<DataTable data={applicants} />);

    await user.click(statusTab("Nuevos"));

    expect(bodyRows()).toHaveLength(5);
    expect(screen.getByText("Página 1 de 1")).toBeInTheDocument();
    expect(screen.getByText("Valentina Ríos")).toBeInTheDocument();
    expect(screen.queryByText("Descartado")).toBeNull();
    expect(screen.queryByText("Contratado")).toBeNull();
  });

  it("filters the rows down to the in-review applicants", async () => {
    const user = userEvent.setup();
    render(<DataTable data={applicants} />);

    await user.click(statusTab("En revisión"));

    expect(bodyRows()).toHaveLength(3);
    expect(screen.getAllByText("En revisión").length).toBeGreaterThan(0);
    expect(screen.getByText("Mateo Herrera")).toBeInTheDocument();
    expect(screen.queryByText("Valentina Ríos")).toBeNull();
  });

  it("filters the rows down to the hired applicants", async () => {
    const user = userEvent.setup();
    render(<DataTable data={applicants} />);

    await user.click(statusTab("Contratados"));

    expect(bodyRows()).toHaveLength(2);
    expect(screen.getByText("Lucía Fernández")).toBeInTheDocument();
    expect(screen.getByText("Emilio Cabrera")).toBeInTheDocument();
    expect(screen.queryByText("Descartado")).toBeNull();
  });

  it("returns to the whole recent list from Todos", async () => {
    const user = userEvent.setup();
    render(<DataTable data={applicants} />);

    await user.click(statusTab("Contratados"));
    expect(bodyRows()).toHaveLength(2);

    await user.click(statusTab("Todos"));

    expect(bodyRows()).toHaveLength(10);
    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
  });

  it("resets pagination when the pipeline filter changes", async () => {
    const user = userEvent.setup();
    render(<DataTable data={applicants} />);

    await user.click(screen.getByRole("button", { name: "Ir a la página siguiente" }));
    expect(screen.getByText("Página 2 de 2")).toBeInTheDocument();

    await user.click(statusTab("Nuevos"));

    expect(screen.getByText("Página 1 de 1")).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(5);
  });

  it("binds the mobile pipeline select to the same filter state", async () => {
    const user = userEvent.setup();
    render(<DataTable data={applicants} />);

    const select = screen.getByLabelText("Filtrar por estado");

    // Both controls are handles on one state: the select reports the tab the
    // recruiter picked, which is what makes it a real filter and not a label.
    await user.click(statusTab("Contratados"));
    expect(select).toHaveTextContent("Contratados");
    expect(bodyRows()).toHaveLength(2);

    await user.click(statusTab("Todos"));
    expect(select).toHaveTextContent("Todos");

    // The select is untestable through its portal under jsdom, so the shared
    // handler binding is asserted at the source level instead.
    expect(source.match(/selectStatus\(String\(value\)\)/g)).toHaveLength(2);
  });
});

describe("company dashboard table interactions", () => {
  beforeEach(stubBrowserApis);

  it("keeps row selection with Spanish labels and page-scoped totals", () => {
    render(<DataTable data={applicants} />);

    toggleCheckbox("Seleccionar a Valentina Ríos");
    expect(
      screen.getByText("1 de 12 candidatos seleccionados."),
    ).toBeInTheDocument();

    toggleCheckbox("Seleccionar todas las filas");
    expect(
      screen.getByText("10 de 12 candidatos seleccionados."),
    ).toBeInTheDocument();
  });

  it("keeps column visibility wired to Spanish column names", () => {
    render(<DataTable data={applicants} />);

    expect(screen.getByText("Personalizar columnas")).toBeInTheDocument();
    expect(screen.getByText("Columnas")).toBeInTheDocument();
    expect(screen.getByText("Personalizar columnas").className).toContain(
      "hidden",
    );
    expect(screen.getByText("Columnas").className).toContain("lg:hidden");
    expect(
      screen.getByRole("button", { name: /personalizar columnas/i }),
    ).toBeInTheDocument();

    // The dropdown mounts through a floating-ui portal that jsdom cannot drive,
    // so the toggle wiring is asserted at the source level: every hideable column
    // is listed with its Spanish label and bound to `toggleVisibility`.
    expect(source).toContain("DropdownMenuCheckboxItem");
    expect(source).toMatch(/getCanHide\(\)[\s\S]*toggleVisibility/);
    for (const label of ["Vacante", "Estado", "Fuente", "Recibida", "Responsable"]) {
      expect(source).toContain(`"${label}"`);
    }

    // The identity column carries the drawer trigger, so it stays pinned.
    expect(source).toMatch(
      /accessor\("fullName",\s*\{[\s\S]*?enableHiding: false/,
    );
  });

  it("keeps pagination localized and navigable", async () => {
    const user = userEvent.setup();
    render(<DataTable data={applicants} />);

    expect(screen.getByText("Filas por página")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Filas por página" }),
    ).toHaveTextContent("10");

    await user.click(
      screen.getByRole("button", { name: "Ir a la página siguiente" }),
    );

    expect(screen.getByText("Página 2 de 2")).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(2);
    expect(within(tableBody()).queryByText("Valentina Ríos")).toBeNull();
    expect(screen.getByText("Daniela Suárez")).toBeInTheDocument();
    expect(screen.getByText("Bruno Beltrán")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Ir a la página anterior" }),
    );

    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
    expect(bodyRows()).toHaveLength(10);
  });

  it("localizes every pagination navigation label", () => {
    render(<DataTable data={applicants} />);

    for (const label of [
      "Ir a la primera página",
      "Ir a la página anterior",
      "Ir a la página siguiente",
      "Ir a la última página",
    ]) {
      expect(
        screen.getByRole("button", { name: label }),
        `${label} control`,
      ).toBeInTheDocument();
    }
  });
});

describe("company dashboard candidate detail drawer", () => {
  beforeEach(stubBrowserApis);

  it("opens a read-only snapshot from the candidate name", async () => {
    const user = userEvent.setup();
    render(<DataTable data={applicants} />);

    const trigger = screen.getByRole("button", { name: "Valentina Ríos" });
    expect(trigger).toBeInTheDocument();

    await user.click(trigger);

    const dialog = await screen.findByRole("dialog");
    const candidate = rows[0];

    expect(within(dialog).getByText(candidate.fullName)).toBeInTheDocument();
    expect(
      within(dialog).getByText(candidate.professionalTitle),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(formatYearsOfExperience(candidate.yearsOfExperience)),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(candidate.vacancy)).toBeInTheDocument();
    expect(within(dialog).getByText("Nuevo")).toBeInTheDocument();
    expect(within(dialog).getByText("LinkedIn")).toBeInTheDocument();
    expect(
      within(dialog).getByText(formatReceivedDate(candidate.receivedAt)),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(candidate.owner)).toBeInTheDocument();
  });

  it("renders the detail status as the same dotted semantic variant", async () => {
    const user = userEvent.setup();
    render(<DataTable data={applicants} />);

    await user.click(screen.getByRole("button", { name: "Valentina Ríos" }));
    const dialog = await screen.findByRole("dialog");
    const candidate = rows[0];
    const badge = within(dialog)
      .getByText(STATUS_LABELS[candidate.status])
      .closest("[data-slot='badge']") as HTMLElement;

    expect(badge).not.toBeNull();
    expect(badge).toHaveAttribute("data-slot", "badge");
    expect(badge).toHaveAttribute("data-variant", STATUS_VARIANTS[candidate.status]);
    expect(badge).toHaveAttribute("data-dot");
    expect(badge.className).toContain(STATUS_TOKENS[candidate.status]);
    expect(badge.querySelectorAll("*")).toHaveLength(0);
  });

  it("offers a single Cerrar control and no mutating demo action", async () => {
    const user = userEvent.setup();
    render(<DataTable data={applicants} />);

    await user.click(screen.getByRole("button", { name: "Valentina Ríos" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getAllByRole("button")).toHaveLength(1);
    expect(
      within(dialog).getByRole("button", { name: "Cerrar" }),
    ).toBeInTheDocument();

    for (const demo of [
      "Submit",
      "Done",
      "Edit",
      "Make a copy",
      "Favorite",
      "Delete",
      "Header",
      "Target",
      "Limit",
      "Reviewer",
    ]) {
      expect(
        within(dialog).queryByText(demo, { exact: true }),
        `${demo} demo content`,
      ).toBeNull();
    }
  });

  it("closes from the Cerrar control without mutating the row", async () => {
    const user = userEvent.setup();
    render(<DataTable data={applicants} />);

    await user.click(screen.getByRole("button", { name: "Valentina Ríos" }));
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Cerrar" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(screen.getByText("Valentina Ríos")).toBeInTheDocument();
  });

  it("shows the drawer without the removed visitor mini-chart", async () => {
    const user = userEvent.setup();
    render(<DataTable data={applicants} />);

    await user.click(screen.getByRole("button", { name: "Valentina Ríos" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).queryByText(/visitors/i)).toBeNull();
    expect(within(dialog).queryByText(/trending up/i)).toBeNull();
    expect(dialog.querySelector("[data-slot='chart']")).toBeNull();
    expect(within(dialog).queryByRole("textbox")).toBeNull();
  });
});

describe("company dashboard table empty and demo-free surface", () => {
  beforeEach(stubBrowserApis);

  it("renders a localized empty state when no applicant matches", () => {
    render(<DataTable data={[]} />);

    expect(screen.getByText("Sin candidatos")).toBeInTheDocument();
    expect(
      screen.getByText("No hay postulantes en este estado de la vacante."),
    ).toBeInTheDocument();
    expect(screen.getByText("0 de 0 candidatos seleccionados.")).toBeInTheDocument();
  });

  it("drops the drag reorder, numeric edit, Add Section and demo action surfaces", () => {
    render(<DataTable data={applicants} />);

    expect(screen.queryByRole("button", { name: /add section/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /drag to reorder/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /open menu/i })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    // The checkboxes are the only inputs the table may keep.
    expect(
      document.querySelectorAll(
        "table input[type='text'], table input[type='number']",
      ).length,
    ).toBe(0);
  });

  it("leaves no stock document string in the source or on the surface", () => {
    render(<DataTable data={applicants} />);

    for (const stock of [
      "Outline",
      "Past Performance",
      "Key Personnel",
      "Focus Documents",
      "Section Type",
      "Reviewer",
      "Customize Columns",
      "Add Section",
      "Rows per page",
      "Select a view",
      "No results.",
      "Cover page",
      "shadcn",
    ]) {
      expect(screen.queryByText(stock), `${stock} rendered`).toBeNull();
      expect(source, `${stock} in source`).not.toContain(stock);
    }
  });

  it("imports neither dnd-kit, the demo form, nor the drawer chart", () => {
    for (const token of [
      "@dnd-kit",
      "DndContext",
      "useSortable",
      "SortableContext",
      "arrayMove",
      "restrictToVerticalAxis",
      "IconGripVertical",
      "Drag to reorder",
      "handleDragEnd",
      "recharts",
      "AreaChart",
      "ChartContainer",
      "chartConfig",
      "chartData",
      "toast",
      "IconPlus",
      "IconDotsVertical",
      "IconTrendingUp",
      "@/components/ui/input",
      "@/components/ui/separator",
    ]) {
      expect(source, `${token} must be gone`).not.toContain(token);
    }
  });

  it("introduces no raw color value", () => {
    expect(source).not.toMatch(/oklch\(|#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\s*\(/);
  });

  it("keeps every localized surface string in the component source", () => {
    for (const label of [
      "Candidatos recientes",
      "Todos",
      "Nuevos",
      "En revisión",
      "Contratados",
      "Candidato",
      "Vacante",
      "Estado",
      "Fuente",
      "Recibida",
      "Responsable",
      "Personalizar columnas",
      "Filas por página",
      "Página",
      "Sin candidatos",
      "Seleccionar todas las filas",
      "Cerrar",
    ]) {
      expect(source, `${label} in source`).toContain(label);
    }
  });
});

describe("company dashboard column control responsive labels", () => {
  beforeEach(stubBrowserApis);

  it("makes the column control icon-only below sm", () => {
    render(<DataTable data={applicants} />);

    // One accessible name for the whole control, so the icon-only rendering
    // below `sm` never loses its label.
    const trigger = screen.getByRole("button", {
      name: "Personalizar columnas",
    });

    const columnsIcon = trigger.querySelector("svg.tabler-icon-layout-columns");
    expect(columnsIcon).not.toBeNull();
    expect(columnsIcon!.getAttribute("class")).not.toContain("hidden");

    // The chevron belongs to the labelled rendering, not to the icon-only one.
    const chevron = trigger.querySelector("svg.tabler-icon-chevron-down");
    expect(chevron).not.toBeNull();
    expect(chevron!.getAttribute("class")).toContain("hidden");
    expect(chevron!.getAttribute("class")).toContain("sm:inline");
  });

  it("shows Columnas from sm to lg and Personalizar columnas from lg", () => {
    render(<DataTable data={applicants} />);

    const short = screen.getByText("Columnas");
    const long = screen.getByText("Personalizar columnas");

    // Below `sm` neither label renders, which keeps the toolbar on its single
    // 32px row instead of wrapping the table downward.
    expect(short.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["hidden", "sm:inline", "lg:hidden"]),
    );
    expect(long.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["hidden", "lg:inline"]),
    );

    // Exactly one label is visible from `lg`, and none of them is visible
    // below `sm`: the two gates must not overlap.
    expect(short.className.split(/\s+/)).not.toContain("lg:inline");
    expect(long.className.split(/\s+/)).not.toContain("sm:inline");
  });

  it("keeps the toolbar row and the column behavior untouched", () => {
    render(<DataTable data={applicants} />);

    const heading = screen.getByRole("heading", { name: "Candidatos recientes" });
    const toolbar = heading.parentElement as HTMLElement;

    // Outer table gaps, padding and the marker stay as approved.
    expect(toolbar.className).toContain("flex-wrap");
    expect(toolbar.className).toContain("gap-y-3");
    expect(toolbar.className).toContain("px-4");
    expect(toolbar.className).toContain("lg:px-6");
    expect(document.querySelectorAll("[data-pf-data-table]")).toHaveLength(1);

    // The mobile status select stays available next to the column control.
    expect(screen.getByLabelText("Filtrar por estado")).toBeInTheDocument();

    // The visibility behavior itself is unchanged.
    expect(
      screen.getByRole("button", { name: "Personalizar columnas" }),
    ).toHaveAttribute("aria-haspopup", "menu");
  });
});
