import { describe, expect, it } from "vitest";
import { contrastRatio } from "../brand";
import { listItem, vacancyDetail } from "@/features/jobs/api/public-fixtures";
import type { PublicJobItem } from "@/features/jobs/types";
import { PROFESSIONAL_AREAS } from "@/features/jobs/drafts/scalars";
import { ICONS } from "../model";
import { bentoLayout } from "./bento";
import { fixedSectionAlign, SCRIM_ALPHA, SITE_SCRIM } from "./section-style";
import { defaultBlockV2 } from "../defaults";
import type { BlockTypeV2, SiteBlockV2 } from "../model";
import { DEFAULT_AREA_ICONS, deriveSiteAreas } from "./site-areas";
import { parseCountValue } from "./count-up";
import { newestJobs } from "./site-blocks-v2";

/** Row-major dense placement on a 6-column grid, like CSS `grid-auto-flow: row dense`. */
function pack(cells: { col: number; row: number }[]) {
  const grid: boolean[][] = [];
  const free = (r: number, c: number, cell: { col: number; row: number }) => {
    if (c + cell.col > 6) return false;
    for (let y = r; y < r + cell.row; y += 1) for (let x = c; x < c + cell.col; x += 1) if (grid[y]?.[x]) return false;
    return true;
  };
  for (const cell of cells) {
    let placed = false;
    for (let r = 0; !placed; r += 1) for (let c = 0; c < 6 && !placed; c += 1) {
      if (!free(r, c, cell)) continue;
      for (let y = r; y < r + cell.row; y += 1) { grid[y] ??= Array(6).fill(false); for (let x = c; x < c + cell.col; x += 1) grid[y][x] = true; }
      placed = true;
    }
  }
  return grid;
}

describe("bento layout (S2: no lone half-width card)", () => {
  it.each(Array.from({ length: 24 }, (_, index) => index + 1))("%i items fill every 6-column row on desktop", count => {
    const cells = bentoLayout(count);
    expect(cells).toHaveLength(count);
    const rows = pack(cells);
    for (const row of rows) expect(row.every(Boolean)).toBe(true);
  });
  it("a single item spans the full row", () => {
    expect(bentoLayout(1)).toEqual([{ col: 6, row: 1, wide: true }]);
  });
  it.each(Array.from({ length: 24 }, (_, index) => index + 1))("%i items leave no half-empty row on the 2-column tablet grid", count => {
    const cells = bentoLayout(count);
    const used = cells.reduce((total, cell) => total + (cell.wide ? 2 : 1), 0);
    expect(used % 2).toBe(0);
    // A wide (full-row) tablet cell never sits between two halves of a row.
    let column = 0;
    for (const cell of cells) { if (cell.wide) expect(column).toBe(0); column = (column + (cell.wide ? 2 : 1)) % 2; }
  });
  it("leads with a larger card from three items on", () => {
    expect(bentoLayout(3)[0]).toMatchObject({ row: 2 });
    expect(bentoLayout(6)[0]).toMatchObject({ col: 4, row: 2 });
    expect(bentoLayout(2).every(cell => cell.col === 3 && cell.row === 1)).toBe(true);
  });
});

