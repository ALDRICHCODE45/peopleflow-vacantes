import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TeamHistory } from "./history";
import type { HistoryItem, Tramo } from "./model";
import { createFixtureClient } from "./prototype-client";

afterEach(cleanup);
const joined = "2026-11-01T12:00:00Z";
const promoted = "2026-11-02T12:00:00.123456+00:00";
const ended = "2026-11-03T12:00:00Z";
const mariana = { id: "mariana", name: "Mariana Ruiz" };
const owner = { id: "owner", name: "Test User" };
function tramo(endCause: Tramo["end_cause"] = null): Extract<HistoryItem, { kind: "tramo" }> {
  return { kind: "tramo", at: endCause ? ended : promoted, tramo: {
    assignment_id: "mariana-assignment", user: mariana, started_at: joined, started_by: owner,
    start_cause: "added", ended_at: endCause ? ended : null, ended_by: endCause ? owner : null,
    end_cause: endCause, recruiter_deadline: null, closing_deadline: null,
    functions: [
      { function: "collaborator", started_at: joined, ended_at: promoted, start_cause: "added", end_cause: "reassignment" },
      { function: "responsible", started_at: promoted, ended_at: endCause ? ended : null, start_cause: "reassignment", end_cause: endCause ? "tramo_ended" : null },
    ],
  } };
}
function reassignment(at: string, away = false): Extract<HistoryItem, { kind: "reassignment" }> {
  return { kind: "reassignment", at, reassignment: {
    id: at, from_user: away ? mariana : owner, to_user: away ? owner : mariana,
    performed_by: owner, previous_responsible: "remove", reason: away ? "recruiter_departure" : "workload",
    note: null, state_snapshot: createFixtureClient("owner").snapshot,
  } };
}
const sentences = (element: HTMLElement) => within(element).getAllByRole("listitem").map(row => row.querySelector("p")!.textContent);
function show(items: HistoryItem[]) {
  render(<TeamHistory history={{ items, next_cursor: null }} pending={false} onMore={vi.fn()} />);
  return screen.getByRole("region", { name: "Movimientos del equipo" });
}
it("keeps a collaborator's original join when a later reassignment promotes her (offsets and microseconds)", () => {
  const section = show([tramo(), reassignment("2026-11-02T06:00:00.999-06:00")]);
  expect(sentences(section)).toEqual([
    "Test User le pasó la vacante a Mariana Ruiz",
    "Mariana Ruiz se unió como colaborador",
  ]);
  expect(section.querySelectorAll("time")[1]).toHaveAttribute("datetime", joined);
  expect(within(section).getByRole("button", { name: "Ver cómo estaba la vacante" })).toBeVisible();
});
it("tells an offboard handover once and says the receiver took the vacancy", () => {
  const section = show([reassignment(ended, true), tramo("reassigned"), reassignment(promoted)]);
  expect(sentences(section)).toEqual([
    "Test User tomó la vacante de Mariana Ruiz",
    "Test User le pasó la vacante a Mariana Ruiz",
    "Mariana Ruiz se unió como colaborador",
  ]);
});
it.each(["removed", "left", "membership_ended"] as const)("keeps %s ends even alongside reassignment and mode change", cause => {
  const mode: HistoryItem = { kind: "mode_change", at: ended, mode_change: {
    id: "mode", from_mode: "with_responsible", to_mode: "shared", responsible_user: null, performed_by: owner,
  } };
  const section = show([tramo(cause), reassignment(ended, true), mode, reassignment(promoted)]);
  expect(sentences(section)).toEqual([
    cause === "removed" ? "Test User quitó a Mariana Ruiz del equipo" : cause === "left" ? "Mariana Ruiz salió del equipo" : "Terminó la membresía de Mariana Ruiz",
    "Test User tomó la vacante de Mariana Ruiz",
    "Test User cambió el modo a «Equipo sin responsable»",
    "Test User le pasó la vacante a Mariana Ruiz",
    "Mariana Ruiz se unió como colaborador",
  ]);
});
it("keeps joins even when they coincide with a reassignment and end", () => {
  const item = tramo("reassigned");
  item.tramo.started_at = ended;
  item.tramo.functions = [{ ...item.tramo.functions[0], started_at: ended }];
  expect(sentences(show([item, reassignment(ended, true)]))).toEqual([
    "Mariana Ruiz se unió como colaborador", "Test User tomó la vacante de Mariana Ruiz",
  ]);
});
it("expands every function period, sorts events stably, caps the card at five and keeps backend cursor pagination", async () => {
  const item = tramo("left");
  item.tramo.functions.push(
    { function: "member", started_at: "2026-11-02T14:00:00Z", ended_at: "2026-11-02T15:00:00Z", start_cause: "mode_change", end_cause: "mode_change" },
    { function: "responsible", started_at: "2026-11-02T15:00:00Z", ended_at: ended, start_cause: "mode_change", end_cause: "tramo_ended" },
  );
  const handover = reassignment(ended, true);
  const older = reassignment("2026-10-30T12:00:00Z");
  const onMore = vi.fn();
  const items = [handover, item, older];
  const { rerender } = render(<TeamHistory history={{ items, next_cursor: "opaque-next" }} pending={false} onMore={onMore} />);
  const section = screen.getByRole("region", { name: "Movimientos del equipo" });
  const expected = [
    "Test User tomó la vacante de Mariana Ruiz", "Mariana Ruiz salió del equipo",
    "Mariana Ruiz cambió su función a responsable", "Mariana Ruiz cambió su función a miembro",
    "Mariana Ruiz cambió su función a responsable", "Mariana Ruiz se unió como colaborador",
    "Test User le pasó la vacante a Mariana Ruiz",
  ];
  expect(sentences(section)).toEqual(expected.slice(0, 5));
  fireEvent.click(within(section).getByRole("button", { name: "Ver todos los movimientos" }));
  const sheet = await screen.findByRole("dialog", { name: "Movimientos del equipo" });
  expect(sentences(sheet)).toEqual(expected);
  fireEvent.click(within(sheet).getByRole("button", { name: "Ver más" }));
  expect(onMore).toHaveBeenCalledOnce();
  const next = tramo(); next.tramo.assignment_id = "older-assignment";
  next.tramo.user = { id: "other", name: "Otra persona" };
  next.tramo.started_at = "2026-10-28T12:00:00Z";
  next.tramo.functions = [{ ...next.tramo.functions[0], started_at: next.tramo.started_at }];
  rerender(<TeamHistory history={{ items: [...items, next], next_cursor: null }} pending={false} onMore={onMore} />);
  expect(sentences(sheet)).toEqual([...expected, "Otra persona se unió como colaborador"]);
  expect(within(sheet).queryByRole("button", { name: "Ver más" })).not.toBeInTheDocument();
});
