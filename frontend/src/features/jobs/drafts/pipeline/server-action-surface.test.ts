import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));

// Every runtime export of a "use server" module is a publicly callable Server Action,
// so these modules must export exactly their actions and nothing else.
describe("pipeline server action surface", () => {
  it("exposes only publication readiness and publish actions", async () => {
    expect(Object.keys(await import("./publication-actions")).sort()).toEqual(["loadDraftPublicationAction", "publishDraftAction"]);
  });
  it("exposes only the delivery load and save actions", async () => {
    expect(Object.keys(await import("./delivery-actions")).sort()).toEqual(["loadDraftDeliveryAction", "saveDraftDeliveryAction"]);
    expect(Object.keys(await import("./management-actions")).sort()).toEqual(["loadDraftManagementAction", "saveDraftManagementAction"]);
  });
  it("exposes only the pipeline load and save actions", async () => {
    expect(Object.keys(await import("./actions")).sort()).toEqual(["loadDraftPipelineAction", "saveDraftPipelineAction"]);
  });
  it("exposes only the substate load and save actions", async () => {
    expect(Object.keys(await import("./substates-actions")).sort()).toEqual(["loadDraftSubstatesAction", "saveDraftSubstatesAction"]);
  });
});
