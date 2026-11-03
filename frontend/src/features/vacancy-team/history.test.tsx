import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TeamHistory } from "./history";
import { SnapshotSheet } from "./snapshot-sheet";
import { memberActionLabel, memberActions } from "./model";
import { createFixtureClient } from "./prototype-client";
afterEach(cleanup);

it.each([true, false])("names a reassignment without repeating its actor when self=%s", async self => {
  const history = await createFixtureClient("owner").getHistory();
  const item = history.items.find(item => item.kind === "reassignment")!;
  if (item.kind !== "reassignment") throw new Error("fixture");
  if (self) item.reassignment.performed_by = item.reassignment.from_user;
  render(<TeamHistory history={{ items: [item], next_cursor: null }} pending={false} onMore={vi.fn()} />);
  expect(screen.getByRole("listitem").querySelector("p")).toHaveTextContent(self ? "Diego Hernández le pasó la vacante a Ana López" : "Sofía Ramírez pasó la vacante de Diego Hernández a Ana López");
});

it.each(["reassignment", "mode_change"] as const)("collapses only same-second function changes for %s, preserving joins and leaves", async kind => {
  const client = createFixtureClient("owner");
  if (kind === "reassignment") await client.reassign({ to_user_id: "user-diego", reason: "workload", previous_responsible: "keep_as_collaborator", recruiter_deadline: null });
  else await client.changeMode({ mode: "shared" });
  const history = await client.getHistory();
  const event = history.items.find(item => item.kind === kind)!;
  const changed = history.items.find(item => item.kind === "tramo" && item.tramo.functions.length > 1)!;
  if (changed.kind !== "tramo") throw new Error("fixture");
  changed.at = "2026-11-12T16:04:00.999999+00:00";
  const unrelated = structuredClone(changed); unrelated.tramo.assignment_id = "unrelated"; unrelated.tramo.user = { id: "other", name: "Otra persona" };
  const earlier = structuredClone(changed); earlier.tramo.assignment_id = "earlier"; earlier.at = "2026-11-12T16:03:59Z";
  const join = structuredClone(changed); join.tramo.assignment_id = "join"; join.tramo.functions = [join.tramo.functions[0]];
  const leave = structuredClone(changed); leave.tramo.assignment_id = "leave"; leave.tramo.ended_at = event.at; leave.tramo.end_cause = "left";
  const items = [event, changed, earlier, join, leave, ...(kind === "reassignment" ? [unrelated] : [])];
  render(<TeamHistory history={{ items, next_cursor: "next" }} pending={false} onMore={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Ver todos los movimientos" }));
  const sheet = await screen.findByRole("dialog", { name: "Movimientos del equipo" });
  expect(within(sheet).getAllByRole("listitem")).toHaveLength(kind === "reassignment" ? 5 : 4);
  expect(within(sheet).getByText(/se unió como/)).toBeVisible();
  expect(within(sheet).getByText(/salió del equipo/)).toBeVisible();
  expect(within(sheet).getAllByText(/cambió su función/)).toHaveLength(kind === "reassignment" ? 2 : 1);
});

it.each([false, true])("hides zero stages and shows the empty candidate copy when allZero=%s", allZero => {
  const snapshot = createFixtureClient("owner").snapshot;
  snapshot.stage_counts = [
    { stage_id: "empty", stage_name: "Vacía", active: 0, discarded: 0 },
    { stage_id: "discarded", stage_name: "Con descartados", active: 0, discarded: allZero ? 0 : 1 },
    { stage_id: "active", stage_name: "Con activos", active: allZero ? 0 : 2, discarded: 0 },
  ];
  render(<SnapshotSheet snapshot={snapshot} from="Diego" to="Ana" open onOpenChange={vi.fn()} />);
  const section = screen.getByRole("region", { name: "Candidatos por etapa" });
  expect(within(section).queryByText(/Vacía/)).not.toBeInTheDocument();
  expect(within(section).queryAllByRole("progressbar")).toHaveLength(allZero ? 0 : 2);
  if (allZero) expect(within(section).getByText("Aún no había candidatos")).toBeVisible();
});

it.each([[1, "1 placement"], [2, "2 placements"]] as const)("uses plain plural placements copy for %s", async (count, copy) => {
  const snapshot = createFixtureClient("owner").snapshot;
  snapshot.placements = { current: count, credited: 0 };
  snapshot.stage_counts.push({ stage_id: "opaque-stage", stage_name: "Personalizada", active: 1, discarded: 0 });
  render(<SnapshotSheet snapshot={snapshot} from="Diego" to="Ana" open onOpenChange={vi.fn()} />);
  const sheet = await screen.findByRole("dialog", { name: "Cómo estaba la vacante" });
  expect(within(sheet).getByText(copy, { exact: true })).toBeVisible();
  expect(within(sheet).queryByText(/acreditados/)).not.toBeInTheDocument();
  expect(within(sheet).getByRole("progressbar", { name: "Personalizada: 1 candidato" })).toHaveClass("stage-neutral");
});

it("shows elapsed days without a progress bar when no deadline exists and trusts stage kind", async () => {
  const snapshot = createFixtureClient("owner").snapshot;
  snapshot.tramo.business_days_total = null;
  snapshot.tramo.effective_deadline = null;
  snapshot.tramo.deadline_source = "none";
  snapshot.stage_counts = [{ stage_id: "opaque", stage_name: "Entrevista", kind: "in_process", active: 3, discarded: 0 }];
  render(<SnapshotSheet snapshot={snapshot} from="Diego" to="Ana" open onOpenChange={vi.fn()} />);
  const section = screen.getByRole("region", { name: "Tiempo utilizado" });
  expect(within(section).getByText("7 días hábiles usados · sin plazo definido")).toBeVisible();
  expect(within(section).queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Entrevista: 3 candidatos" })).toHaveClass("stage-process");
});

it("provides short capability-only member menu options", async () => {
  const can = (await createFixtureClient("owner").getTeam()).viewer.can;
  expect(memberActions(can).map(action => memberActionLabel[action])).toEqual(["Editar plazo", "Quitar"]);
  expect(memberActions({ ...can, remove_member: false }).map(action => memberActionLabel[action])).toEqual(["Editar plazo"]);
  expect(memberActions({ ...can, edit_deadline: false }).map(action => memberActionLabel[action])).toEqual(["Quitar"]);
  expect(memberActions({ ...can, edit_deadline: false, remove_member: false })).toEqual([]);
});
it("caps the page at five movements and puts full pagination inside a floating Sheet", async () => {
  const client = createFixtureClient("long-history");
  const onMore = vi.fn();
  render(<TeamHistory history={await client.getHistory()} pending={false} onMore={onMore} />);
  const section = screen.getByRole("region", { name: "Movimientos del equipo" });
  expect(within(section).getAllByRole("listitem")).toHaveLength(5);
  expect(section.querySelectorAll('[data-slot="card"]')).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Ver más" })).not.toBeInTheDocument();
  const all = within(section).getByRole("button", { name: "Ver todos los movimientos" });
  expect(all.closest('[data-slot="card-footer"]')).not.toBeNull();
  fireEvent.click(all);
  const sheet = await screen.findByRole("dialog", { name: "Movimientos del equipo" });
  expect(sheet).toHaveAttribute("data-presentation", "floating");
  expect(within(sheet).getAllByRole("listitem")).toHaveLength(20);
  expect(sheet.querySelector('[data-slot="sheet-header"] svg')).not.toBeNull();
  expect(sheet.querySelector('[data-slot="sheet-footer"] [data-pf-action-bar]')).not.toBeNull();
  expect(within(sheet).getByRole("button", { name: "Cerrar" }).closest('[data-slot="sheet-footer"]')).not.toBeNull();
  const more = within(sheet).getByRole("button", { name: "Ver más" });
  expect(more.closest('[data-slot="movements-body"]')).not.toBeNull();
  fireEvent.click(more); expect(onMore).toHaveBeenCalledOnce();
});
it("keeps a short timeline compact and opens its snapshot action", async () => {
  const client = createFixtureClient("owner");
  render(<TeamHistory history={await client.getHistory()} pending={false} onMore={vi.fn()} />);
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
  expect(screen.queryByRole("button", { name: "Ver todos los movimientos" })).not.toBeInTheDocument();
  expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "Sofía Ramírez pasó la vacante de Diego Hernández a Ana López")).toBeVisible();
  expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "Diego Hernández se unió como colaborador")).toBeVisible();
  expect(screen.getByText((_, element) => element?.getAttribute("data-slot") === "item-description" && element.textContent === "6 nov 2026 · Carga de trabajo")).toBeVisible();
  expect(screen.queryByText("Estado guardado")).not.toBeInTheDocument();
  const snapshotAction = screen.getByRole("button", { name: "Ver cómo estaba la vacante" });
  expect(snapshotAction).toHaveClass("-ml-3");
  fireEvent.click(snapshotAction);
  expect(await screen.findByRole("dialog", { name: "Cómo estaba la vacante" })).toBeVisible();
});
it.each([
  ["mode", "Sofía Ramírez cambió el modo a «Equipo sin responsable»"],
  ["function", "Ana López cambió su función a colaborador"],
  ["removed", "Sofía Ramírez quitó a Diego Hernández del equipo"],
  ["left", "Diego Hernández salió del equipo"],
  ["membership_ended", "Terminó la membresía de Diego Hernández"],
  ["reassigned", "Diego Hernández salió del equipo por reasignación"],
] as const)("writes a plain sentence for %s", async (kind, sentence) => {
  const client = createFixtureClient(kind === "left" ? "collaborator" : "owner");
  if (kind === "mode" || kind === "function") await client.changeMode({ mode: "shared" });
  else if (kind === "left") await client.leave();
  else await client.removeMember("user-diego");
  const history = await client.getHistory();
  if (kind === "function") {
    history.items = history.items.filter(item => item.kind === "tramo" && item.tramo.user.id === "user-ana");
    if (history.items[0].kind === "tramo") history.items[0].tramo.functions.at(-1)!.function = "collaborator";
  }
  if (kind === "membership_ended" || kind === "reassigned") {
    const entry = history.items.find(item => item.kind === "tramo" && item.tramo.user.id === "user-diego");
    if (entry?.kind === "tramo") entry.tramo.end_cause = kind;
  }
  render(<TeamHistory history={history} pending={false} onMore={vi.fn()} />);
  expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === sentence)).toBeVisible();
  expect(screen.getAllByRole("listitem")[0].querySelector('[data-slot="item-media"] svg')).not.toBeNull();
});
it("visualizes the saved snapshot in a directly opened Sheet", async () => {
  const client = createFixtureClient("owner");
  render(<SnapshotSheet snapshot={client.snapshot} from="Diego Hernández" to="Ana López" open onOpenChange={vi.fn()} />);
  const sheet = await screen.findByRole("dialog", { name: "Cómo estaba la vacante" });
  expect(within(sheet).getByText("Así estaba la vacante cuando Diego Hernández se la pasó a Ana López. Sirve para saber con qué avance la recibió.")).toBeVisible();
  expect(within(sheet).getByRole("progressbar", { name: "3 de 5 candidatos" })).toHaveAttribute("aria-valuenow", "60");
  expect(within(sheet).getByRole("progressbar", { name: "7 de 12 días hábiles" })).toHaveAttribute("aria-valuenow", String(7 / 12 * 100));
  expect(within(sheet).getByText("Plazo: 20 nov 2026 · propio")).toBeVisible();
  expect(within(sheet).getByText("Fecha compromiso: 30 nov 2026")).toBeVisible();
  for (const label of ["Entrega", "Tiempo utilizado"]) expect(within(sheet).getAllByText(label, { exact: true })).toHaveLength(1);
  expect(within(sheet).getByText("3 de 5 candidatos")).toHaveClass("text-lg");
  expect(within(sheet).getByText("7 de 12 días hábiles")).toHaveClass("text-lg");
  expect(within(sheet).getByRole("progressbar", { name: "En proceso: 3 candidatos" })).toHaveClass("stage-process");
  expect(within(sheet).getByText("Aún no había placements")).toBeVisible();
  expect(within(sheet).getByText("Guardado el 12 nov 2026")).toBeVisible();
  expect(within(sheet).getByRole("button", { name: "Cerrar" })).toBeVisible();
  expect(within(sheet).getByRole("progressbar", { name: "Nuevos: 6 candidatos" })).toBeVisible();
  expect(within(sheet).getByText("Publicada")).toHaveAttribute("data-slot", "badge");
  expect(within(sheet).getByText("Proceso activo")).toHaveAttribute("data-slot", "badge");
  expect(within(sheet).getByText("2 descartados")).toHaveClass("text-muted-foreground");
  expect(sheet.querySelectorAll('[data-slot="card"], [data-slot="accordion"]')).toHaveLength(0);
  expect(sheet.querySelector('[data-slot="sheet-footer"] [data-pf-action-bar]')).not.toBeNull();
});
