import { describe, expect, expectTypeOf, it } from "vitest";
import {
  COMPENSATION_BASES,
  COMPENSATION_CURRENCIES,
  COMPENSATION_MODES,
  COMPENSATION_MONEY_PATTERN,
  COMPENSATION_PAY_PERIODS,
  compensationSchema,
  createCompensationDefaults,
  normalizeCompensationMoney,
  type Compensation,
  type CompensationInput,
} from "./compensation";

/** Complete, valid compensation object used as the base for overrides. */
const validCompensation = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  mode: "range",
  amount: null,
  min: "30000",
  max: "45000",
  currency: "MXN",
  pay_period: "monthly",
  basis: "gross",
  public_visible: false,
  ...overrides,
});

const parseOk = (input: unknown) => compensationSchema.safeParse(input).success;

const range = (min: unknown, max: unknown) =>
  validCompensation({ mode: "range", amount: null, min, max });

describe("compensation money syntax and normalization", () => {
  it.each([
    ["0", "0.00"],
    ["0.0", "0.00"],
    ["0.00", "0.00"],
    ["5", "5.00"],
    ["5.5", "5.50"],
    ["5.55", "5.55"],
    ["30000", "30000.00"],
    ["999999999999", "999999999999.00"],
    ["999999999999.99", "999999999999.99"],
  ])("normalizes %s to exactly two decimals as %s", (raw, expected) => {
    expect(normalizeCompensationMoney(raw)).toBe(expected);
    const parsed = compensationSchema.parse(range(raw, raw));
    expect(parsed.min).toBe(expected);
    expect(parsed.max).toBe(expected);
  });

  it.each([
    "",
    " ",
    " 1",
    "1 ",
    "1\n",
    "\t1",
    "1\t",
    "\u00a01",
    "1\u3000",
    "01",
    "00",
    "1.",
    ".5",
    "1.234",
    "1.2.3",
    "-1",
    "+1",
    "-0",
    "-0.00",
    "1e3",
    "1E3",
    "0x10",
    "1,000",
    "1_000",
    "0.00 ",
    "9999999999999",
    "1000000000000.00",
  ])("rejects non-contract money %j without trimming or rounding", (raw) => {
    expect(COMPENSATION_MONEY_PATTERN.test(raw)).toBe(false);
    expect(parseOk(range(raw, null))).toBe(false);
  });

  it("rejects JSON numbers and accepts null amounts", () => {
    for (const numeric of [0, 1, 30000, 30000.5, Number.MAX_SAFE_INTEGER]) {
      expect(parseOk(range(numeric, null))).toBe(false);
    }
    expect(parseOk(range(null, null))).toBe(true);
  });
});

describe("compensation strict shape", () => {
  it("accepts one complete non-null object and rejects null, undefined, empty and arrays", () => {
    expect(parseOk(validCompensation())).toBe(true);
    for (const whole of [null, undefined, {}, []]) {
      expect(parseOk(whole)).toBe(false);
    }
  });

  it.each(Object.keys(validCompensation()))("rejects a missing %s key", (key) => {
    const partial = validCompensation();
    delete partial[key];
    expect(parseOk(partial)).toBe(false);
  });

  it("rejects unknown keys and requires a literal boolean public_visible", () => {
    expect(parseOk(validCompensation({ foo: 1 }))).toBe(false);
    expect(parseOk(validCompensation({ publicVisible: false }))).toBe(false);
    for (const value of [true, false]) {
      expect(parseOk(validCompensation({ public_visible: value }))).toBe(true);
    }
    for (const value of ["false", "true", 0, 1, null, undefined]) {
      expect(parseOk(validCompensation({ public_visible: value }))).toBe(false);
    }
  });

  it("preserves currency, pay period, basis and visibility verbatim", () => {
    const parsed = compensationSchema.parse(
      validCompensation({
        currency: "USD",
        pay_period: "semimonthly",
        basis: "net",
        public_visible: true,
      }),
    );
    expect(parsed).toMatchObject({
      currency: "USD",
      pay_period: "semimonthly",
      basis: "net",
      public_visible: true,
    });
  });

  it("accepts every literal including null", () => {
    for (const mode of [null, ...COMPENSATION_MODES]) {
      const amounts =
        mode === "range"
          ? { amount: null, min: "30000", max: "45000" }
          : mode === "fixed"
            ? { amount: "30000", min: null, max: null }
            : { amount: null, min: null, max: null };
      expect(parseOk(validCompensation({ mode, ...amounts }))).toBe(true);
    }
    for (const currency of [null, ...COMPENSATION_CURRENCIES]) {
      expect(parseOk(validCompensation({ currency }))).toBe(true);
    }
    for (const pay_period of [null, ...COMPENSATION_PAY_PERIODS]) {
      expect(parseOk(validCompensation({ pay_period }))).toBe(true);
    }
    for (const basis of [null, ...COMPENSATION_BASES]) {
      expect(parseOk(validCompensation({ basis }))).toBe(true);
    }
  });

  it.each([
    ["mode", "Fixed"],
    ["mode", "RANGE"],
    ["mode", ""],
    ["mode", 1],
    ["currency", "mxn"],
    ["currency", "EUR"],
    ["currency", ""],
    ["pay_period", "biweekly"],
    ["pay_period", "quincenal"],
    ["pay_period", ""],
    ["basis", "neto"],
    ["basis", ""],
  ])("rejects invalid %s value %j", (key, value) => {
    expect(parseOk(validCompensation({ [key]: value }))).toBe(false);
  });
});

