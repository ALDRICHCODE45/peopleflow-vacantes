import { describe, expect, it } from "vitest";
import { duplicatesSchema } from "./model";

// Exact duplicates-check response from the backend contract (odd/tasks/recruiter-manual-intake-ui.md, L9 item 6).
const backendExample = {
  matches: [
    { kind: "manual", id: "7d1e0c2a-1b2c-4d3e-8f9a-0b1c2d3e4f50", full_name: "Ana Pérez", email_masked: "a***@ejemplo.com", phone_masked: "+52 •••• ••56 78", last_vacancy: { id: "9a1e0c2a-1b2c-4d3e-8f9a-0b1c2d3e4f51", title: "Backend Go" }, last_added_at: "2026-10-01T15:00:00Z", in_this_process: false },
    { kind: "organic", id: "8e1e0c2a-1b2c-4d3e-8f9a-0b1c2d3e4f52", full_name: "Ana P. López", email_masked: "a***@ejemplo.com", phone_masked: null, last_vacancy: null, last_added_at: "2026-09-12T10:00:00Z", in_this_process: true },
  ],
};

describe("duplicates-check contract", () => {
  it("decodes the backend example, where last_vacancy is an {id, title} object or null", () => {
    expect(duplicatesSchema.safeParse(backendExample).success).toBe(true);
  });
  it("rejects a bare string last_vacancy and extra keys", () => {
    const [first] = backendExample.matches;
    expect(duplicatesSchema.safeParse({ matches: [{ ...first, last_vacancy: "Backend Go" }] }).success).toBe(false);
    expect(duplicatesSchema.safeParse({ matches: [{ ...first, last_vacancy: { ...first.last_vacancy, extra: 1 } }] }).success).toBe(false);
  });
});
