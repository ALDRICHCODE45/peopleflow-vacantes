import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ConfigLifecycleProvider } from "./lifecycle";
import { PipelineStageEditor } from "../stage-config/editor";
import { DeliveryEditor } from "../delivery-config/editor";
import { ManagementEditor } from "../management-config/editor";
import { SubstatesSheet } from "../substates-config/sheet";
import { pipelineFixture } from "../stage-config/test-fixture";
import { deliveryFixture } from "../delivery-config/test-fixture";
import { managementFixture } from "../management-config/test-fixture";
import { populatedSubstates } from "../substates-config/test-fixture";
import { activeLifecycle, finishedLifecycle } from "@/features/jobs/drafts/lifecycle-fixture";
import { saveDraftPipelineAction, previewPipelineAction } from "@/features/jobs/drafts/pipeline/actions";
import { saveDraftDeliveryAction, previewDraftDeliveryAction } from "@/features/jobs/drafts/pipeline/delivery-actions";
import { saveDraftManagementAction } from "@/features/jobs/drafts/pipeline/management-actions";
import { saveDraftSubstatesAction } from "@/features/jobs/drafts/pipeline/substates-actions";
// Base UI menu-to-Sheet focus restoration loops in jsdom; keep the real row,
// and invoke its callback at the same boundary as substates-integration.test.tsx.
const boundary = vi.hoisted(() => ({ open: undefined as (() => void) | undefined }));
vi.mock("../stage-config/stage-row", async importOriginal => {
  const actual = await importOriginal<typeof import("../stage-config/stage-row")>();
  return { ...actual, StageRow: (props: Parameters<typeof actual.StageRow>[0]) => {
    if (props.stage.kind === "in_process") boundary.open = props.onSubstates;
    return <actual.StageRow {...props} />;
  } };
});
vi.mock("@/components/feedback/notify", () => ({ notifyActionResult: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/actions", () => ({ loadDraftPipelineAction: vi.fn(), saveDraftPipelineAction: vi.fn(), previewPipelineAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/delivery-actions", () => ({ loadDraftDeliveryAction: vi.fn(), saveDraftDeliveryAction: vi.fn(), previewDraftDeliveryAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/management-actions", () => ({ loadDraftManagementAction: vi.fn(), saveDraftManagementAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/substates-actions", () => ({ loadDraftSubstatesAction: vi.fn(), saveDraftSubstatesAction: vi.fn() }));
const message = "El proceso de esta vacante finalizó. La configuración está en solo lectura.";
const failure = { ok: false, reason: "process_finished", lifecycle: finishedLifecycle, reference: { status: 409, code: "process_finished" } } as const;
const props = { draftId: "test", etag: '"tag"' };
const mounts = {
  columns: (lifecycle = activeLifecycle, locked = false) => render(<PipelineStageEditor {...props} lifecycle={lifecycle} pipeline={{ ...pipelineFixture(), structure_locked: locked }} />),
  delivery: (lifecycle = activeLifecycle) => render(<DeliveryEditor {...props} lifecycle={lifecycle} delivery={deliveryFixture()} stages={pipelineFixture().stages} />),
  management: (lifecycle = activeLifecycle) => render(<ManagementEditor {...props} lifecycle={lifecycle} management={managementFixture()} />),
  substates: (lifecycle = activeLifecycle) => render(<SubstatesSheet {...props} lifecycle={lifecycle} catalog={populatedSubstates()} inProcessName="En proceso" open onOpenChange={vi.fn()} onSaved={vi.fn()} />),
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(saveDraftPipelineAction).mockResolvedValue(failure);
  vi.mocked(previewPipelineAction).mockResolvedValue(failure);
  vi.mocked(saveDraftDeliveryAction).mockResolvedValue(failure);
  vi.mocked(previewDraftDeliveryAction).mockResolvedValue({ ok: false, reason: "vacancy_not_published", reference: {} });
  vi.mocked(saveDraftManagementAction).mockResolvedValue(failure);
  vi.mocked(saveDraftSubstatesAction).mockResolvedValue(failure);
});
afterEach(cleanup);
for (const [name, mount] of Object.entries(mounts)) {
  it(`${name} is read-only when finished`, () => {
    mount(finishedLifecycle);
    expect(screen.getAllByText(message)).toHaveLength(1);
    for (const input of screen.getAllByRole("textbox")) expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: name === "substates" ? "Guardar subestados" : "Guardar cambios" })).toBeDisabled();
  });
  it.each(["paused", "closed"] as const)(`${name} remains editable when %s and active`, publication => {
    mount({ ...activeLifecycle, publication });
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    expect(screen.getAllByRole("textbox")[0]).toBeEnabled();
  });
}
it("hides the structural impact hint for finished processes", () => {
  mounts.columns(finishedLifecycle, true);
  expect(screen.queryByText(/Esta vacante ya tiene candidatos/)).not.toBeInTheDocument();
});
it.each([false, true])("columns switch on %s preview/write rejection", async locked => {
  mounts.columns(activeLifecycle, locked);
  fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "Entrada" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  if (!locked) fireEvent.click(await screen.findByRole("button", { name: "Guardar" }));
  await screen.findByText(message);
  expect(screen.getAllByRole("textbox")[0]).toBeDisabled();
  expect(locked ? previewPipelineAction : saveDraftPipelineAction).toHaveBeenCalledTimes(1);
});
it.each(["delivery", "management", "substates"] as const)("%s switches on write rejection", async name => {
  mounts[name]();
  const input = name === "delivery" ? screen.getByRole("textbox", { name: "Objetivo de entrega" }) : name === "management" ? screen.getByRole("textbox", { name: "Plazas a cubrir" }) : screen.getAllByRole("textbox").find(input => (input as HTMLInputElement).value === "Primera entrevista")!;
  fireEvent.change(input, { target: { value: name === "substates" ? "Entrevista inicial" : "5" } });
  fireEvent.click(screen.getByRole("button", { name: name === "substates" ? "Guardar subestados" : "Guardar cambios" }));
  await waitFor(() => expect(screen.getByText(message)).toBeVisible());
  expect(input).toBeDisabled();
  expect(name === "delivery" ? saveDraftDeliveryAction : name === "management" ? saveDraftManagementAction : saveDraftSubstatesAction).toHaveBeenCalledTimes(1);
});
it("shares a newer pipeline lifecycle with subsequent tabs without another request", async () => {
  const { rerender } = render(<ConfigLifecycleProvider lifecycle={activeLifecycle}><PipelineStageEditor {...props} lifecycle={finishedLifecycle} pipeline={pipelineFixture()} /></ConfigLifecycleProvider>);
  expect(screen.getByText(message)).toBeVisible();
  rerender(<ConfigLifecycleProvider lifecycle={activeLifecycle}><ManagementEditor {...props} management={managementFixture()} /></ConfigLifecycleProvider>);
  expect(screen.getByRole("textbox", { name: "Plazas a cubrir" })).toBeDisabled();
  expect(screen.getByText(message)).toBeVisible();
});
it("keeps substates available to read and close when columns are finished", async () => {
  render(<PipelineStageEditor {...props} lifecycle={finishedLifecycle} pipeline={pipelineFixture()} substates={populatedSubstates()} substatesEtag='"substates"' />);
  expect(screen.getByRole("button", { name: "Acciones de En proceso" })).toBeEnabled();
  act(() => boundary.open?.());
  expect(screen.getAllByText(message)).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Guardar subestados" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cerrar subestados" }));
  expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
  expect(screen.getAllByText(message)).toHaveLength(1);
});
it("delivery also stops before PUT on a process-finished preview", async () => {
  vi.mocked(previewDraftDeliveryAction).mockResolvedValue(failure);
  mounts.delivery();
  fireEvent.change(screen.getByRole("textbox", { name: "Objetivo de entrega" }), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await screen.findByText(message);
  expect(saveDraftDeliveryAction).not.toHaveBeenCalled();
  expect(screen.getByRole("combobox", { name: "Columna de corte" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Fecha compromiso" })).toBeDisabled();
});
