import { beforeEach, expect, it, vi } from "vitest";
import { notFound, redirect } from "next/navigation";
import Page from "./page";
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
  redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT"); }),
}));
const id = "123e4567-e89b-42d3-a456-426614174000";
beforeEach(() => vi.clearAllMocks());
it("redirects a valid vacancy to the first configuration module", async () => {
  await expect(Page({ params: Promise.resolve({ jobId: id }) })).rejects.toThrow("NEXT_REDIRECT");
  expect(redirect).toHaveBeenCalledExactlyOnceWith(`/empresa/vacantes/${id}/configuracion/columnas`);
  expect(notFound).not.toHaveBeenCalled();
});
it.each(["bad", "../nuevo", "", "backend-developer-senior"])("rejects invalid UUID %j before redirecting", async jobId => {
  await expect(Page({ params: Promise.resolve({ jobId }) })).rejects.toThrow("NEXT_NOT_FOUND");
  expect(notFound).toHaveBeenCalledOnce();
  expect(redirect).not.toHaveBeenCalled();
});
