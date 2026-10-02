import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { Badge, badgeVariants, type BadgeVariant } from "./badge";

const SOURCE = readFileSync(
  join(process.cwd(), "src", "components", "ui", "badge.tsx"),
  "utf8",
);

/**
 * Raw Tailwind palette utilities are forbidden: every tone must come from a
 * project token so light and dark stay coherent without manual `dark:` recipes.
 */
const RAW_PALETTE =
  /\b(?:bg|text|border|ring|from|via|to|fill|stroke|divide|decoration|outline|shadow|accent)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/u;

/** Semantic variants backed by the supplemental `--status-*` token family. */
const STATUS_VARIANTS = ["info", "review", "success", "danger"] as const;

/** Exactly the decorative `::before` classes the opt-in dot may add. */
const DOT_CLASSES = [
  "before:bg-current",
  "before:content-['']",
  "before:rounded-full",
  "before:shrink-0",
  "before:size-1.5",
];

/** Typing this map with `BadgeVariant` is the consumer use case under test. */
const VARIANT_SAMPLES: Record<BadgeVariant, string> = {
  accent: "Accent",
  danger: "Danger",
  default: "Default",
  destructive: "Destructive",
  ghost: "Ghost",
  info: "Info",
  link: "Link",
  neutral: "Neutral",
  outline: "Outline",
  review: "Review",
  secondary: "Secondary",
  success: "Success",
};

afterEach(() => cleanup());

/** Opacity modifier of the single `bg-<token>/<n>` fill the recipe sets. */
function fillOpacity(className: string, token: string): number | null {
  const match = new RegExp(`(?:^|\\s)bg-${token}/(\\d+)(?=\\s|$)`, "u").exec(
    className,
  );
  return match ? Number(match[1]) : null;
}

