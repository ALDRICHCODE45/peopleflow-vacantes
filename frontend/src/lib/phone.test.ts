import { describe, expect, it } from "vitest";
import { phoneToDraft, phoneValue } from "./phone";

describe("phoneToDraft catalog prefixes", () => {
  it.each([
    ["+593991234567", "+593", "991234567"],
    ["+442079460123", "+44", "2079460123"],
    ["+74951234567", "+7", "4951234567"],
    ["+12125551234", "+1", "2125551234"],
    ["+525512345678", "+52", "5512345678"],
    ["+358401234567", "+358", "401234567"],
    ["55-1234-5678", "+52", "5512345678"],
    ["+52 (55) 1234-5678", "+52", "5512345678"],
  ])("splits %s and preserves the outbound number", (stored, dial, phone) => {
    expect(phoneToDraft(stored)).toEqual({ dial, phone });
    expect(phoneValue(dial, phone)).toBe(stored.replace(/[\s()-]/g, "").replace(/^([0-9]{10})$/, "+52$1"));
  });
  it.each([null, ""])("defaults %s to Mexico", value => {
    expect(phoneToDraft(value)).toEqual({ dial: "+52", phone: "" });
  });
  it.each(["texto libre", "+5255123", "551234", "+99912345678"])("keeps invalid or unassigned %s verbatim", value => {
    expect(phoneToDraft(value)).toEqual({ dial: "", phone: value });
  });
});
