// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { getDraftV2 } from "../api/client-v2";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { loadDraftForEditAction } from "./load";
import { filledDraftRead } from "./test-fixture";
import { draftEditSeedFromRead } from "./seed";
vi.mock("../api/client-v2", () => ({ getDraftV2: vi.fn() }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
const read = filledDraftRead();
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getActionAccessToken).mockResolvedValue("synthetic-access");
  vi.mocked(getDraftV2).mockResolvedValue({ok:true,data:read,etag:'"opaque-get"'});
});
it("returns the detail GET seed and opaque ETag without credentials", async () => {
  const result = await loadDraftForEditAction(read.id);
  expect(getDraftV2).toHaveBeenCalledExactlyOnceWith({token:"synthetic-access",id:read.id});
  expect(result).toEqual({ok:true,seed:draftEditSeedFromRead(read),identity:{draftId:read.id,etag:'"opaque-get"'}});
  expect(JSON.stringify(result)).not.toContain("synthetic-access");
});
it.each(["bad", "", "../nuevo"])("rejects invalid id %j before reading the session", async id => {
  expect(await loadDraftForEditAction(id)).toEqual({ok:false,reason:"invalid_id"});
  expect(getActionAccessToken).not.toHaveBeenCalled();
  expect(getDraftV2).not.toHaveBeenCalled();
});
it.each([null, "", "   "])("fails closed without a usable session (%j)", async token => {
  vi.mocked(getActionAccessToken).mockResolvedValue(token);
  expect(await loadDraftForEditAction(read.id)).toEqual({ok:false,reason:"unauthenticated"});
  expect(getDraftV2).not.toHaveBeenCalled();
});
it.each([
  ["not_found",404,"not_found","not_found"],
  ["status",401,"unauthenticated","unauthenticated"],
  ["status",403,"forbidden","forbidden"],
  ["status",403,"company_inactive","company_inactive"],
  ["status",409,"company_not_active","company_not_active"],
  ["status",500,"internal_error","server_error"],
  ["status",502,undefined,"server_error"],
  ["network",undefined,undefined,"no_response"],
  ["timeout",undefined,undefined,"no_response"],
  ["invalid_response",undefined,undefined,"unrecognized_response"],
  ["missing_token",undefined,undefined,"unauthenticated"],
  ["status",403,"unknown","unrecognized_response"],
  ["status",409,"forbidden","unrecognized_response"],
] as const)("maps %s/%s/%s to %s without exposing server text", async (kind,status,code,reason) => {
  vi.mocked(getDraftV2).mockResolvedValue({ok:false,error:{kind,retryable:false,...(status && {status})},...(code && {envelope:{code,error:"private server text synthetic-access"}})} as Awaited<ReturnType<typeof getDraftV2>>);
  expect(await loadDraftForEditAction(read.id)).toEqual({ok:false,reason});
});
it("collapses unexpected transport exceptions without leaking them", async () => {
  vi.mocked(getDraftV2).mockRejectedValue(new Error("synthetic-access"));
  expect(await loadDraftForEditAction(read.id)).toEqual({ok:false,reason:"no_response"});
});
it("handles a thrown token resolver without returning credentials or making a GET", async () => {
  vi.mocked(getActionAccessToken).mockRejectedValue(new Error("synthetic-access private session text"));
  expect(await loadDraftForEditAction(read.id)).toEqual({ok:false,reason:"no_response"});
  expect(getDraftV2).not.toHaveBeenCalled();
});
