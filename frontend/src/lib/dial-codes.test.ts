import { describe, expect, it } from "vitest";
import { countryForDial, DIAL_CODES } from "./dial-codes";

describe("country calling-code catalog", () => {
  it("has one entry per ISO country, Spanish ordering and Mexico first", () => {
    expect(DIAL_CODES[0]).toEqual({ country: "MX", name: "México", dial: "+52" });
    expect(DIAL_CODES.length).toBeGreaterThanOrEqual(240);
    expect(new Set(DIAL_CODES.map(item => item.country)).size).toBe(DIAL_CODES.length);
    for (const item of DIAL_CODES) {
      expect(item.country).toMatch(/^[A-Z]{2}$/);
      expect(item.dial).toMatch(/^\+[1-9]\d{0,3}$/);
      expect(item.name).not.toBe("");
    }
    const names = DIAL_CODES.slice(1).map(item => item.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "es")));
  });
  it.each([["+52", "MX"], ["+1", "US"], ["+7", "RU"], ["+44", "GB"], ["+593", "EC"], ["+247", "AC"], ["+383", "XK"]])("loads %s under its preferred or first country %s", (dial, country) => {
    expect(countryForDial(dial)?.country).toBe(country);
  });
  it("does not invent a country for empty or unassigned dials", () => {
    expect(countryForDial("")).toBeNull();
    expect(countryForDial("+999")).toBeNull();
  });
  it("keeps shared codes as distinct countries", () => {
    for (const country of ["US", "CA", "PR", "DO"]) expect(DIAL_CODES.find(item => item.country === country)?.dial).toBe("+1");
    for (const country of ["GB", "GG", "JE", "IM"]) expect(DIAL_CODES.find(item => item.country === country)?.dial).toBe("+44");
    for (const country of ["RU", "KZ"]) expect(DIAL_CODES.find(item => item.country === country)?.dial).toBe("+7");
  });
});
