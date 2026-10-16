import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
vi.mock("./client", () => ({ getDraftPipeline: vi.fn(), saveDraftPipeline: vi.fn() }));

import { getActionAccessToken } from "@/lib/auth/action-session";
import { getDraftPipeline, saveDraftPipeline } from "./client";
import { loadDraftPipelineAction, saveDraftPipelineAction } from "./actions";

const draftId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const etag = '"opaque-tag"';
const body = { stages: [{ name: "Prueba" }], exit: { id: draftId, name: "Descartados" } };
const pipeline = {
  version: "0",
  stages: [{ id: draftId, kind: "new" as const, name: "Nuevos" }],
  exit: { id: draftId, kind: "discarded" as const, name: "Descartados" },
  limits: { maxCustomStages: 3, nameMaxLength: 40 },
};
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getActionAccessToken).mockResolvedValue("secret"); });

for (const operation of ["load", "save"] as const) {
  describe(operation, () => {
    const client = operation === "load" ? getDraftPipeline : saveDraftPipeline;
    const call = () => operation === "load"
      ? loadDraftPipelineAction(draftId)
      : saveDraftPipelineAction({ draftId, ifMatch: etag, body });

    it.each([null, "", "   "])("does not call client without token (%s)", async token => {
      vi.mocked(getActionAccessToken).mockResolvedValue(token);
      expect(await call()).toEqual({ ok: false, reason: "unauthenticated", reference: {} });
      expect(getDraftPipeline).not.toHaveBeenCalled();
      expect(saveDraftPipeline).not.toHaveBeenCalled();
    });

    it("returns the pipeline and opaque ETag and passes explicit credentials", async () => {
      vi.mocked(client).mockResolvedValue({ ok: true, data: pipeline, etag });
      expect(await call()).toEqual({ ok: true, pipeline, etag });
      expect(client).toHaveBeenCalledExactlyOnceWith({
        token: "secret", draftId, ...(operation === "save" ? { ifMatch: etag, body } : {}),
      });
    });

    it.each([
      [400, "invalid_request", "invalid_request"],
      [400, "validation_error", "validation_error"],
      [400, "non_business_date", "non_business_date"],
      [409, "cutoff_stage_in_use", "cutoff_stage_in_use"],
      [409, "non_business_date", "unrecognized_response"],
      [400, "cutoff_stage_in_use", "unrecognized_response"],
      [401, "unauthenticated", "unauthenticated"],
      [403, "forbidden", "forbidden"],
      [403, "company_inactive", "company_inactive"],
      [404, "not_found", "not_found"],
      [409, "company_not_active", "company_not_active"],
      [412, "version_conflict", "version_conflict"],
      [428, "precondition_required", "precondition_required"],
      [413, "payload_too_large", "payload_too_large"],
      [500, "internal_error", "server_error"],
      [599, "internal_error", "server_error"],
      [400, "forbidden", "unrecognized_response"],
      [409, "invalid_request", "unrecognized_response"],
      [418, "internal_error", "unrecognized_response"],
    ] as const)("maps %s %s safely", async (status, code, reason) => {
      vi.mocked(client).mockResolvedValue({
        ok: false, error: { kind: "status", status, retryable: false },
        envelope: { error: "unsafe secret", code },
      });
      const result = await call();
      expect(result).toEqual({ ok: false, reason, reference: { status, code } });
      expect(JSON.stringify(result)).not.toMatch(/unsafe|secret/);
      expect(client).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["missing_token", "unauthenticated"], ["invalid_request", "invalid_request"],
      ["network", "no_response"], ["timeout", "no_response"],
      ["invalid_response", "unrecognized_response"],
    ] as const)("maps local/transport %s", async (kind, reason) => {
      vi.mocked(client).mockResolvedValue({ ok: false, error: { kind, retryable: false } });
      expect(await call()).toEqual({ ok: false, reason, reference: {} });
      expect(client).toHaveBeenCalledTimes(1);
    });

    it("maps the not_found transport classification", async () => {
      vi.mocked(client).mockResolvedValue({ ok: false, error: { kind: "not_found", status: 404, retryable: false } });
      expect(await call()).toEqual({ ok: false, reason: "not_found", reference: { status: 404 } });
    });

    it.each([
      [400, "unrecognized_response"], [401, "unauthenticated"], [403, "forbidden"],
      [404, "not_found"], [409, "unrecognized_response"], [412, "version_conflict"],
      [413, "payload_too_large"], [428, "precondition_required"], [500, "server_error"],
    ] as const)("classifies status %s without an envelope", async (status, reason) => {
      vi.mocked(client).mockResolvedValue({ ok: false, error: { kind: "status", status, retryable: false } });
      expect(await call()).toEqual({ ok: false, reason, reference: { status } });
    });

    it("never forwards unknown backend codes or messages", async () => {
      vi.mocked(client).mockResolvedValue({
        ok: false, error: { kind: "status", status: 418, retryable: false },
        envelope: { error: "unsafe message", code: "unsafe code" },
      });
      expect(await call()).toEqual({ ok: false, reason: "unrecognized_response", reference: { status: 418 } });
    });

    it("maps a thrown client error to no_response without retry or details", async () => {
      vi.mocked(client).mockRejectedValue(new Error("unsafe secret"));
      expect(await call()).toEqual({ ok: false, reason: "no_response", reference: {} });
      expect(client).toHaveBeenCalledTimes(1);
    });

    it("maps a thrown session error to no_response without calling the client", async () => {
      vi.mocked(getActionAccessToken).mockRejectedValue(new Error("unsafe secret"));
      expect(await call()).toEqual({ ok: false, reason: "no_response", reference: {} });
      expect(client).not.toHaveBeenCalled();
    });
  });
}
