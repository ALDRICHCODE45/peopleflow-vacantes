import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import EmployerDashboardContent, {
  metadata,
} from "./page";
import { EmployerShell } from "@/components/company-dashboard/employer-shell";

// Mirrors the (empresa) layout: the shell wraps the route content.
function EmployerDashboardPage() {
  return (
    <EmployerShell>
      <EmployerDashboardContent />
    </EmployerShell>
  );
}
import { formatTickLabel } from "@/components/company-dashboard/chart-area-interactive";

// Vitest runs from frontend/, so cwd-relative paths keep the assertions stable.
const pageSource = readFileSync(
  join(process.cwd(), "src/app/(empresa)/empresa/dashboard/page.tsx"),
  "utf8",
);

const THEME_MODULE_RELATIVE_PATH =
  "src/components/company-dashboard/dashboard-01-theme.module.css";
const themeModuleSource = readFileSync(
  join(process.cwd(), THEME_MODULE_RELATIVE_PATH),
  "utf8",
);

// Canonical PeopleFlow semantics live here and are the single source of truth
// for the dashboard palette; the dashboard module must inherit them.
const globalsSource = readFileSync(
  join(process.cwd(), "src/app/globals.css"),
  "utf8",
);
const appSidebarSource = readFileSync(
  join(process.cwd(), "src/components/company-dashboard/app-sidebar.tsx"),
  "utf8",
);
// The block-scoped sidebar primitive owns the mobile Sheet metadata; it is part
// of this block, not a shared global primitive.
const blockSidebarSource = readFileSync(
  join(process.cwd(), "src/components/company-dashboard/ui/sidebar.tsx"),
  "utf8",
);

// Dashboard-block components where the screenshot-era source specifies Tabler
// icon literals. Excluded on purpose:
//   - `ui/sidebar.tsx` and `ui/button.tsx` are the vendor primitives, outside
//     this correction's surface — and the screenshot-era sidebar primitive
//     itself uses Lucide's `PanelLeftIcon`.
//   - `site-header.tsx` has no icons (it carries no demo action any more).
const TABLER_BLOCK_FILES = [
  "app-sidebar.tsx",
  "nav-user.tsx",
  "section-cards.tsx",
  "data-table.tsx",
] as const;

// The stock document navigation was unreferenced dead code; PDC-02 removed it.
const REMOVED_DEAD_MODULES = ["nav-main.tsx", "nav-documents.tsx"] as const;

const blockSource = (file: string) =>
  readFileSync(join(process.cwd(), "src/components/company-dashboard", file), "utf8");

const chartSource = blockSource("chart-area-interactive.tsx");
const dataTableSource = blockSource("data-table.tsx");
const siteHeaderSource = blockSource("site-header.tsx");
const sectionCardsSource = blockSource("section-cards.tsx");
const packageJson = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"), "utf8"),
) as { dependencies: Record<string, string> };