describe("compensation conditional mode shape", () => {
  const fixed = (overrides: Record<string, unknown> = {}) =>
    validCompensation({ mode: "fixed", amount: "30000", min: null, max: null, ...overrides });
  const none = (overrides: Record<string, unknown> = {}) =>
    validCompensation({ mode: null, amount: null, min: null, max: null, ...overrides });

  it("fixed rejects bounds and allows a null amount", () => {
    expect(parseOk(fixed())).toBe(true);
    expect(parseOk(fixed({ amount: null }))).toBe(true);
    expect(parseOk(fixed({ min: "1" }))).toBe(false);
    expect(parseOk(fixed({ max: "1" }))).toBe(false);
    expect(parseOk(fixed({ min: "1", max: "2" }))).toBe(false);
  });

  it("range rejects amount and allows any bound combination", () => {
    expect(parseOk(range(null, null))).toBe(true);
    expect(parseOk(range("30000", null))).toBe(true);
    expect(parseOk(range(null, "45000"))).toBe(true);
    expect(parseOk(validCompensation({ mode: "range", amount: "30000" }))).toBe(false);
  });

  it("null mode rejects every amount", () => {
    expect(parseOk(none())).toBe(true);
    expect(parseOk(none({ amount: "1" }))).toBe(false);
    expect(parseOk(none({ min: "1" }))).toBe(false);
    expect(parseOk(none({ max: "1" }))).toBe(false);
  });

  it("compares bounds exactly only when both are present, beyond 32-bit range", () => {
    expect(parseOk(range("30000", "45000"))).toBe(true);
    expect(parseOk(range("45000", "30000"))).toBe(false);
    expect(parseOk(range("30000", "30000"))).toBe(true);
    expect(parseOk(range("999999999999.98", "999999999999.99"))).toBe(true);
    expect(parseOk(range("999999999999.99", "999999999999.98"))).toBe(false);
    expect(parseOk(range("4294967296.00", "4294967296.01"))).toBe(true);
    expect(parseOk(range("4294967296.01", "4294967296.00"))).toBe(false);
    expect(parseOk(range("999999999999.99", null))).toBe(true);
    expect(parseOk(range(null, "0"))).toBe(true);
  });
});

describe("createCompensationDefaults", () => {
  const DEFAULTS = {
    mode: null,
    amount: null,
    min: null,
    max: null,
    currency: "MXN",
    pay_period: "monthly",
    basis: null,
    public_visible: false,
  };

  it("returns the documented POST omission default and validates against the schema", () => {
    const defaults = createCompensationDefaults();
    expect(defaults).toEqual(DEFAULTS);
    expect(parseOk(defaults)).toBe(true);
    expect(compensationSchema.parse(defaults)).toEqual(defaults);
  });

  it("returns a fresh mutable object on every call", () => {
    const first = createCompensationDefaults();
    const second = createCompensationDefaults();
    expect(first).not.toBe(second);
    first.public_visible = true;
    first.currency = "USD";
    expect(second.public_visible).toBe(false);
    expect(second.currency).toBe("MXN");
    expect(createCompensationDefaults()).toEqual(DEFAULTS);
  });
});

describe("compensation types", () => {
  it("keeps input raw and output money as strings", () => {
    expectTypeOf<CompensationInput["amount"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Compensation["amount"]>().toEqualTypeOf<string | null>();
    expectTypeOf<Compensation["public_visible"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Compensation["pay_period"]>().toEqualTypeOf<
      (typeof COMPENSATION_PAY_PERIODS)[number] | null
    >();
  });
});
