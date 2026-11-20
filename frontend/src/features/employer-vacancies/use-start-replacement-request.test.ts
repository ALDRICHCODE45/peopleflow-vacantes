import { expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useStartReplacementRequest } from "./use-start-replacement-request";

it("remembers which draft (and credit) asked to start a replacement, until closed", () => {
  const { result } = renderHook(() => useStartReplacementRequest());
  expect(result.current.request).toBeNull();
  act(() => result.current.open("draft-1", "credit-1"));
  expect(result.current.request).toEqual({ draftId: "draft-1", creditId: "credit-1" });
  act(() => result.current.open("draft-2"));
  expect(result.current.request).toEqual({ draftId: "draft-2" });
  act(() => result.current.close());
  expect(result.current.request).toBeNull();
});