// jsdom implements neither matchMedia nor ResizeObserver. The sidebar and the
// chart read the first (via useIsMobile) and recharts reads the second, so both
// browser APIs are stubbed to the desktop branch.
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("/empresa/dashboard renders the complete official dashboard-01 block", () => {
  beforeEach(stubBrowserApis);

  it("renders the PeopleFlow brand header and the recruiting call to action", () => {
    render(<EmployerDashboardPage />);

    expect(screen.queryByText("Acme Inc.")).toBeNull();
    expect(screen.getByRole("link", { name: "PeopleFlow" })).toHaveAttribute(
      "href",
      "/empresa/dashboard",
    );
    expect(
      screen.getByRole("button", { name: "Nueva vacante" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Quick Create")).toBeNull();
    expect(screen.queryByRole("button", { name: /inbox/i })).toBeNull();
  });

  it("renders the recruiting navigation in its two labeled groups", () => {
    render(<EmployerDashboardPage />);

    const labels = Array.from(
      document.querySelectorAll("[data-slot='sidebar-group-label']"),
    ).map((node) => node.textContent?.trim());
    expect(labels).toEqual(["Principal", "Organización"]);

    for (const label of [
      "Dashboard",
      "Vacantes",
      "Base de talento",
      "Equipo",
      "Sitio de empleo",
      "Configuración",
    ]) {
      expect(
        screen.getAllByText(label).length,
        `${label} nav entry`,
      ).toBeGreaterThan(0);
    }

    // Every sidebar destination is an implemented route.
    for (const [label, href] of [
      ["Dashboard", "/empresa/dashboard"],
      ["Vacantes", "/empresa/vacantes"],
      ["Base de talento", "/empresa/talento"],
      ["Equipo", "/empresa/equipo"],
      ["Sitio de empleo", "/empresa/sitio"],
      ["Configuración", "/empresa/configuracion"],
    ] as const) {
      expect(
        screen.getByRole("link", { name: label }),
        `${label} destination`,
      ).toHaveAttribute("href", href);
    }
    for (const label of ["Mensajes", "Reportes"]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
      expect(screen.queryByRole("link", { name: label })).toBeNull();
    }

    for (const stock of [
      "Lifecycle",
      "Analytics",
      "Projects",
      "Team",
      "Documents",
      "Data Library",
      "Word Assistant",
      "Settings",
      "Get Help",
    ]) {
      expect(screen.queryByText(stock), `${stock} stock entry`).toBeNull();
    }
  });

  it("renders the employer account in the sidebar footer", () => {
    render(<EmployerDashboardPage />);

    expect(screen.getByText("Tomás Ríos")).toBeInTheDocument();
    expect(screen.getByText("Talent Lead · Nexo Labs")).toBeInTheDocument();

    // The footer identity is an Avatar + DropdownMenuTrigger composition: the
    // trigger exposes the identity, and the avatar slot is present with its
    // required fallback (jsdom never loads the remote image, so the fallback is
    // what actually renders here).
    expect(document.querySelectorAll("[data-slot='avatar']").length).toBeGreaterThan(0);
    expect(screen.getByText("TR")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Tomás Ríos/ }),
    ).toBeInTheDocument();

    expect(screen.queryByText("Camila Núñez")).toBeNull();
    expect(screen.queryByText("shadcn")).toBeNull();
    expect(screen.queryByText("m@example.com")).toBeNull();
  });

  it("renders the block's header with its section heading", () => {
    render(<EmployerDashboardPage />);

    const header = document.querySelector("header");
    expect(header).not.toBeNull();
    expect(within(header!).getByRole("heading", { level: 1 })).toHaveTextContent(
      "Dashboard",
    );
    expect(
      within(header!).getByRole("button", { name: /toggle sidebar/i }),
    ).toBeInTheDocument();
  });

  it("renders the four recruiting KPI cards", () => {
    render(<EmployerDashboardPage />);

    const cards = document.querySelectorAll("[data-slot='card']");
    expect(cards.length).toBeGreaterThanOrEqual(5); // 4 section cards + chart card

    const kpiRegion = document.querySelector("[data-pf-kpi-cards]");
    expect(kpiRegion).not.toBeNull();

    for (const [label, value] of [
      ["Vacantes activas", "12"],
      ["Candidatos nuevos", "42"],
      ["En revisión", "28"],
      ["Contrataciones este mes", "3"],
    ] as const) {
      expect(within(kpiRegion as HTMLElement).getByText(label)).toBeInTheDocument();
      expect(within(kpiRegion as HTMLElement).getByText(value)).toBeInTheDocument();
    }

    expect(
      within(kpiRegion as HTMLElement).getByText("3 publicadas esta semana"),
    ).toBeInTheDocument();
    expect(
      within(kpiRegion as HTMLElement).getByText("Tasa de cierre del 11%"),
    ).toBeInTheDocument();
  });

  it("renders the application-source chart with its heading and range controls", () => {
    render(<EmployerDashboardPage />);

    expect(screen.getByText("Origen de las postulaciones")).toBeInTheDocument();
    expect(
      screen.getByText("Reparto de los últimos 3 meses"),
    ).toBeInTheDocument();

    // Desktop range control is the toggle group; the mobile control is the
    // select. Both are part of the official composition.
    for (const label of [
      "Últimos 3 meses",
      "Últimos 30 días",
      "Últimos 7 días",
    ]) {
      expect(
        screen.getAllByText(label).length,
        `${label} range option`,
      ).toBeGreaterThan(0);
    }
    expect(screen.getByLabelText("Seleccionar período")).toBeInTheDocument();
    expect(document.querySelector("[data-slot='chart']")).not.toBeNull();
  });

  it("renders the recent applicants surface inside the tabs composition", () => {
    render(<EmployerDashboardPage />);

    expect(
      screen.getByRole("heading", { name: "Candidatos recientes" }),
    ).toBeInTheDocument();

    for (const label of ["Todos", "Nuevos", "En revisión", "Contratados"]) {
      expect(
        screen.getByRole("tab", { name: new RegExp(label) }),
        `${label} tab`,
      ).toBeInTheDocument();
    }

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

    // The candidate name opens the read-only detail drawer; the trigger is a
    // Button, so it exposes the name through the button role.
    expect(
      screen.getByRole("button", { name: "Valentina Ríos" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Filas por página")).toBeInTheDocument();
    expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add section/i })).toBeNull();
  });

  it("uses the official block layout frame instead of a custom shell", () => {
    render(<EmployerDashboardPage />);

    const wrapper = document.querySelector("[data-slot='sidebar-wrapper']");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.getAttribute("style")).toContain("--sidebar-width");
    expect(wrapper!.getAttribute("style")).toContain("--header-height");

    expect(document.querySelector("[data-slot='sidebar']")).toHaveAttribute(
      "data-variant",
      "inset",
    );
    expect(document.querySelector("[data-slot='sidebar-inset']")).not.toBeNull();
  });

  it("keeps no trace of the rejected minimal adaptation", () => {
    // Source-level contract: the route must compose the generated block, not a
    // hand-written placeholder surface.
    expect(pageSource).not.toMatch(/data-pf-preview-regions|data-pf-employer-dashboard/);
    expect(pageSource).not.toMatch(/Prototipo visual, sin datos reales/);
    expect(pageSource).not.toContain(
      'from "@/components/company-dashboard/app-sidebar"',
    );
    expect(pageSource).toContain(
      'from "@/components/company-dashboard/section-cards"',
    );
    expect(pageSource).toContain(
      'from "@/components/company-dashboard/chart-area-interactive"',
    );
    expect(pageSource).toContain('from "@/components/company-dashboard/data-table"');
  });

  it("declares its own route metadata", () => {
    expect(metadata.title).toBe("Panel de empresa");
  });
});

// --- neutral theme surface ---------------------------------------------------

/**
 * Reads the declaration block that follows `marker` up to its closing brace.
 */
function declarationBlock(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  return source.slice(open, close);
}

/**
 * Splits a selector list on its top-level commas, ignoring commas nested in
 * functional pseudo-classes such as `:has(...)` or `:not(...)`.
 */
function splitSelectorList(prelude: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of prelude) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      selectors.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) selectors.push(current.trim());
  return selectors;
}

/**
 * Returns every rule prelude in a stylesheet. Text between a rule's `{` and its
 * matching `}` is discarded, so a prelude is whatever precedes a `{`.
 */
function rulePreludes(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const preludes: string[] = [];
  let buffer = "";
  for (const char of withoutComments) {
    if (char === "{") {
      const prelude = buffer.trim();
      if (prelude) preludes.push(prelude);
      buffer = "";
    } else if (char === "}") {
      buffer = "";
    } else {
      buffer += char;
    }
  }
  return preludes;
}

// The module may keep geometry and font-role declarations, but no color token.
// A dashboard-local palette — neutral or otherwise — would re-isolate the route
// from the canonical PeopleFlow semantics owned by globals.css.
const PALETTE_TOKENS = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--border",
  "--input",
  "--ring",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--sidebar",
  "--sidebar-foreground",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--sidebar-border",
  "--sidebar-ring",
  "--brand-decorative",
  "--brand-decorative-strong",
] as const;

const themeModuleDeclarations = themeModuleSource.replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/**
 * Returns every custom property the module actually declares. Splitting on
 * declaration separators keeps the check literal-free, so a commented value or
 * a token *reference* such as `var(--primary)` can never be mistaken for a
 * palette declaration.
 */
function declaredCustomProperties(source: string): Set<string> {
  const tokens = new Set<string>();
  for (const chunk of source.split(/[;{]/)) {
    const name = chunk.split(":")[0].trim();
    if (name.startsWith("--")) tokens.add(name);
  }
  return tokens;
}

/**
 * Returns the `chartConfig` object literal from a dashboard block, matched by
 * brace depth so nested entries do not truncate it.
 */
function chartConfigBlock(source: string): string {
  const start = source.indexOf("const chartConfig = {");
  expect(start, "chartConfig object literal").toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return "";
}

/**
 * Reads one series entry from a `chartConfig` literal, e.g.
 * `desktop: { label: "Desktop", color: "var(--primary)" }`.
 */
function configEntry(
  source: string,
  series: string,
): { label: string; color: string } | null {
  const block = chartConfigBlock(source);
  for (const match of block.matchAll(/([A-Za-z]+):\s*\{([^}]*)\}/g)) {
    if (match[1] !== series) continue;
    const label = match[2].match(/label:\s*"([^"]+)"/);
    const color = match[2].match(/color:\s*"([^"]+)"/);
    if (!label || !color) return null;
    return { label: label[1], color: color[1] };
  }
  return null;
}

