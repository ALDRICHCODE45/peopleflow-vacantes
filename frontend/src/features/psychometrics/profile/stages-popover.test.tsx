import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { COMPETENCY_IDS, type Profile } from "../model";
import { ProfileEditor } from "./editor";

// jsdom cannot position Base UI portals: the popup shell is replaced by a div that keeps the real className, so the sizing contract is assertable.
vi.mock("@/components/ui/popover", async importOriginal => {
  const actual = await importOriginal<typeof import("@/components/ui/popover")>();
  return { ...actual, PopoverContent: ({ children, className }: { children: React.ReactNode; className?: string }) => <div data-testid="stages-popup" className={className}>{children}</div>, PopoverTitle: ({ children }: { children: React.ReactNode }) => <h5>{children}</h5> };
});
vi.mock("../actions", () => ({ loadProfileAction: vi.fn(), saveProfileAction: vi.fn() }));
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
afterEach(cleanup);

const profile: Profile = { version: "0", enabled: true, test: "ipip60-mx", confirmed: false, confirmed_at: null, competencies: COMPETENCY_IDS.map(competency_id => ({ competency_id, importance: "importance.no_relevante", desired_band: null, rationale: null, task: null })), auto_send_stage_ids: [], expires_in_days: 7 };
const stages = ["Entrevista", "Evaluación", "Oferta", "Contratación", "Descartado", "Placement", "Otra"].map((name, index) => ({ id: `123e4567-e89b-42d3-a456-42661417400${index}`, kind: "screening" as const, name }));

it("lets the stages popover fit its content up to the viewport instead of capping it at 20 rem", () => {
  render(<ProfileEditor draftId="vacancy" profile={profile} etag={'"pp1"'} stages={stages} />);
  fireEvent.click(screen.getByRole("button", { name: "Crear invitación al entrar a estas etapas" }));
  const popup = screen.getByRole("group", { name: "Etapas automáticas" }).closest<HTMLElement>("[data-testid=stages-popup]")!;
  expect(popup.className).not.toContain("max-h-80");
  expect(popup.className).toContain("max-h-(--available-height)");
  expect(popup).toHaveClass("overflow-y-auto");
});
