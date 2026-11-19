// T13 (candidate-dashboard-modern L29): the board item profile carries the title frozen at
// application (`profile.professional_title`). Optional until the backend merges; null for old copies.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { boardSchema, detailSchema, moveSchema, participationSchema, profileSchema } from "./model";
import { board, detail, item, moved } from "./test-fixtures";
import { MovementBoard } from "./board";
import { CandidateSheet } from "./candidate-sheet";
import { loadBoardAction, loadHistoryAction, loadParticipationAction } from "./actions";
import { boardFixture, detailFixture, historyFixture, vacancyId } from "./board-fixture";
import type { Board } from "./model";
vi.mock("./actions", () => ({ loadBoardAction: vi.fn(), loadHistoryAction: vi.fn(), loadParticipationAction: vi.fn(), moveParticipationAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
vi.mock("@/features/languages/use-language-catalog", () => ({ useLanguageCatalog: () => ({ status: "success", data: { items: [] } }) }));
vi.mock("@/components/ui/tooltip", async importOriginal => ({ ...await importOriginal<typeof import("@/components/ui/tooltip")>(), TooltipContent: () => null }));

const titled = (title: string | null | undefined) => ({ ...item, profile: { ...item.profile, professional_title: title } });
const withoutKey = item;

describe("board profile decode", () => {
  it.each([["present", "Backend Engineer"], ["null", null]])("accepts profile.professional_title %s on board, detail and item", (_, title) => {
    const wire = titled(title);
    expect(participationSchema.parse(wire).profile.professional_title).toBe(title);
    expect(boardSchema.parse({ ...board, participations: [wire] }).participations[0].profile.professional_title).toBe(title);
    expect(detailSchema.parse({ ...detail, profile: wire.profile }).profile.professional_title).toBe(title);
  });
  it("still accepts the pre-merge profile without the key", () => {
    expect(participationSchema.safeParse(withoutKey).success).toBe(true);
    expect(participationSchema.parse(withoutKey).profile).not.toHaveProperty("professional_title");
    expect(detailSchema.safeParse(detail).success).toBe(true);
  });
  it("rejects a non-string or over-long title and keeps the profile strict", () => {
    for (const bad of [3, "x".repeat(121), {}]) expect(participationSchema.safeParse(titled(bad as never)).success).toBe(false);
    expect(participationSchema.safeParse(titled("x".repeat(120))).success).toBe(true);
    expect(participationSchema.safeParse({ ...item, profile: { ...item.profile, professional_title: "QA", extra: true } }).success).toBe(false);
  });
  it("does not widen the talent-base profile or mutation responses", () => {
    expect(profileSchema.safeParse({ ...item.profile, professional_title: "QA" }).success).toBe(false);
    expect(moveSchema.safeParse({ ...moved, profile: titled("QA").profile }).success).toBe(false);
  });
  it("detail original keeps the title at its own level, never inside original.profile", () => {
    const original = { full_name: "Ana Pérez", contact: { email: null, phone: null }, professional_title: "Frontend Dev", current_company: null, profile: item.profile, education: null, linkedin_url: null, portfolio_url: null };
    const wire = { ...detail, profile: titled("Corrected").profile, corrected_fields: ["professional_title"], original };
    expect(detailSchema.parse(wire).original?.professional_title).toBe("Frontend Dev");
    expect(detailSchema.parse({ ...wire, original: { ...original, professional_title: null } }).original?.professional_title).toBeNull();
    expect(detailSchema.safeParse({ ...wire, original: { ...original, profile: { ...item.profile, professional_title: "X" } } }).success).toBe(false);
  });
});

function boardWith(title: string | null | undefined): Board {
  const current = boardFixture();
  current.participations = [{ ...current.participations[0], profile: { ...current.participations[0].profile, professional_title: title } }];
  return current;
}

describe("title on the company side", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: detailFixture() });
    vi.mocked(loadHistoryAction).mockResolvedValue({ ok: true, data: historyFixture() });
  });
  afterEach(cleanup);

  it("the board card shows the title as a secondary line under the name, described by it", async () => {
    vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: boardWith("Backend Engineer") });
    render(<MovementBoard vacancyId={vacancyId} />);
    const open = await screen.findByRole("button", { name: "Ver detalle de Ana Pérez" });
    const title = within(open).getByText("Backend Engineer");
    expect(title).toHaveClass("truncate", "text-muted-foreground");
    expect(open).toHaveAccessibleDescription("Backend Engineer");
    // One-line name + one-line title stay inside the 40 px name button: the card does not grow.
    expect(within(open).getByText("Ana Pérez")).toHaveClass("line-clamp-1");
  });
  it.each([null, undefined])("the board card shows nothing for a %s title", async title => {
    vi.mocked(loadBoardAction).mockResolvedValue({ ok: true, data: boardWith(title) });
    render(<MovementBoard vacancyId={vacancyId} />);
    const open = await screen.findByRole("button", { name: "Ver detalle de Ana Pérez" });
    expect(open.querySelector("[data-candidate-title]")).toBeNull();
    expect(within(open).getByText("Ana Pérez")).toHaveClass("line-clamp-2");
    expect(open).not.toHaveAttribute("aria-describedby");
  });
  it("the sheet header shows the title under the name, from the detail read", async () => {
    const current = boardWith("Board title");
    vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: { ...detailFixture(), profile: { ...detailFixture().profile, professional_title: "Detail title" } } });
    render(<CandidateSheet vacancyId={vacancyId} vacancyTitle="Software Developer" item={current.participations[0]} board={current} onClose={() => {}} />);
    const sheet = screen.getByRole("dialog", { name: "Ana Pérez" });
    expect(within(sheet).getByText("Board title")).toBeVisible();
    expect(await within(sheet).findByText("Detail title")).toHaveAttribute("data-candidate-title");
    expect(within(sheet).queryByText("Board title")).toBeNull();
  });
  it.each([null, undefined])("the sheet header shows no placeholder for a %s title", async title => {
    const current = boardWith(title);
    vi.mocked(loadParticipationAction).mockResolvedValue({ ok: true, data: { ...detailFixture(), profile: { ...detailFixture().profile, professional_title: title } } });
    render(<CandidateSheet vacancyId={vacancyId} vacancyTitle="Software Developer" item={current.participations[0]} board={current} onClose={() => {}} />);
    await screen.findByRole("region", { name: "Perfil" });
    expect(document.querySelector("[data-candidate-title]")).toBeNull();
  });
});
