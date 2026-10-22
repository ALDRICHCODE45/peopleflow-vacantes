import { expect, it } from "vitest";
import { boardSchema, detailSchema, moveSchema, participationSchema } from "./model";
import { applyParticipationToBoard } from "./helpers";
import { board, detail, item, moved } from "./test-fixtures";

const original = {
  full_name: "Ana Pérez", contact: { email: "ana@example.com", phone: null },
  professional_title: null, current_company: null, profile: item.profile,
  education: null, linkedin_url: null, portfolio_url: null,
};
const current = {
  ...item, candidate: { ...item.candidate, full_name: "Ana Pérez López" },
  corrected_fields: ["email", "full_name", "skills"],
  profile: { ...item.profile, skills: ["React", "TypeScript"] },
  cv: { ...item.cv, name: "CV actualizado.pdf", source: "company" },
};
const originalCv = { file_name: "CV Ana.pdf", uploaded_at: item.applied_at };
const correctedDetail = { ...detail, ...current, contact: { email: "ana.lopez@example.com", phone: null }, original, original_cv: originalCv };

it("accepts effective board and detail reads with corrections and current/original CV metadata", () => {
  expect(participationSchema.parse(current)).toEqual(current);
  expect(boardSchema.parse({ ...board, participations: [current] }).participations[0]).toEqual(current);
  expect(detailSchema.parse(correctedDetail)).toEqual(correctedDetail);
});
it("accepts explicit uncorrected reads and effective mutation projections", () => {
  const uncorrected = { ...item, corrected_fields: [], cv: { ...item.cv, source: "candidate" } };
  expect(participationSchema.parse(uncorrected)).toEqual(uncorrected);
  expect(detailSchema.parse({ ...detail, ...uncorrected, original: null, original_cv: null })).toMatchObject({ original: null, original_cv: null });
  const mutation = { ...moved, candidate: current.candidate, cv: current.cv, corrected_fields: current.corrected_fields };
  expect(moveSchema.parse(mutation)).toEqual(mutation);
  expect(participationSchema.safeParse({ ...uncorrected, original_cv: null }).success).toBe(false);
});
it("requires the additive E4 keys and keeps original/contact detail-only", () => {
  for (const value of [
    { ...current, corrected_fields: undefined }, { ...current, cv: { ...current.cv, source: undefined } },
    { ...current, original }, { ...current, original_cv: originalCv }, { ...current, contact: original.contact },
  ]) expect(participationSchema.safeParse(value).success).toBe(false);
  expect(detailSchema.safeParse({ ...correctedDetail, original: undefined }).success).toBe(false);
  expect(detailSchema.safeParse({ ...correctedDetail, original_cv: undefined }).success).toBe(false);
});
it.each([
  { ...correctedDetail, corrected_fields: ["unknown"] },
  { ...correctedDetail, corrected_fields: "skills" },
  { ...correctedDetail, cv: { ...current.cv, source: "recruiter" } },
  { ...correctedDetail, cv: { ...current.cv, unexpected: true } },
  { ...correctedDetail, original_cv: { ...originalCv, source: "candidate" } },
  { ...correctedDetail, original_cv: { file_name: "CV Ana.pdf", uploaded_at: "yesterday" } },
  { ...correctedDetail, original: { ...original, unknown: true } },
  { ...correctedDetail, original: { ...original, education: [] } },
  { ...correctedDetail, original: { ...original, contact: { ...original.contact, hidden: true } } },
  { ...correctedDetail, original: { ...original, profile: { ...original.profile, professional_title: "extra" } } },
  { ...correctedDetail, profile: { ...current.profile, extra: true } },
])("still rejects correction contract drift %#", value => {
  expect(detailSchema.safeParse(value).success).toBe(false);
});
it("keeps effective projection values after a confirmed movement", () => {
  const before = boardSchema.parse({ ...board, participations: [current] });
  const after = applyParticipationToBoard(before, moveSchema.parse({ ...moved, candidate: current.candidate, cv: current.cv, corrected_fields: current.corrected_fields }));
  expect(after.participations[0]).toMatchObject({
    stage_id: moved.stage_id, etag: moved.etag,
    candidate: current.candidate, profile: current.profile, corrected_fields: current.corrected_fields,
    cv: current.cv,
  });
});
