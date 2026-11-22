// S5 (replacement-followups): board items carry `carried_from_participation_id` (UUID | null). Optional first so the
// strict schemas parse both the current backend (absent) and the new one (present); the card marks «Retomado».
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { boardSchema, detailSchema, moveSchema, participationSchema } from "./model";
import { intakeResponseSchema } from "@/features/manual-intake/model";
import { board, detail, id, item, moved } from "./test-fixtures";
import { BoardColumns } from "./board-columns";
import { boardFixture } from "./board-fixture";
import { InvitationsProvider } from "@/features/psychometrics/sheet/state";

const source = id(77);
const KEY = "carried_from_participation_id";
const intake = { ...moved, delivery: moved.delivery, coverage: moved.coverage, profile: item.profile, screening_answers: item.screening_answers };

describe("carried_from_participation_id decode", () => {
  it.each([["absent", undefined], ["null", null], ["a uuid", source]])("accepts %s on every board item decoder", (_, value) => {
    const extra = value === undefined ? {} : { [KEY]: value };
    expect(participationSchema.parse({ ...item, ...extra })[KEY]).toBe(value);
    expect(boardSchema.parse({ ...board, participations: [{ ...item, ...extra }] }).participations[0][KEY]).toBe(value);
    expect(detailSchema.parse({ ...detail, ...extra })[KEY]).toBe(value);
    expect(moveSchema.parse({ ...moved, ...extra })[KEY]).toBe(value);
    expect(intakeResponseSchema.parse({ ...intake, ...extra })[KEY]).toBe(value);
  });
  it("rejects a non-uuid value and keeps the item strict", () => {
    for (const bad of ["not-a-uuid", 3, {}, ""]) expect(participationSchema.safeParse({ ...item, [KEY]: bad }).success).toBe(false);
    expect(participationSchema.safeParse({ ...item, carried_from: source }).success).toBe(false);
  });
});

function renderCard(carried: string | null | undefined) {
  const current = boardFixture();
  const first = { ...current.participations[0] };
  if (carried !== undefined) Object.assign(first, { [KEY]: carried });
  current.participations = [first];
  render(<InvitationsProvider vacancyId="v"><BoardColumns board={current} pending={new Set()} locked={false} notices={{}} onMove={() => {}} onDetail={() => {}} onDisposition={() => {}} /></InvitationsProvider>);
  return document.getElementById(`candidate-card-${first.id}`)! as HTMLElement;
}

describe("«Retomado» mark on the card", () => {
  afterEach(cleanup);
  it("shows a calm badge with an aria-hidden History icon when the item carries a source participation", () => {
    const card = renderCard(source);
    const mark = within(card).getByText("Retomado").closest("[data-variant='neutral']") as HTMLElement;
    expect(mark).toBeVisible();
    const icon = mark.querySelector("svg.lucide-rotate-ccw-clock");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });
  it.each([["null", null], ["absent", undefined]])("renders the card as before when the key is %s", (_, value) => {
    const card = renderCard(value);
    expect(within(card).queryByText("Retomado")).not.toBeInTheDocument();
    expect(card.querySelector("svg.lucide-rotate-ccw-clock")).toBeNull();
    expect(screen.getByRole("button", { name: /Ver detalle de/ })).toBeInTheDocument();
  });
});
