import { expect, it } from "vitest";
import {
  MAX_PENDING_INVITATIONS, acceptedSchema, outcomeFor, parseOutcome, createdInvitationSchema, creatorName, daysUntil, invitationUrl, pendingListSchema,
} from "./model";
import { acceptBody, createdInvitation, ownerUserId, pendingInvitation, urlToken } from "./test-fixtures";

it("decodes the contract shapes strictly", () => {
  expect(createdInvitationSchema.parse(createdInvitation())).toEqual(createdInvitation());
  expect(pendingListSchema.parse({ items: [pendingInvitation()] })).toEqual({ items: [pendingInvitation()] });
  expect(acceptedSchema.parse(acceptBody)).toEqual(acceptBody);
  expect(MAX_PENDING_INVITATIONS).toBe(20);
});

it.each([
  ["a created invitation without token", createdInvitationSchema, { ...createdInvitation(), url_token: undefined }],
  ["a created invitation with a non-base64url token", createdInvitationSchema, createdInvitation({ url_token: "abc/def+ghi=" })],
  ["an additive created field", createdInvitationSchema, { ...createdInvitation(), extra: true }],
  ["a pending item that leaks a token", pendingListSchema, { items: [{ ...pendingInvitation(), url_token: urlToken }] }],
  ["a pending item with a person object as creator", pendingListSchema, { items: [{ ...pendingInvitation(), created_by: { user_id: ownerUserId, name: "Ana" } }] }],
  ["an accept with another role", acceptedSchema, { ...acceptBody, role: "recruiter" }],
])("rejects %s", (_name, schema, value) => {
  expect(schema.safeParse(value).success).toBe(false);
});

it("builds the copyable link from the app origin and never adds anything else", () => {
  expect(invitationUrl("https://app.peopleflow.mx", urlToken)).toBe(`https://app.peopleflow.mx/empresa/invitacion/${urlToken}`);
  expect(invitationUrl("http://localhost:3100/", urlToken)).toBe(`http://localhost:3100/empresa/invitacion/${urlToken}`);
});

it("resolves the creator from the members list, or says it is no longer a member", () => {
  const members = [{ user: { id: ownerUserId, full_name: "Sofía Ramírez" } }, { user: null }];
  expect(creatorName(ownerUserId, members)).toBe("Sofía Ramírez");
  expect(creatorName("10000000-0000-4000-8000-0000000000ff", members)).toBe("Ex miembro");
});

it("counts whole calendar days left in Mexico City", () => {
  const now = new Date("2026-11-07T16:42:00Z");
  expect(daysUntil("2026-11-14T16:42:00Z", now)).toBe(7);
  expect(daysUntil("2026-11-08T05:59:00Z", now)).toBe(0);
  expect(daysUntil("2026-11-08T06:01:00Z", now)).toBe(1);
});

it("sends a backend 401 with a session to its own outcome, and a missing session token back to sign-in", () => {
  expect(outcomeFor({ ok: false, reason: "unauthenticated", reference: { status: 401, code: "unauthenticated" } })).toBe("cuenta-no-lista");
  expect(outcomeFor({ ok: false, reason: "unauthenticated", reference: {} })).toBeNull();
  expect(outcomeFor({ ok: false, reason: "no_response", reference: {} })).toBeNull();
  expect(parseOutcome("cuenta-no-lista")).toBe("cuenta-no-lista");
});
