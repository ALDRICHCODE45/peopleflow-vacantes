import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { members } from "./test-fixtures";
import { createOffboardFixtureClient, OffboardError, prototypeMembers } from "./offboard-client";
import { OffboardDialog } from "./offboard-dialog";
// Base UI popup focus/positioning loops in jsdom inside AlertDialog. Exercise
// controlled selection here; controller tests render the real PersonField closed.
vi.mock("@/features/vacancy-team/controls", () => ({
  PersonField: ({ id, label, members, value, onChange }: { id: string; label: string; members: import("@/features/vacancy-team/model").CompanyMembers["members"]; value: string; onChange: (id: string) => void }) => <label htmlFor={id}>{label}<select id={id} value={value} onChange={event => onChange(event.target.value)}><option value="">Elige una persona</option>{members.map(member => <option key={member.id} value={member.user.id}>{member.user.full_name}</option>)}</select></label>,
}));
afterEach(cleanup);

it.each(["none", "collaborator", "responsible"] as const)("reads contract preview for %s using membership id", async scenario => {
  const client = createOffboardFixtureClient(members, scenario);
  const preview = await client.preview(members[1].id);
  expect(preview.user).toEqual({ id: members[1].user.id, full_name: "José Real" });
  expect(preview.vacancies).toHaveLength(scenario === "responsible" ? 2 : 0);
  expect(preview.other_tramos).toBe(scenario === "collaborator" ? 3 : 0);
  expect(preview.vacancies.every(v => v.team.every(p => p.user_id !== members[1].user.id))).toBe(true);
  await expect(client.preview(members[1].user.id)).rejects.toMatchObject({ status: 404 });
});
it("rejects unresolved and invalid targets atomically, protects DELETE, then removes the membership", async () => {
  const client = createOffboardFixtureClient(members, "responsible");
  await expect(client.remove(members[1].id)).rejects.toMatchObject({ status: 409, code: "member_is_responsible" });
  for (const target of [null, members[1].user.id, "unknown"]) {
    await expect(client.offboard(members[1].id, { default_to_user_id: target, reassignments: [] })).rejects.toMatchObject({ status: 422, code: "offboard_unresolved_vacancies", vacancies: expect.any(Array) });
    expect(await client.list()).toEqual(members);
    expect((await client.preview(members[1].id)).vacancies).toHaveLength(2);
  }
  const preview = await client.preview(members[1].id);
  await client.offboard(members[1].id, { default_to_user_id: null, reassignments: preview.vacancies.map(v => ({ draft_id: v.draft_id, to_user_id: members[0].user.id })) });
  expect(await client.list()).toEqual([members[0]]);
});
it.each(["none", "collaborator"] as const)("keeps today's confirmation for %s", async scenario => {
  const client = createOffboardFixtureClient(members, scenario);
  render(<OffboardDialog preview={await client.preview(members[1].id)} members={members} onClose={() => {}} onConfirm={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Quitar del equipo" })).toBeEnabled();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.queryByText("También sale de 3 vacantes donde colabora. Su trabajo queda a su nombre.") !== null).toBe(scenario === "collaborator");
});
it("suggests from current teams, permits a row override and emits one map", async () => {
  const client = createOffboardFixtureClient(members, "responsible");
  const preview = await client.preview(members[1].id);
  const confirm = vi.fn();
  const third = { ...members[0], id: "20000000-0000-4000-8000-000000000003", user: { ...members[0].user, id: "10000000-0000-4000-8000-000000000003", full_name: "Luz Pérez" } };
  render(<OffboardDialog preview={preview} members={[...members, third]} onClose={() => {}} onConfirm={confirm} />);
  expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
  expect(screen.getByRole("combobox", { name: "Pasar todas a" })).toHaveValue(members[0].user.id);
  expect(screen.getByText("Motivo: baja del reclutador")).toBeVisible();
  const user = userEvent.setup();
  await user.click(screen.getAllByRole("button", { name: /Cambiar/ })[0]);
  const override = screen.getByRole("combobox", { name: /Responsable de Analista/ });
  await user.selectOptions(override, third.user.id);
  await user.click(screen.getByRole("button", { name: "Quitar y reasignar" }));
  expect(confirm).toHaveBeenCalledWith({ default_to_user_id: members[0].user.id, reassignments: [{ draft_id: preview.vacancies[0].draft_id, to_user_id: third.user.id }] });
});
it("disables unresolved confirmation and keeps 422 feedback inside the same dialog", async () => {
  const client = createOffboardFixtureClient(members, "responsible");
  const preview = await client.preview(members[1].id);
  preview.vacancies.forEach(v => { v.team = []; });
  render(<OffboardDialog preview={preview} members={members} onClose={() => {}} onConfirm={vi.fn()} failure={new OffboardError(422, "offboard_unresolved_vacancies", preview.vacancies)} />);
  const dialog = screen.getByRole("alertdialog");
  expect(within(dialog).getByRole("button", { name: "Quitar y reasignar" })).toBeDisabled();
  expect(within(dialog).getByText(/Elige responsable para:/)).toHaveTextContent("Analista contable");
  const user = userEvent.setup();
  await user.selectOptions(screen.getByRole("combobox", { name: "Pasar todas a" }), members[0].user.id);
  expect(within(dialog).getByRole("button", { name: "Quitar y reasignar" })).toBeEnabled();
});
it("labels responsible and last-member handovers without changing the dialog composition", async () => {
  const preview = await createOffboardFixtureClient(members, "responsible").preview(members[1].id);
  preview.vacancies[0].hand_over = "responsible";
  preview.vacancies[1].hand_over = "last_member";
  render(<OffboardDialog preview={preview} members={members} onClose={() => {}} onConfirm={vi.fn()} />);
  expect(screen.getByText("Es responsable")).toBeVisible();
  expect(screen.getByText("Es la única persona del equipo")).toBeVisible();
  expect(screen.getByText(/como responsable/)).toBeVisible();
  expect(screen.getByText(/como miembro/)).toBeVisible();
});
it("prototype recruiters belong to the viewer's company and never repeat an id", () => {
  const fixtures = prototypeMembers("11111111-1111-4111-8111-111111111111");
  expect(fixtures.map(member => member.user?.full_name)).toEqual(["Ana López", "Diego Hernández", "Mariana Ruiz"]);
  expect(new Set(fixtures.map(member => member.company_id))).toEqual(new Set(["11111111-1111-4111-8111-111111111111"]));
  expect(new Set(fixtures.map(member => member.id)).size).toBe(3);
  expect(fixtures.every(member => member.role === "recruiter")).toBe(true);
});
