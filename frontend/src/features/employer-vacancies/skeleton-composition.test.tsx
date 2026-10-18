import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DeliverySkeleton } from "./delivery-config/loading";
import { ManagementSkeleton } from "./management-config/loading";
import { PipelineEditorSkeleton } from "./stage-config/loading";
import { DeliveryEditor } from "./delivery-config/editor";
import { ManagementEditor } from "./management-config/editor";
import { PipelineStageEditor } from "./stage-config/editor";
import { deliveryFixture } from "./delivery-config/test-fixture";
import { managementFixture } from "./management-config/test-fixture";
import { pipelineFixture } from "./stage-config/test-fixture";
vi.mock("@/features/jobs/drafts/pipeline/actions", () => ({ loadDraftPipelineAction: vi.fn(), saveDraftPipelineAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/delivery-actions", () => ({ loadDraftDeliveryAction: vi.fn(), saveDraftDeliveryAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/management-actions", () => ({ loadDraftManagementAction: vi.fn(), saveDraftManagementAction: vi.fn() }));
vi.mock("@/features/jobs/drafts/pipeline/substates-actions", () => ({ loadDraftSubstatesAction: vi.fn(), saveDraftSubstatesAction: vi.fn() }));
afterEach(cleanup);
const cardSlots = (root: Element) => [...root.querySelectorAll('[data-slot^="card"]')].map(node => node.getAttribute("data-slot"));
it.each([
  ["delivery", <DeliverySkeleton key="loading" />, <DeliveryEditor key="loaded" draftId="draft" delivery={deliveryFixture()} etag={'"v1"'} stages={pipelineFixture().stages} />, 3],
  ["management", <ManagementSkeleton key="loading" />, <ManagementEditor key="loaded" draftId="draft" management={managementFixture()} etag={'"v1"'} />, 2],
] as const)("mirrors the loaded %s card and field slots", (_name, loading, loaded, fields) => {
  const skeleton = render(loading);
  const real = render(loaded);
  expect(cardSlots(skeleton.container)).toEqual(cardSlots(real.container));
  expect(skeleton.container.querySelectorAll('[data-slot="field"]')).toHaveLength(fields);
  expect(skeleton.container.querySelectorAll('[data-slot="field-label"]')).toHaveLength(fields);
  expect(skeleton.container.querySelectorAll('[data-slot="field-description"]')).toHaveLength(fields);
  expect(skeleton.container.querySelectorAll('[data-slot="card-footer"] [data-slot="skeleton"]')).toHaveLength(2);
});
it("mirrors the stage editor, Item rows, exit section and all default preview cards", () => {
  const skeleton = render(<PipelineEditorSkeleton />);
  const real = render(<PipelineStageEditor draftId="draft" pipeline={pipelineFixture()} etag={'"v1"'} />);
  expect(cardSlots(skeleton.container)).toEqual(cardSlots(real.container));
  expect(skeleton.container.querySelectorAll('[data-slot="item"]')).toHaveLength(6);
  expect(skeleton.container.querySelectorAll('[data-slot="item-content"] [data-slot="field"]')).toHaveLength(6);
  expect(skeleton.container.querySelectorAll('[data-slot="separator"]')).toHaveLength(real.container.querySelectorAll('[data-slot="separator"]').length);
});