/**
 * Reads the `--color-<series>` custom properties the mounted chart containers
 * emitted. `ChartContainer` renders a <style> element per chart, so this is the
 * rendered series mapping rather than the source text.
 */
function renderedSeriesColors(): Record<string, string> {
  const css = Array.from(document.querySelectorAll("style"))
    .map((node) => node.textContent ?? "")
    .join("\n");
  const colors: Record<string, string> = {};
  for (const match of css.matchAll(/--color-([a-z-]+):\s*([^;]+);/g)) {
    colors[match[1]] = match[2].trim();
  }
  return colors;
}

describe("dashboard-01 canonical PeopleFlow semantic inheritance", () => {
  it("carries the scoped class on the rendered composition root", () => {
    stubBrowserApis();
    render(<EmployerDashboardPage />);

    const wrapper = document.querySelector("[data-slot='sidebar-wrapper']");
    expect(wrapper).not.toBeNull();

    // Wiring check: the class must reach the provider element, not just exist in
    // the module. Vitest (and Next.js) emit stable CSS-module names that embed
    // the original key, so the class token must contain "root".
    expect(wrapper!.className).toMatch(/(^|\s)\S*root\S*(\s|$)/);
    cleanup();
  });

  it("uses only CSS-Modules-pure selectors", () => {
    // Next compiles this file with CSS Modules `mode: 'pure'`, which rejects any
    // selector that carries no local class. Every selector in every rule must
    // therefore include the local `.root`, including the body/portal
    // route-presence selectors.
    const slices = rulePreludes(themeModuleSource)
      .filter((prelude) => !prelude.startsWith("@"))
      .flatMap(splitSelectorList);

    expect(slices.length).toBeGreaterThan(5);
    // CSS Modules `mode: 'pure'` fails any selector carrying no local class.
    for (const selector of slices) {
      expect(selector, `selector without a local class: ${selector}`).toMatch(
        /\.root/,
      );
    }

    // The body/portal selectors in particular must reach the local class rather
    // than a global attribute marker.
    const bodySelectors = slices.filter((selector) => selector.includes("body"));
    expect(bodySelectors.length).toBeGreaterThan(0);
    for (const selector of bodySelectors) {
      expect(selector, `impure body selector: ${selector}`).toContain(".root");
    }

    // The portal coverage must be expressed through the local class, not a
    // global attribute marker.
    expect(themeModuleSource).toContain(":global(body):has(.root)");
    expect(themeModuleSource).not.toContain("body:has([data-slot");
  });

  it("declares no semantic palette in the dashboard module", () => {
    // Canonical PeopleFlow semantics come from globals.css. A local palette —
    // in either scheme — would shadow them for the dashboard subtree and for
    // the body-level portals.
    for (const token of PALETTE_TOKENS) {
      expect(
        declaredCustomProperties(themeModuleDeclarations).has(token),
        `${token} must not be redeclared in the dashboard module`,
      ).toBe(false);
    }
  });

  it("declares no raw color values", () => {
    // Geometry and font roles only: the module introduces no literal color, so
    // it cannot drift from the canonical tokens.
    expect(themeModuleDeclarations).not.toMatch(
      /oklch\(|#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\s*\(/,
    );
  });

  it("declares no dark palette gate", () => {
    // Both dark gates existed only to restate the neutral palette; the canonical
    // dark semantics now reach the dashboard through globals.css.
    expect(themeModuleDeclarations).not.toContain(":global(.dark)");
    expect(themeModuleDeclarations).not.toContain(":root:not([data-theme])");
    expect(themeModuleDeclarations).not.toContain(
      "@media (prefers-color-scheme: dark)",
    );
  });

  it("keeps the module root alive for route presence and portal scoping", () => {
    const rootBlock = declarationBlock(themeModuleSource, ".root");

    expect(rootBlock).not.toBe("");
    // The route contract still needs the root class and its scoped geometry
    // tokens even though the palette moved out.
    expect(rootBlock).toContain("--radius: 0.625rem");
    expect(themeModuleSource).toContain(":global(body):has(.root)");
    expect(themeModuleSource).not.toContain("body:has([data-slot");
  });

  it("keeps the scoped heading role on the approved sans family", () => {
    const rootBlock = declarationBlock(themeModuleSource, ".root");

    expect(rootBlock).toContain("--font-heading: var(--font-sans)");
    // Tailwind inlines the project value into the utility, so the alias alone
    // cannot reach the generated CardTitle; the scoped override must exist.
    expect(themeModuleSource).toMatch(
      /\.root :global\(\.font-heading\)\s*\{\s*font-family: var\(--font-sans\);\s*\}/,
    );
  });

  it("keeps canonical PeopleFlow light and dark semantics in globals.css", () => {
    // The dashboard inherits these values; the module must never restate them.
    for (const declaration of [
      "--background: #F7F5FB",
      "--foreground: #1A1626",
      "--card: #FFFFFF",
      "--border: #E4DFF0",
      "--primary: oklch(0.491 0.27 292.581)",
      "--brand-decorative-strong: oklch(0.54 0.15 292.581)",
      "--background: #0C0912",
      "--foreground: #F6F2FF",
      "--card: #15121F",
      "--border: #262233",
      "--primary: oklch(0.432 0.232 292.759)",
      "--brand-decorative-strong: oklch(0.70 0.14 292.759)",
    ]) {
      expect(globalsSource, `${declaration} in globals.css`).toContain(
        declaration,
      );
    }
  });
});

// --- chart series differentiation --------------------------------------------

describe("dashboard-01 chart series differentiation", () => {
  beforeEach(stubBrowserApis);

  it("maps Directas to violet and Referidas to the decorative lavender", () => {
    const directas = configEntry(chartSource, "directas");
    const referidas = configEntry(chartSource, "referidas");

    expect(directas, "chart-area-interactive.tsx directas entry").not.toBeNull();
    expect(referidas, "chart-area-interactive.tsx referidas entry").not.toBeNull();
    expect(directas!.label).toBe("Directas");
    expect(referidas!.label).toBe("Referidas");
    expect(directas!.color).toBe("var(--primary)");
    expect(referidas!.color).toBe("var(--brand-decorative-strong)");

    for (const entry of [directas!, referidas!]) {
      expect(entry.color, `${entry.label} token`).toMatch(/^var\(--[a-z-]+\)$/);
    }

    // The document demo chart left with the document table: the recent-applicant
    // surface carries no second chart config of its own.
    expect(dataTableSource).not.toContain("chartConfig");
    expect(dataTableSource).not.toContain("recharts");
  });

  it("renders distinguishable series colors in the mounted chart", () => {
    render(<EmployerDashboardPage />);

    const colors = renderedSeriesColors();
    expect(colors.directas).toBe("var(--primary)");
    expect(colors.referidas).toBe("var(--brand-decorative-strong)");
    expect(colors.directas).not.toBe(colors.referidas);
  });
});

// --- account avatar identity -------------------------------------------------

describe("dashboard-01 account avatar identity", () => {
  beforeEach(stubBrowserApis);

  it("removes the stock avatar from the sidebar account data source", () => {
    // The blocked account identity is initials-only: the field and the asset
    // path are both gone, not merely unrendered.
    expect(appSidebarSource).not.toContain("/avatars");
    expect(appSidebarSource).not.toMatch(/\bavatar\b/i);
  });

  it("removes the avatar image plumbing from the account menu", () => {
    const navUserSource = blockSource("nav-user.tsx");

    expect(navUserSource).not.toContain("AvatarImage");
    expect(navUserSource).not.toContain("user.avatar");
    expect(navUserSource).not.toContain("/avatars");
  });

  it("renders no avatar image anywhere on the route", () => {
    render(<EmployerDashboardPage />);

    expect(document.querySelectorAll("[data-slot='avatar-image']")).toHaveLength(0);
    expect(document.querySelectorAll("img[src*='avatars']")).toHaveLength(0);
  });

  it("renders the initials fallback on semantic tokens only", () => {
    render(<EmployerDashboardPage />);

    const fallbacks = Array.from(
      document.querySelectorAll("[data-slot='avatar-fallback']"),
    );
    expect(fallbacks.length).toBeGreaterThan(0);

    for (const fallback of fallbacks) {
      expect(fallback.textContent?.trim()).toBe("TR");
      expect(fallback.className).toContain("bg-primary");
      expect(fallback.className).toContain("text-primary-foreground");
      expect(fallback.className).not.toMatch(/oklch\(|#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    }

    // The photo-only desaturation filter left with the image, so the semantic
    // fallback renders at full strength inside the same 32px box.
    const avatar = document.querySelector("[data-slot='avatar']");
    expect(avatar).not.toBeNull();
    expect(avatar!.className).toContain("size-8");
    expect(avatar!.className).not.toContain("grayscale");
  });
});

// --- screenshot-era fidelity -------------------------------------------------

// Exact desktop x-axis labels the reference renders, in order. The screenshot-era
// source relies on the auto tick algorithm, whose output is width-dependent; the
// block pins the reference set so the settled desktop render is deterministic.
const REFERENCE_TICKS: readonly string[] = [
  "2024-04-03",
  "2024-04-09",
  "2024-04-15",
  "2024-04-21",
  "2024-04-27",
  "2024-05-03",
  "2024-05-09",
  "2024-05-15",
  "2024-05-21",
  "2024-05-28",
  "2024-06-03",
  "2024-06-09",
  "2024-06-15",
  "2024-06-21",
  "2024-06-29",
];

describe("dashboard-01 header demo action", () => {
  beforeEach(stubBrowserApis);

  it("renders no demo action in the header", () => {
    render(<EmployerDashboardPage />);

    const header = document.querySelector("header")!;
    expect(within(header).queryByText(/github/i)).toBeNull();
    expect(within(header).queryAllByRole("link")).toHaveLength(0);
  });

  it("declares no GitHub action markup", () => {
    expect(siteHeaderSource).not.toMatch(/github/i);
    expect(siteHeaderSource).not.toContain("nativeButton");
  });

  it("does not warn about lost native button semantics", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      render(<EmployerDashboardPage />);

      const messages = [...consoleError.mock.calls, ...consoleWarn.mock.calls]
        .flat()
        .join(" ");

      // Base UI warns on mount when `nativeButton` disagrees with the rendered
      // element; the header action must be declared as an anchor instead.
      expect(messages).not.toMatch(/nativeButton|native <button>/);
    } finally {
      consoleError.mockRestore();
      consoleWarn.mockRestore();
    }
  });

  it("keeps no anchor action in the header", () => {
    render(<EmployerDashboardPage />);

    const header = document.querySelector("header")!;

    // The demo anchor is gone; nothing replaced it with another link.
    expect(within(header).queryAllByRole("link")).toHaveLength(0);
    expect(header.querySelectorAll("a")).toHaveLength(0);
  });
});

// --- header theme control ----------------------------------------------------

const THEME_TOGGLE_RELATIVE_PATH = "src/components/theme/theme-toggle.tsx";

describe("dashboard-01 header theme control", () => {
  beforeEach(stubBrowserApis);

  afterEach(() => {
    // The control mutates document-level state (html attributes and the
    // persisted choice); undo it so later tests start from the same baseline.
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.classList.remove("dark");
    for (const node of document.querySelectorAll("[data-pf-theme-suppression]")) {
      node.remove();
    }
  });

  it("mounts exactly one theme control inside the header", () => {
    render(<EmployerDashboardPage />);

    const controls = document.querySelectorAll("[data-pf-theme-toggle]");
    expect(controls.length).toBe(1);

    const header = document.querySelector("header");
    expect(header).not.toBeNull();
    expect(header!.contains(controls[0])).toBe(true);
  });

  it("exposes the canonical accessible name", () => {
    render(<EmployerDashboardPage />);

    const header = document.querySelector("header")!;
    const toggle = within(header).getByRole("button", { name: "Cambiar tema" });

    expect(toggle).toHaveAttribute("data-pf-theme-toggle");
  });

  it("keeps the top-right control group position", () => {
    render(<EmployerDashboardPage />);

    const toggle = screen.getByRole("button", { name: "Cambiar tema" });
    const group = toggle.parentElement;

    expect(group).not.toBeNull();
    // The theme control keeps the approved top-right control group placement.
    expect(group!.className).toContain("ml-auto");
    expect(group!.className).toContain("items-center");
    expect(group!.children).toHaveLength(1);
  });

  it("keeps the 40px control target without redeclaring the header height or padding", () => {
    render(<EmployerDashboardPage />);

    const toggle = screen.getByRole("button", { name: "Cambiar tema" });

    // The shared theme control owns the global 40px target while the fixed
    // route header keeps its established height and padding.
    expect(toggle.className).toMatch(/(^|\s)size-10(\s|$)/);
    expect(toggle.className).not.toMatch(/(^|\s)size-8(\s|$)/);

    const header = document.querySelector("header")!;
    const container = header.firstElementChild as HTMLElement;

    // Header height and inner padding stay declared exactly as approved.
    expect(header.className).toContain("h-(--header-height)");
    expect(container.className).toContain("px-4");
    expect(container.className).toContain("lg:px-6");
  });

  it("stays available on mobile, where the demo action used to be hidden", () => {
    vi.stubGlobal("innerWidth", 375);
    render(<EmployerDashboardPage />);

    const toggle = screen.getByRole("button", { name: "Cambiar tema" });

    // The demo action is gone; the theme control must not inherit any
    // responsive visibility gate of its own.
    expect(within(document.querySelector("header")!).queryByText(/github/i)).toBeNull();
    expect(toggle.className).not.toMatch(/(^|\s)hidden(\s|$)/);
    expect(toggle.className).not.toContain("sm:hidden");
  });

  it("reuses the canonical PeopleFlow ThemeToggle", () => {
    expect(siteHeaderSource).toContain(
      'import { ThemeToggle } from "@/components/theme/theme-toggle"',
    );
    expect(siteHeaderSource).toContain("<ThemeToggle />");
    expect(
      existsSync(join(process.cwd(), THEME_TOGGLE_RELATIVE_PATH)),
      `${THEME_TOGGLE_RELATIVE_PATH} must exist`,
    ).toBe(true);
  });

  it("declares no theme state, storage or bootstrap of its own", () => {
    for (const forbidden of [
      "localStorage",
      "pf-theme",
      "data-theme",
      "matchMedia",
      "THEME_STORAGE_KEY",
      "THEME_BOOTSTRAP_SCRIPT",
      "useState",
      "useEffect",
      "createContext",
      "use client",
    ]) {
      expect(
        siteHeaderSource,
        `site-header.tsx must not declare ${forbidden}`,
      ).not.toContain(forbidden);
    }
  });

  it("drives the existing theme mechanism on click", async () => {
    const user = userEvent.setup();
    render(<EmployerDashboardPage />);

    await user.click(screen.getByRole("button", { name: "Cambiar tema" }));

    // The contract the ThemeToggle unit suite already establishes: from the
    // system default (this stub resolves light) the first click persists an
    // explicit dark choice and applies it to <html>. Asserting it here proves
    // the real control is wired, not a look-alike rendered for the tests.
    expect(localStorage.getItem("pf-theme")).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement).toHaveClass("dark");
  });
});

describe("dashboard-01 screenshot-era column control", () => {
  beforeEach(stubBrowserApis);

  it("shows Personalizar columnas at desktop and Columnas below it", () => {
    render(<EmployerDashboardPage />);

    // Both spans are mounted; the responsive classes decide which one is
    // visible, so desktop 1460 shows the long label.
    const long = screen.getByText("Personalizar columnas");
    const short = screen.getByText("Columnas");

    expect(long.className).toContain("hidden");
    expect(long.className).toContain("lg:inline");
    expect(short.className).toContain("lg:hidden");

    const trigger = screen.getByRole("button", {
      name: /personalizar columnas/i,
    });
    expect(trigger).toBeInTheDocument();
  });

  it("keeps the control bound to the responsive label markup", () => {
    expect(dataTableSource).toContain('hidden lg:inline">Personalizar columnas');
    expect(dataTableSource).toContain('lg:hidden">Columnas');
  });
});

// --- dead document navigation removal ---------------------------------------

describe("dashboard-01 dead document navigation", () => {
  it("deletes the unreferenced stock navigation modules", () => {
    for (const file of REMOVED_DEAD_MODULES) {
      expect(
        existsSync(join(process.cwd(), "src/components/company-dashboard", file)),
        `${file} must be deleted`,
      ).toBe(false);
    }
  });

  it("keeps no import of the deleted modules anywhere in the sources", () => {
    for (const entry of readdirSync(join(process.cwd(), "src"), {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      // Test files legitimately name the removed modules when asserting they are
      // gone; only the product sources must be free of them.
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      const contents = readFileSync(join(entry.parentPath, entry.name), "utf8");
      expect(
        contents,
        `${entry.name} must not import a deleted module`,
      ).not.toMatch(/nav-main|nav-documents|Quick Create/);
    }
  });
});

describe("dashboard-01 screenshot-era icons", () => {
  beforeEach(stubBrowserApis);

  it("uses the official Tabler icons across the dashboard block", () => {
    for (const file of TABLER_BLOCK_FILES) {
      const source = blockSource(file);

      expect(source, `${file} must use @tabler/icons-react`).toContain(
        '"@tabler/icons-react"',
      );
      expect(source, `${file} must not use lucide-react`).not.toContain(
        'from "lucide-react"',
      );
    }
  });

  it("replaces the stock brand glyph with the PeopleFlow wordmark", () => {
    render(<EmployerDashboardPage />);

    expect(appSidebarSource).not.toContain("IconInnerShadowTop");
    expect(appSidebarSource).toContain("PeopleFlowLogo");

    const brand = screen.getByRole("link", { name: "PeopleFlow" });
    expect(brand.querySelectorAll("img")).toHaveLength(2);

    // Tabler icons still render elsewhere in the block, which proves the real
    // library is mounted rather than a Lucide stand-in.
    expect(document.querySelector("svg.tabler-icon")).not.toBeNull();
    expect(document.querySelector("svg.tabler-icon-inner-shadow-top")).toBeNull();
  });

  it("adds exactly the Tabler icon dependency", () => {
    expect(packageJson.dependencies["@tabler/icons-react"]).toBeDefined();
  });
});

describe("dashboard-01 screenshot-era chart axis", () => {
  beforeEach(stubBrowserApis);

  it("pins the reference desktop tick set, in order", () => {
    let cursor = -1;
    for (const iso of REFERENCE_TICKS) {
      const index = chartSource.indexOf(`"${iso}"`, cursor + 1);
      expect(index, `${iso} must appear after the previous tick`).toBeGreaterThan(
        cursor,
      );
      cursor = index;
    }

    expect(chartSource).toMatch(/ticks=\{/);
  });

  it("passes the pinned reference tick set to the x-axis", () => {
    // The dashboard block must bind the axis to the pinned set; the browser
    // verifier owns the settled pixel check because jsdom never mounts the
    // recharts surface (ResponsiveContainer cannot measure without a layout).
    expect(chartSource).toMatch(/<XAxis[\s\S]*?ticks=\{DESKTOP_TICKS\}/);
  });

  it("joins the range control into a single segmented control", () => {
    render(<EmployerDashboardPage />);

    const group = document.querySelector("[data-slot='toggle-group']");
    expect(group).not.toBeNull();
    expect(group).toHaveAttribute("data-variant", "outline");
    // Spacing 0 is what removes the gaps between the range items.
    expect(group).toHaveAttribute("data-spacing", "0");
  });
});

describe("dashboard-01 screenshot-era geometry and portal theming", () => {
  it("carries the canonical theme to portal-rendered content", async () => {
    // Portals escape the provider subtree, so the module must also scope the
    // route presence on <body>, where the canonical tokens resolve. The selector
    // reaches the local module class inside `:has(...)` so Next's CSS Modules
    // `mode: 'pure'` accepts it.
    expect(themeModuleSource).toContain(":global(body):has(.root)");

    stubBrowserApis();
    vi.stubGlobal("innerWidth", 375);
    const user = userEvent.setup();
    render(<EmployerDashboardPage />);

    await user.click(
      screen.getByRole("button", { name: /toggle sidebar/i }),
    );

    const drawer = await screen.findByRole("dialog");
    const wrapper = document.querySelector("[data-slot='sidebar-wrapper']")!;

    // The escape is real, which is exactly why the body-scoped rule is needed.
    expect(wrapper.contains(drawer)).toBe(false);
    expect(document.body.contains(drawer)).toBe(true);
    cleanup();
  });

  it("applies the measured reference card and button geometry", () => {
    expect(themeModuleSource).toMatch(
      /:global\(\[data-slot=['"]card['"]\]\)[^{]*\{[^}]*border-radius: var\(--radius-xl\)/,
    );
    expect(themeModuleSource).toMatch(
      /:global\(\[data-slot=['"]button['"]\]\)[^{]*\{[^}]*border-radius: var\(--radius-md\)/,
    );
    // The over-wide global card spacing is gone: the two measured card surfaces
    // now carry their own values instead of one shared 6-step value.
    expect(themeModuleSource).not.toContain(
      "--card-spacing: calc(var(--spacing) * 6)",
    );
  });
});

// --- chart axis determinism --------------------------------------------------

describe("dashboard-01 chart axis determinism", () => {
  it("formats every tick label in UTC so no label shifts a day", () => {
    // The data dates are UTC-midnight ISO days. On this host (America/Mexico_City,
    // UTC-6) formatting them in local time renders 2024-04-03 as "Apr 2".
    const expected = REFERENCE_TICKS.map((iso) =>
      new Date(`${iso}T00:00:00Z`).toLocaleDateString("es", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }),
    );

    expect(formatTickLabel("2024-04-03")).toBe("3 abr");
    expect(formatTickLabel("2024-04-03")).not.toBe("2 abr");

    for (const [index, iso] of REFERENCE_TICKS.entries()) {
      expect(formatTickLabel(iso), `${iso} tick label`).toBe(expected[index]);
    }
  });

  it("pins the tick formatter to an explicit UTC time zone", () => {
    // Value assertions alone would pass on a UTC host; the implementation must be
    // time-zone explicit so it cannot regress per environment.
    expect(chartSource).toMatch(/timeZone:\s*"UTC"/);
  });

  it("forces every provided desktop tick to render", () => {
    // `interval={0}` disables the automatic overlap filter, so all 15 pinned
    // ticks render and `minTickGap` cannot prune them.
    expect(chartSource).toMatch(/<XAxis[\s\S]*?interval=\{0\}/);
  });
});

// --- measured vertical geometry ----------------------------------------------

describe("dashboard-01 measured vertical geometry", () => {
  beforeEach(stubBrowserApis);

  it("marks the measured surfaces with semantic data attributes", () => {
    render(<EmployerDashboardPage />);

    const kpi = document.querySelector("[data-pf-kpi-cards]");
    const chart = document.querySelector("[data-pf-chart-card]");
    const table = document.querySelector("[data-pf-data-table]");

    expect(kpi).not.toBeNull();
    expect(chart).not.toBeNull();
    expect(table).not.toBeNull();

    // The markers must sit on the intended elements, not on incidental wrappers.
    expect(kpi).toHaveAttribute("data-pf-kpi-cards", "");
    expect(kpi!.querySelectorAll("[data-slot='card']").length).toBe(4);
    expect(chart).toHaveAttribute("data-pf-chart-card", "");
    expect(chart).toHaveAttribute("data-slot", "card");
    expect(table).toHaveAttribute("data-slot", "tabs");

    expect(sectionCardsSource).toContain('data-pf-kpi-cards=""');
    expect(chartSource).toContain('data-pf-chart-card=""');
    expect(dataTableSource).toContain('data-pf-data-table=""');
  });

  it("scopes the measured spacing per surface", () => {
    // KPI cards: 4.6 steps (~18.4px) to remove the ~16-17px of over-height.
    expect(
      declarationBlock(themeModuleSource, '[data-pf-kpi-cards] [data-slot="card"]'),
    ).toContain("--card-spacing: calc(var(--spacing) * 4.6)");

    // SectionCards wrapper: +3px top, +2px bottom, so the KPI top and the
    // following chart top land together.
    const wrapper = declarationBlock(themeModuleSource, "[data-pf-kpi-cards]");
    expect(wrapper).toContain("padding-top: 3px");
    expect(wrapper).toContain("padding-bottom: 2px");

    // Chart card: 5.5 steps (22px).
    expect(declarationBlock(themeModuleSource, "[data-pf-chart-card]")).toContain(
      "--card-spacing: calc(var(--spacing) * 5.5)",
    );

    // Data-table tabs: gap 24px -> 30px so the table top lands near 767px.
    expect(declarationBlock(themeModuleSource, "[data-pf-data-table]")).toContain(
      "gap: 30px",
    );
  });

  it("fills the measured gap without brittle descendant ordinals", () => {
    for (const marker of [
      "data-pf-kpi-cards",
      "data-pf-chart-card",
      "data-pf-data-table",
    ]) {
      expect(themeModuleSource).toContain(`[${marker}]`);
    }
    // No nth-child/nth-of-type positioning in the scoped geometry rules.
    expect(themeModuleSource).not.toMatch(/nth-(child|of-type|last-child)/);
  });
});

// --- measured KPI internals and range control --------------------------------

describe("dashboard-01 measured KPI internals", () => {
  it("decouples the KPI card's internal vertical axes", () => {
    const card = declarationBlock(
      themeModuleSource,
      '[data-pf-kpi-cards] [data-slot="card"]',
    );

    // The base spacing marker stays in place.
    expect(card).toContain("--card-spacing: calc(var(--spacing) * 4.6)");

    // +8px top padding, and a 3.4px bottom padding that offsets the +15px of
    // internal additions (8 top + 2 header gap + 4 flex gap + 1 footer gap) so
    // the card's outer height is unchanged.
    expect(card).toContain("padding-top: 26.4px");
    expect(card).toContain("padding-bottom: 3.4px");

    // Card-to-footer flex gap: 18.4px -> 22.4px.
    expect(card).toMatch(/(?:^|[;\s{])gap:\s*22\.4px/);

    // Root cause of the collapse: the fourth card's wrap used to set the grid row
    // height. With the line pinned to nowrap the cards shrink, so the measured
    // row height is stabilised explicitly instead of relying on content.
    expect(card).toContain("min-height: 183.17px");
  });

  it("preserves every measured internal value while stabilising the row height", () => {
    const card = declarationBlock(
      themeModuleSource,
      '[data-pf-kpi-cards] [data-slot="card"]',
    );
    const header = declarationBlock(
      themeModuleSource,
      '[data-pf-kpi-cards] [data-slot="card-header"]',
    );
    const footer = declarationBlock(
      themeModuleSource,
      '[data-pf-kpi-cards] [data-slot="card-footer"]',
    );
    const wrapper = declarationBlock(themeModuleSource, "[data-pf-kpi-cards]");
    const growth = declarationBlock(themeModuleSource, "[data-pf-growth-footer]");
    const table = declarationBlock(themeModuleSource, "[data-pf-data-table]");

    expect(card).toContain("--card-spacing: calc(var(--spacing) * 4.6)");
    expect(card).toContain("padding-top: 26.4px");
    expect(card).toContain("padding-bottom: 3.4px");
    expect(card).toContain("gap: 22.4px");
    expect(header).toContain("padding-left: 24px");
    expect(header).toContain("row-gap: 8px");
    expect(footer).toContain("padding-left: 24px");
    expect(footer).toContain("row-gap: 7px");
    expect(wrapper).toContain("padding-top: 3px");
    expect(wrapper).toContain("padding-bottom: 2px");
    expect(growth).toContain("white-space: nowrap");
    expect(growth).toContain("letter-spacing: -0.45px");
    expect(table).toContain("gap: 30px");
  });

  it("sets the KPI inner horizontal padding to 24px without moving the badge", () => {
    const header = declarationBlock(
      themeModuleSource,
      '[data-pf-kpi-cards] [data-slot="card-header"]',
    );

    // Left padding 18.4px -> 24px (moves the description and title right by ~6px).
    expect(header).toContain("padding-left: 24px");
    // Header row gap 6px -> 8px moves the title only.
    expect(header).toContain("row-gap: 8px");
    // Right padding must stay untouched, or the right-aligned badge would move.
    expect(header).not.toMatch(/padding-right/);
    expect(header).not.toMatch(/(?:^|[;\s{])padding\s*:/);
  });

  it("sets the KPI footer padding and internal gap", () => {
    const footer = declarationBlock(
      themeModuleSource,
      '[data-pf-kpi-cards] [data-slot="card-footer"]',
    );

    expect(footer).toContain("padding-left: 24px");
    // Footer internal gap 6px -> 7px moves the secondary line only.
    expect(footer).toContain("row-gap: 7px");
  });

  it("keeps the KPI wrapper offsets that anchor the outer geometry", () => {
    const wrapper = declarationBlock(themeModuleSource, "[data-pf-kpi-cards]");

    expect(wrapper).toContain("padding-top: 3px");
    expect(wrapper).toContain("padding-bottom: 2px");
  });
});

describe("dashboard-01 measured range control", () => {
  it("uses 13px per side on the range items", () => {
    expect(chartSource).toContain(
      "*:data-[slot=toggle-group-item]:px-[13px]!",
    );
    expect(chartSource).not.toContain("toggle-group-item]:px-4!");
  });

  it("moves only the chart header's right padding", () => {
    const header = declarationBlock(
      themeModuleSource,
      '[data-pf-chart-card] [data-slot="card-header"]',
    );

    // Effective right padding 25px: the chart card moved right by 3px, so the
    // header padding drops from 28px to keep the control's right edge at ~1400.
    expect(header).toContain("padding-right: 25px");
    // The chart header's left padding and text must not move.
    expect(header).not.toMatch(/padding-left/);
    expect(header).not.toMatch(/(?:^|[;\s{])padding\s*:/);
  });
});

// --- residual raster fidelity ------------------------------------------------

describe("dashboard-01 residual raster fidelity", () => {
  beforeEach(stubBrowserApis);

  it("marks only the growth card's primary footer line", () => {
    const markerOccurrences = sectionCardsSource.match(
      /data-pf-growth-footer/g,
    );
    expect(markerOccurrences?.length).toBe(1);

    // The marker must sit on the primary footer line of the fourth card: the
    // element it belongs to carries that line's text and icon, and not the
    // secondary line that must stay a sibling.
    const markerIndex = sectionCardsSource.indexOf("data-pf-growth-footer");
    const openIndex = sectionCardsSource.lastIndexOf("<div", markerIndex);
    const closeIndex = sectionCardsSource.indexOf("</div>", markerIndex);
    const growthLine = sectionCardsSource.slice(openIndex, closeIndex);

    expect(growthLine).toContain("line-clamp-1 flex gap-2 font-medium");
    // The marked line renders the bound KPI trend line, never the context line.
    expect(growthLine).toContain("kpi.trendLine");
    expect(growthLine).toContain('<IconTrendingUp className="size-4" />');
    expect(growthLine).not.toContain("kpi.context");
  });

  it("renders exactly one growth footer marker with the right content", () => {
    render(<EmployerDashboardPage />);

    const marked = document.querySelectorAll("[data-pf-growth-footer]");
    expect(marked.length).toBe(1);
    expect(marked[0]).toHaveTextContent("Sumando incorporaciones");
    expect(marked[0]).not.toHaveTextContent("Tasa de cierre del 11%");

    // The other three cards keep an unmarked primary line.
    const primaryLines = document.querySelectorAll(
      "[data-pf-kpi-cards] [data-slot='card-footer'] > div:first-child",
    );
    expect(primaryLines.length).toBe(4);
    expect(
      document.querySelectorAll(
        "[data-pf-kpi-cards] [data-slot='card-footer'] > div:first-child[data-pf-growth-footer]",
      ).length,
    ).toBe(1);
  });

  it("shrinks the growth line with nowrap and tracking only", () => {
    const rule = declarationBlock(themeModuleSource, "[data-pf-growth-footer]");

    expect(rule).toContain("white-space: nowrap");
    expect(rule).toContain("letter-spacing: -0.45px");
    // Typography must stay untouched: 14px size, weight, line height and the
    // icon/gap come from the shared utilities.
    expect(rule).not.toMatch(/font-size|font-weight|line-height|gap:|display:/);
  });

  it("insets the chart card on the right only, without touching vertical geometry", () => {
    const rule = declarationBlock(themeModuleSource, "[data-pf-chart-card]");

    // The left inset was removed: the settled left edge is already at ~312, so
    // only the right margin remains to trim the stretched width.
    expect(rule).not.toContain("margin-left");
    expect(rule).toContain("margin-right: 3px");
    // The chart card spacing must survive unchanged.
    expect(rule).toContain("--card-spacing: calc(var(--spacing) * 5.5)");
    expect(rule).not.toMatch(
      /margin-top|margin-bottom|padding-top|padding-bottom|height|padding-right|padding-left/,
    );
  });
});

// --- mobile geometry contracts ------------------------------------------------

describe("dashboard-01 mobile sidebar metadata", () => {
  beforeEach(stubBrowserApis);

  it("describes the mobile navigation in Spanish", async () => {
    vi.stubGlobal("innerWidth", 375);
    const user = userEvent.setup();
    render(<EmployerDashboardPage />);

    await user.click(screen.getByRole("button", { name: /toggle sidebar/i }));

    const drawer = await screen.findByRole("dialog");
    // The sr-only Sheet header is the drawer's accessible metadata; it must not
    // ship the stock English copy.
    expect(drawer).toHaveAccessibleName("Navegación");
    expect(within(drawer).getByText("Navegación")).toBeInTheDocument();
    expect(
      within(drawer).getByText("Muestra la navegación móvil."),
    ).toBeInTheDocument();
    expect(within(drawer).queryByText("Sidebar")).toBeNull();
    expect(
      within(drawer).queryByText("Displays the mobile sidebar."),
    ).toBeNull();
    cleanup();
  });

  it("localizes only the sheet metadata in the block-scoped sidebar primitive", () => {
    expect(blockSidebarSource).toContain("<SheetTitle>Navegación</SheetTitle>");
    expect(blockSidebarSource).toContain(
      "<SheetDescription>Muestra la navegación móvil.</SheetDescription>",
    );
    expect(blockSidebarSource).not.toContain("Displays the mobile sidebar.");
    // Everything else in the primitive keeps its stock behavior and copy: the
    // mobile trigger is not part of this correction.
    expect(blockSidebarSource).toContain("Toggle Sidebar");
    expect(blockSidebarSource).toContain('data-slot="sidebar"');
  });
});

describe("dashboard-01 mobile chart and range geometry contracts", () => {
  beforeEach(stubBrowserApis);

  it("keeps the concise mobile chart title next to the full desktop one", () => {
    render(<EmployerDashboardPage />);

    // Both titles live in the single card title slot; the 540px card
    // breakpoint decides which one is visible.
    const full = screen.getByText("Origen de las postulaciones");
    const short = screen.getByText("Postulaciones");

    expect(full.className).toContain("@[540px]/card:inline");
    expect(short.className).toContain("@[540px]/card:hidden");

    const title = document.querySelector(
      "[data-pf-chart-card] [data-slot='card-title']",
    );
    expect(title).not.toBeNull();
    expect(title!.contains(full)).toBe(true);
    expect(title!.contains(short)).toBe(true);
  });

  it("uses the 352px Tailwind width and equal-flex items for the range control", () => {
    render(<EmployerDashboardPage />);

    const group = document.querySelector("[data-slot='toggle-group']");
    expect(group).not.toBeNull();
    expect(group!.className).toContain("w-88");
    expect(group!.className).toContain("*:data-[slot=toggle-group-item]:flex-1");

    const items = Array.from(
      document.querySelectorAll("[data-slot='toggle-group-item']"),
    );
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.className).toContain("h-8");
    }
  });
});

// --- single outer padding owner ----------------------------------------------

// The spacing normalization agreement: one outer padding owner per dashboard
// route, 16px mobile / 24px desktop vertically and the existing `lg`+ 24px
// horizontal inset. The employer dashboard used to fragment that inset across
// SectionCards, the chart, ActiveVacancies and DataTable.
describe("dashboard-01 single outer padding owner", () => {
  beforeEach(stubBrowserApis);

  it("owns the route inset on exactly one page-content element", () => {
    const { container } = render(<EmployerDashboardPage />);

    const content = container.querySelector(
      "[data-pf-page-content]",
    ) as HTMLElement;
    expect(content).not.toBeNull();
    const tokens = content.className.split(/\s+/u);
    for (const token of ["px-4", "py-4", "md:py-6", "lg:px-6"]) {
      expect(tokens, token).toContain(token);
    }

    // The employer canvas binds to the candidate canonical measure explicitly.
    for (const token of ["mx-auto", "w-full", "max-w-screen-2xl"]) {
      expect(tokens, token).toContain(token);
    }
    expect(tokens.filter((token) => token.startsWith("max-w-"))).toEqual([
      "max-w-screen-2xl",
    ]);

    // No descendant re-adds both page insets, so the route cannot double pad.
    const owners = Array.from(content.querySelectorAll("[class]")).filter(
      (node) => {
        const value = (node.getAttribute("class") ?? "").split(/\s+/u);
        return value.includes("px-4") && value.includes("lg:px-6");
      },
    );
    expect(owners).toEqual([]);
  });

  it("stops the KPI cards, active vacancies and data table from re-adding page padding", () => {
    const { container } = render(<EmployerDashboardPage />);

    const kpi = container.querySelector("[data-pf-kpi-cards]") as HTMLElement;
    const active = container.querySelector(
      "[data-pf-active-vacancies]",
    ) as HTMLElement;
    const toolbar = screen.getByRole("heading", { name: "Candidatos recientes" })
      .parentElement as HTMLElement;

    for (const node of [kpi, active, toolbar]) {
      expect(node.className).not.toContain("px-4");
      expect(node.className).not.toContain("lg:px-6");
    }
  });

  it("keeps the padded content inside the unpadded @container/main query root", () => {
    const { container } = render(<EmployerDashboardPage />);

    const content = container.querySelector(
      "[data-pf-page-content]",
    ) as HTMLElement;
    const containerRoot = content.parentElement as HTMLElement;

    // The container query root stays unpadded, so its measured inline size — and
    // therefore every `@.../main` breakpoint — is unchanged.
    expect(containerRoot.className).toContain("@container/main");
    expect(containerRoot.className).not.toContain("px-4");
  });
});