describe("Badge primitive contract", () => {
  it("derives the exported BadgeVariant union from the CVA variants", () => {
    // `VARIANT_SAMPLES` is typed `Record<BadgeVariant, string>`, so this test
    // only compiles while the exported union matches every shared variant.
    expect(Object.keys(VARIANT_SAMPLES)).toHaveLength(12);
    expect(SOURCE).toMatch(
      /export type BadgeVariant =[\s\S]*?VariantProps<typeof badgeVariants>\["variant"\]/u,
    );
  });

  it("renders every shared variant with its own data-variant marker", () => {
    for (const [variant, label] of Object.entries(VARIANT_SAMPLES)) {
      const { getByText, unmount } = render(
        <Badge variant={variant as BadgeVariant}>{label}</Badge>,
      );
      const badge = getByText(label);

      expect(badge).toHaveAttribute("data-slot", "badge");
      expect(badge).toHaveAttribute("data-variant", variant);
      expect(badge.className, variant).not.toMatch(RAW_PALETTE);
      unmount();
    }
  });

  it("uses the compact rounded-md geometry instead of the near-pill radius", () => {
    const { getByText } = render(<Badge>Enviada</Badge>);
    const badge = getByText("Enviada");

    expect(badge).toHaveClass("rounded-md");
    expect(badge.className).not.toContain("rounded-2xl");
    expect(SOURCE).toContain("rounded-md");
    expect(SOURCE).not.toContain("rounded-2xl");
  });

  it("keeps the 20px height, spacing, typography, focus and icon behavior", () => {
    const { getByText } = render(<Badge>Enviada</Badge>);
    const badge = getByText("Enviada");

    expect(badge).toHaveClass(
      "h-5",
      "px-2",
      "py-0.5",
      "gap-1",
      "text-xs",
      "font-medium",
      "whitespace-nowrap",
      "focus-visible:border-ring",
      "focus-visible:ring-[3px]",
      "focus-visible:ring-ring/50",
      "has-data-[icon=inline-end]:pr-1.5",
      "has-data-[icon=inline-start]:pl-1.5",
      "[&>svg]:size-3!",
    );
  });

  for (const variant of STATUS_VARIANTS) {
    const token = `status-${variant}`;

    it(`${variant} paints the ${token} token as a soft semantic fill`, () => {
      const { getByText } = render(<Badge variant={variant}>{variant}</Badge>);
      const badge = getByText(variant);

      expect(badge).toHaveClass(
        `text-${token}`,
        `border-${token}/40`,
        `bg-${token}/10`,
      );
      expect(badge.className).not.toMatch(RAW_PALETTE);
      // `?? 100` keeps a missing fill from passing the low-opacity assertion.
      expect(fillOpacity(badge.className, token) ?? 100).toBeLessThanOrEqual(30);
    });
  }

  it("paints accent with primary tokens and neutral with surface tokens", () => {
    const accent = render(<Badge variant="accent">Principal</Badge>);
    const accentBadge = accent.getByText("Principal");

    expect(accentBadge).toHaveClass("border-primary/40", "text-foreground");
    expect(
      fillOpacity(accentBadge.className, "primary") ?? 100,
    ).toBeLessThanOrEqual(30);
    expect(accentBadge.className).not.toMatch(RAW_PALETTE);
    accent.unmount();

    const neutral = render(<Badge variant="neutral">Cerrada</Badge>);
    const neutralBadge = neutral.getByText("Cerrada");

    expect(neutralBadge).toHaveClass(
      "border-border",
      "bg-muted",
      "text-muted-foreground",
    );
    expect(neutralBadge.className).not.toMatch(RAW_PALETTE);
  });

  it("keeps destructive as a tokenized alias of danger without an implicit dot", () => {
    const { getByText } = render(<Badge variant="destructive">Rechazada</Badge>);
    const badge = getByText("Rechazada");

    expect(badge).toHaveClass(
      "border-status-danger/40",
      "bg-status-danger/10",
      "text-status-danger",
    );
    expect(badge.className).not.toMatch(RAW_PALETTE);
    expect(badge).not.toHaveAttribute("data-dot");
    expect(badge.className).not.toContain("before:");
    expect(SOURCE).toContain("bg-status-danger/10");
  });

  it("adds exactly one decorative pseudo dot when dot is opted in", () => {
    const { getByText } = render(
      <Badge dot variant="info">
        Enviada
      </Badge>,
    );
    const badge = getByText("Enviada");

    expect(badge).toHaveAttribute("data-dot");
    expect(badge).not.toHaveAttribute("dot");
    const dotClasses = badge.className
      .split(/\s+/u)
      .filter((token) => token.includes("before:"));
    expect([...dotClasses].sort()).toEqual([...DOT_CLASSES].sort());
    // The dot is a shared API on the recipe, not a per-variant patch.
    expect(badgeVariants({ dot: true })).toContain("before:bg-current");
    expect(badgeVariants({})).not.toContain("before:");
  });

  it("keeps the dot decorative: no extra DOM node and no extra accessible text", () => {
    const { getByText } = render(<Badge dot>Contratada</Badge>);
    const badge = getByText("Contratada");

    expect(badge.textContent).toBe("Contratada");
    expect(badge.childNodes).toHaveLength(1);
    expect(badge.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(badge.querySelectorAll("*")).toHaveLength(0);
  });

  it("omits every dot marker and dot class by default", () => {
    const { getByText } = render(<Badge>Enviada</Badge>);
    const badge = getByText("Enviada");

    expect(badge).not.toHaveAttribute("data-dot");
    expect(badge.className).not.toContain("before:");
    expect(badge.className).not.toContain("bg-current");
  });

  it("keeps render composition and children intact with the dot enabled", () => {
    const { getByRole } = render(
      <Badge dot variant="success" render={<a href="/postulaciones/1" />}>
        Contratada
      </Badge>,
    );
    const link = getByRole("link", { name: "Contratada" });

    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("data-slot", "badge");
    expect(link).toHaveAttribute("data-dot");
    expect(link).toHaveClass("rounded-md", "text-status-success");
    expect(link.childNodes).toHaveLength(1);
  });

  it("keeps the existing default, secondary, outline, ghost and link API", () => {
    const legacy = [
      ["default", "bg-primary"],
      ["secondary", "bg-secondary"],
      ["outline", "border-border"],
      ["ghost", "hover:bg-muted"],
      ["link", "underline-offset-4"],
    ] as const;

    for (const [variant, token] of legacy) {
      const label = `Legacy ${variant}`;
      const { getByText, unmount } = render(
        <Badge variant={variant}>{label}</Badge>,
      );
      const badge = getByText(label);

      expect(badge).toHaveAttribute("data-variant", variant);
      expect(badge).toHaveClass(token, "h-5", "rounded-md");
      unmount();
    }
  });

  it("still merges consumer classes over the shared recipe", () => {
    const { getByText } = render(
      <Badge variant="outline" className="font-bold tabular-nums">
        80%
      </Badge>,
    );
    const badge = getByText("80%");

    expect(badge).toHaveClass("border-border", "font-bold", "tabular-nums");
  });

  it("never reintroduces a raw palette utility in the primitive source", () => {
    expect(SOURCE).not.toMatch(RAW_PALETTE);
    expect(SOURCE).not.toContain("rounded-2xl");
    expect(SOURCE).toContain("status-info");
    expect(SOURCE).toContain("status-review");
    expect(SOURCE).toContain("status-success");
    expect(SOURCE).toContain("status-danger");
  });
});
