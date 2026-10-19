import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));

// Every runtime export of a "use server" module is a publicly callable Server Action,
// so these modules must export exactly their actions and nothing else.
describe("pipeline server action surface", () => {
  it("exposes only screening, explicit submit and candidate application list actions", async () => {
    expect(Object.keys(await import("@/features/candidate-applications/actions")).sort()).toEqual(["loadApplicationsAction", "loadScreeningAction", "submitApplicationAction"]);
  });
  it("exposes only explicit candidate CV library actions", async () => {
    expect(Object.keys(await import("@/features/candidate-cvs/actions")).sort()).toEqual(["deleteCvAction", "loadCvsAction", "renameCvAction"]);
  });
  it("exposes only the identity read and explicit candidate creation actions", async () => {
    expect(Object.keys(await import("@/features/identity/actions")).sort()).toEqual(["createCandidateAccountAction", "loadMeAction"]);
  });
  it("exposes only publication readiness and publish actions", async () => {
    expect(Object.keys(await import("./publication-actions")).sort()).toEqual(["loadDraftPublicationAction", "publishDraftAction"]);
  });
  it("exposes only explicit delivery reads, preview and save actions", async () => {
    expect(Object.keys(await import("./delivery-actions")).sort()).toEqual(["loadDeliveryStatusAction", "loadDraftDeliveryAction", "previewDraftDeliveryAction", "saveDraftDeliveryAction"]);
    expect(Object.keys(await import("./management-actions")).sort()).toEqual(["loadDraftManagementAction", "saveDraftManagementAction"]);
  });
  it("exposes only the pipeline load and save actions", async () => {
    expect(Object.keys(await import("./actions")).sort()).toEqual(["loadDraftPipelineAction", "saveDraftPipelineAction"]);
  });
  it("exposes only the substate load and save actions", async () => {
    expect(Object.keys(await import("./substates-actions")).sort()).toEqual(["loadDraftSubstatesAction", "saveDraftSubstatesAction"]);
  });
});
