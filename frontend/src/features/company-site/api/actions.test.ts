import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("./client", () => ({ getSite: vi.fn(), putDraft: vi.fn(), publishSite: vi.fn(), unpublishSite: vi.fn(), slugAvailability: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import * as client from "./client";
import { loadSiteAction, saveDraftAction, publishSiteAction, unpublishSiteAction, slugAvailabilityAction } from "./actions";
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getActionAccessToken).mockResolvedValue("token"); });
it.each([
  [() => loadSiteAction(), "getSite", ["token"]],
  [() => saveDraftAction({ body: {}, ifMatch: '"1"' }), "putDraft", ["token", { body: {}, ifMatch: '"1"' }]],
  [() => publishSiteAction('"1"'), "publishSite", ["token", '"1"']],
  [() => unpublishSiteAction(), "unpublishSite", ["token"]],
  [() => slugAvailabilityAction("nexo"), "slugAvailability", ["token", "nexo"]],
] as const)("authenticated action delegates once", async (action, method, args) => {
  vi.mocked(client[method]).mockResolvedValue({ kind: "unrecognized" }); expect(await action()).toEqual({ kind: "unrecognized" }); expect(client[method]).toHaveBeenCalledExactlyOnceWith(...args);
});
it("missing session never sends a request", async () => {
  vi.mocked(getActionAccessToken).mockResolvedValue(null); expect(await loadSiteAction()).toEqual({ kind: "unauthenticated" }); expect(client.getSite).not.toHaveBeenCalled();
});
it("thrown requests remain uncertain without retries", async () => {
  vi.mocked(client.unpublishSite).mockRejectedValue(new Error("network")); expect(await unpublishSiteAction()).toEqual({ kind: "uncertain" }); expect(client.unpublishSite).toHaveBeenCalledOnce();
});