describe("image background scrim (S3: text contrast over any photo)", () => {
  const blend = (alpha: number, over: string) => {
    const channel = (hex: string, offset: number) => parseInt(hex.slice(offset, offset + 2), 16);
    return `#${[1, 3, 5].map(offset => Math.round(channel(SITE_SCRIM, offset) * alpha + channel(over, offset) * (1 - alpha)).toString(16).padStart(2, "0")).join("")}`;
  };
  it.each(Object.entries(SCRIM_ALPHA))("%s keeps white text at AA even over a pure white photo", (_level, alpha) => {
    expect(contrastRatio("#FFFFFF", blend(alpha, "#FFFFFF"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#FFFFFF", blend(alpha, "#FFD400"))).toBeGreaterThanOrEqual(4.5);
  });
  it("levels are ordered soft < medium < strong", () => {
    expect(SCRIM_ALPHA.soft).toBeLessThan(SCRIM_ALPHA.medium);
    expect(SCRIM_ALPHA.medium).toBeLessThan(SCRIM_ALPHA.strong);
  });
});

describe("areas derived from published vacancies", () => {
  const job = (id: number, area: PublicJobItem["professional_area"]): PublicJobItem => ({ ...listItem(vacancyDetail), id: `0198f5a2-7c1b-7ddd-9c2e-${String(id).padStart(12, "0")}`, professional_area: area }) as PublicJobItem;
  it("counts vacancies per professional area, most first, skipping vacancies without area", () => {
    const areas = deriveSiteAreas([job(1, "logistics_transport"), job(2, "human_resources"), job(3, "logistics_transport"), job(4, null), job(5, "healthcare")]);
    expect(areas).toEqual([
      { key: "logistics_transport", label: "Logística y transporte", count: 2 },
      { key: "human_resources", label: "Recursos humanos", count: 1 },
      { key: "healthcare", label: "Salud", count: 1 },
    ].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es-MX")));
    expect(deriveSiteAreas([])).toEqual([]);
  });
  it("has a default catalog icon for every professional area", () => {
    for (const area of PROFESSIONAL_AREAS) expect(ICONS).toContain(DEFAULT_AREA_ICONS[area]);
  });
});

describe("count-up values", () => {
  it.each([
    ["+15", { prefix: "+", target: 15, suffix: "" }],
    ["300+", { prefix: "", target: 300, suffix: "+" }],
    ["98 %", { prefix: "", target: 98, suffix: " %" }],
    ["1,200", { prefix: "", target: 1200, suffix: "" }],
  ])("animates %s", (value, expected) => {
    const parsed = parseCountValue(value)!;
    expect(parsed).toMatchObject(expected);
    expect(parsed.format(parsed.target)).toBe(value);
    expect(parsed.format(0)).toBe(`${expected.prefix}0${expected.suffix}`);
  });
  it.each(["Monterrey", "4.8", "24/7", "", "1 de 3"])("leaves %s static", value => {
    expect(parseCountValue(value)).toBeNull();
  });
});

it("newest vacancies are the most recently published first", () => {
  const at = (id: number, date: string): PublicJobItem => ({ ...listItem(vacancyDetail), id: `0198f5a2-7c1b-7ddd-9c2e-${String(id).padStart(12, "0")}`, published_at: date });
  const jobs = [at(1, "2026-10-01T00:00:00Z"), at(2, "2026-11-20T00:00:00Z"), at(3, "2026-11-01T00:00:00Z"), at(4, "2026-11-24T00:00:00Z")];
  expect(newestJobs(jobs, 3).map(job => job.id.slice(-1))).toEqual(["4", "2", "3"]);
});

describe("alignment each layout can honour (S3: the selected value matches what renders)", () => {
  const of = (type: BlockTypeV2, variant?: string) => ({ ...defaultBlockV2(type), ...(variant ? { variant } : {}) }) as SiteBlockV2;
  it.each([
    ["closing", "banner", "center"], ["closing", "simple", "center"],
    ["hero", "photo", "center"], ["hero", "centered", "center"], ["hero", "split", "start"], ["hero", "photo_jobs", "start"], ["hero", "collage", "start"],
  ] as const)("%s «%s» always renders %s, so the style can't move it", (type, variant, align) => {
    expect(fixedSectionAlign(of(type, variant))).toBe(align);
  });
  it.each([["hero", "background_loop"], ["values", "bento"], ["talent_cta", "banner"], ["team", "grid"], ["story", "text"], ["jobs", "list"]] as const)("%s «%s» follows the section alignment", (type, variant) => {
    expect(fixedSectionAlign(of(type, variant))).toBeNull();
  });
});
describe("layouts designed centred", () => {
  it.each([["stats", "brand_band"], ["benefits", "big_icons"], ["values", "big_icons"]] as const)("%s «%s» always renders centred", (type, variant) => {
    expect(fixedSectionAlign({ ...defaultBlockV2(type), variant } as SiteBlockV2)).toBe("center");
  });
});
