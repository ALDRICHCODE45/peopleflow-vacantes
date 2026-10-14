import { describe, expect, it } from "vitest";

import { draftPostBodySchema } from "./fields";
import { draftReadEnvelopeSchema } from "./read";

const ID = "123e4567-e89b-42d3-a456-426614174000";
const timestamp = "2026-10-06T03:00:00.123456Z";
const rich = () => ({ schema_version: 1, document: { type: "doc", content: [{ type: "paragraph" }] } });
const response = () => ({
  schema_version: 1, id: ID, status: "draft", principal_recruiter_id: ID,
  version: "1", created_at: timestamp, updated_at: timestamp,
  fields: { ...draftPostBodySchema.parse({ fields: {} }).fields, description_plain: null as string | null },
});

function rejects(input: unknown) {
  const before = structuredClone(input);
  expect(draftReadEnvelopeSchema.safeParse(input).success).toBe(false);
  expect(input).toStrictEqual(before);
}

describe("complete private draft read envelope", () => {
  it("accepts a complete empty draft without mutation or additional defaults", () => {
    const input = response();
    const before = structuredClone(input);
    expect(draftReadEnvelopeSchema.parse(input)).toStrictEqual(before);
    expect(input).toStrictEqual(before);
  });

  it.each(Object.keys(response()))("requires envelope key %s", (key) => {
    const input: Record<string, unknown> = response();
    delete input[key];
    rejects(input);
  });

  it.each(Object.keys(response().fields))("requires fields.%s without POST defaults", (key) => {
    const fields: Record<string, unknown> = { ...response().fields };
    delete fields[key];
    rejects({ ...response(), fields });
    rejects({ ...response(), fields: { ...fields, [key]: undefined } });
  });

  it.each(["actor", "organization", "created_by", "ETag", "unknown"])("rejects extra envelope key %s", (key) => {
    rejects({ ...response(), [key]: "extra" });
  });

  it.each(["employmentType", "closingDate", "wizardStep", "department", "unknown"])("rejects extra field %s", (key) => {
    rejects({ ...response(), fields: { ...response().fields, [key]: "extra" } });
  });

  it.each([
    { schema_version: "1" }, { schema_version: 2 }, { status: "published" },
    { id: "not-an-id" }, { principal_recruiter_id: "not-an-id" },
    { fields: null }, { fields: [] },
  ])("rejects invalid metadata %#", (patch) => rejects({ ...response(), ...patch }));

  it.each([0, 1, null, "", "0", "01", "-1", "+1", "1.0", "1e2", " 1", "1 ", "1\n", "١"])(
    "rejects invalid version %j", (version) => rejects({ ...response(), version }),
  );

  it("retains a version larger than Number.MAX_SAFE_INTEGER exactly", () => {
    const input = { ...response(), version: "90071992547409931234567890" };
    expect(draftReadEnvelopeSchema.parse(input)).toStrictEqual(input);
  });

  it.each([
    "2026-10-06T03:00:00Z", "2026-10-06T03:00:00.123Z", "2026-10-06T03:00:00.1234567Z",
    "2026-10-06T03:00:00.123456+00:00", "2026-10-06T03:00:00.123456-06:00",
    "2026-02-29T03:00:00.123456Z", "2026-13-01T03:00:00.123456Z",
    "2026-10-06T24:00:00.123456Z", "2026-10-06T03:60:00.123456Z", timestamp + "\n",
  ])("rejects invalid UTC microsecond timestamps %s", (value) => {
    rejects({ ...response(), created_at: value });
    rejects({ ...response(), updated_at: value });
  });

  it("accepts leap-day timestamps without inventing chronological ordering", () => {
    const input = { ...response(), updated_at: "2024-02-29T00:00:00.000000Z" };
    expect(draftReadEnvelopeSchema.parse(input)).toStrictEqual(input);
  });
});

describe("server-derived read fields", () => {
  it("accepts and preserves required nullable requester name", () => {
    for (const name of [null, "  Área\u0301\uFEFF  ", "😀".repeat(160)]) {
      const input = { ...response(), fields: { ...response().fields, requester: { kind: "client", id: null, name } } };
      expect(draftReadEnvelopeSchema.parse(input)).toStrictEqual(input);
    }
  });

  it.each([
    { kind: "client", id: null }, { kind: "client", id: null, name: undefined },
    { kind: "client", id: null, name: 4 }, { kind: "client", id: null, name: "😀".repeat(161) },
    { kind: "client", name: null }, { kind: "unknown", id: null, name: null },
    { kind: "client", id: "bad", name: null }, { kind: "client", id: null, name: null, extra: true },
  ])("rejects incomplete or invalid read requester %#", (requester) => {
    rejects({ ...response(), fields: { ...response().fields, requester } });
  });

  it("preserves server plain text without replacing it with local derivation", () => {
    const input = { ...response(), fields: { ...response().fields, description: rich(), description_plain: "Server text\n  " } };
    expect(draftReadEnvelopeSchema.parse(input)).toStrictEqual(input);
  });

  it("accepts empty plain text only with nonnull description", () => {
    const input = { ...response(), fields: { ...response().fields, description: rich(), description_plain: "" } };
    expect(draftReadEnvelopeSchema.parse(input)).toStrictEqual(input);
    rejects({ ...response(), fields: { ...response().fields, description_plain: "" } });
    rejects({ ...input, fields: { ...input.fields, description_plain: null } });
  });

  it("enforces exact 65536/65537 UTF-8 bytes on server plain text", () => {
    const boundary = "é".repeat(32768);
    expect(new TextEncoder().encode(boundary)).toHaveLength(65536);
    const input = { ...response(), fields: { ...response().fields, description: rich(), description_plain: boundary } };
    expect(draftReadEnvelopeSchema.parse(input)).toStrictEqual(input);
    expect(new TextEncoder().encode(boundary + "a")).toHaveLength(65537);
    rejects({ ...input, fields: { ...input.fields, description_plain: boundary + "a" } });
  });

  it.each([
    { title: "x".repeat(201) }, { compensation: { mode: null } }, { skills: null },
    { languages: [{ language: "en" }] }, { description: { schema_version: 1, document: { type: "doc", content: [] } } },
  ])("reuses approved field constraints %#", (fields) => {
    rejects({ ...response(), fields: { ...response().fields, ...fields } });
  });
});
