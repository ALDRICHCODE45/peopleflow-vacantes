import { expect, it } from "vitest";
import * as m from "./model";
import { profile, body, invitation, result, comparison, base, items, id } from "./fixtures.test";
const cases = [["profile", m.profileSchema, profile], ["profile body", m.profileBodySchema, body], ["invitation", m.invitationSchema, invitation], ["result", m.resultSchema, result], ["comparison", m.comparisonSchema, comparison], ["candidate base", m.candidateBaseSchema, base], ["candidate items", m.candidateItemsSchema, items]] as const;
it.each(cases)("strictly decodes %s", (_, schema, value) => { expect(schema.parse(value)).toEqual(value); expect(schema.safeParse({ ...value, unexpected: true }).success).toBe(false); });
it.each([
  { version: "01" }, { version: "1\n" }, { expires_in_days: 0 }, { expires_in_days: 31 }, { test: "ipip116-mx" }, { confirmed_at: "yesterday" },
  { competencies: body.competencies.slice(1) }, { competencies: body.competencies.map(() => body.competencies[0]) },
  { competencies: body.competencies.map(c => ({ ...c, importance: "clave" })) },
  { competencies: body.competencies.map(c => ({ ...c, desired_band: "band.high" })) },
  { confirmed: true, confirmed_at: "2026-10-29T00:00:00Z", competencies: [{ ...body.competencies[0], importance: "importance.importante", desired_band: "band.medium", rationale: "" }, ...body.competencies.slice(1)] }, { auto_send_stage_ids: [id, id.toUpperCase()] },
])("rejects invalid profile %#", patch => expect(m.profileSchema.safeParse({ ...profile, ...patch }).success).toBe(false));
it("validates confirmation rationale/task after trim and draft bounds", () => {
  const confirmed = { ...body, confirmed: true, competencies: body.competencies.map(c => ({ ...c, importance: "importance.clave", desired_band: "band.low", rationale: " Motivo ", task: " Tarea " })) };
  expect(m.profileBodySchema.parse(confirmed).competencies[0]).toMatchObject({ rationale: "Motivo", task: "Tarea" });
  for (const patch of [{ rationale: " " }, { task: null }, { rationale: "x".repeat(1001) }, { task: "x".repeat(301) }]) expect(m.profileBodySchema.safeParse({ ...confirmed, competencies: confirmed.competencies.map(c => ({ ...c, ...patch })) }).success).toBe(false);
  expect(m.profileBodySchema.safeParse({ ...body, version: "1" }).success).toBe(false);
});
it.each([
  { competencies: result.competencies.map(c => ({ ...c, index: 10 })) },
  { competencies: result.competencies.map(c => ({ ...c, band: "high" })) },
  { facets: result.facets.slice(1) }, { interpretations: result.interpretations.slice(1) },
  { quality: { ...result.quality, tier: "none" } },
  { quality: { ...result.quality, signals: [{ id: "signal.attention", severity: "none", counts: { changes: 2 } }] } },
  { latest_comparison: { ...comparison, competencies: comparison.competencies.map(c => ({ ...c, fit: "apto" })) } },
  { latest_comparison: { ...comparison, guide: comparison.guide.map(q => ({ ...q, question_id: "q.organizacion.low.99" })) } },
])("rejects invalid result %#", patch => expect(m.resultSchema.safeParse({ ...result, ...patch }).success).toBe(false));
it("binds each signal id to its own counts shape", () => {
  for (const counts of [{ run: 2 }, { fast_count: 0, total: 60 }, { value_changes: 0, clears: 0, reanswers: 0, total: 0 }]) {
    const quality = { ...result.quality, signals: result.quality.signals.map(s => s.id === "signal.attention" ? { ...s, counts } : s) };
    expect(m.qualitySchema.safeParse(quality).success).toBe(false);
  }
});
it("preserves partial quality with null unavailable counts", () => {
  const quality = { ...result.quality, partial: true, signals: result.quality.signals.map(s => s.id === "signal.fast" ? { ...s, severity: "unknown", counts: null } : s) };
  expect(m.resultSchema.parse({ ...result, quality }).quality).toEqual(quality);
  expect(m.resultSchema.safeParse({ ...result, quality: { ...quality, partial: false } }).success).toBe(false);
});
it("accepts both focus tags and stored guide text", () => {
  const focus_areas = [{ type: "focus.distant", competency_id: "comp.organizacion", observed_band: "band.low", desired_band: "band.high", importance: "importance.clave", fit: "fit.atencion", profile_version: "2" }, { type: "focus.quality", competency_id: null, tier: "tier.algunas", signal_ids: ["signal.attention"], routed_competency_id: "comp.organizacion" }];
  expect(m.comparisonSchema.parse({ ...comparison, focus_areas }).focus_areas).toEqual(focus_areas);
});
it("guards candidate privacy, scale, position, answers and exact telemetry keys", () => {
  expect(m.candidateItemsSchema.safeParse({ ...items, items: items.items.map(i => ({ ...i, facet_id: "facet.c2" })) }).success).toBe(false);
  expect(m.candidateItemsSchema.safeParse({ ...items, scale: items.scale.slice(1) }).success).toBe(false);
  for (const patch of [{ value: 0 }, { value: 6 }, { value: 1.5 }, { event_id: "bad" }, { client_elapsed_ms: -1 }, { client_elapsed_ms: 3600001 }, { changes: 1 }]) expect(m.answerBodySchema.safeParse({ event_id: id, value: 3, ...patch }).success).toBe(false);
  expect(m.answerBodySchema.parse({ event_id: id, value: 1, client_elapsed_ms: 0 })).toEqual({ event_id: id, value: 1, client_elapsed_ms: 0 });
  expect(m.answerBodySchema.parse({ event_id: id, value: 5, client_elapsed_ms: 3600000 })).toEqual({ event_id: id, value: 5, client_elapsed_ms: 3600000 });
  expect(m.clearAnswerBodySchema.safeParse({ event_id: id, value: 1 }).success).toBe(false);
});
it("asks for rationale only on relevant competencies (L25)", () => {
  const relevant = { competency_id: "comp.organizacion", importance: "importance.importante", desired_band: "band.medium", rationale: "Coordina entregas semanales.", task: null };
  const rest = body.competencies.slice(1);
  const confirmed = { ...body, confirmed: true, competencies: [relevant, ...rest] };
  expect(m.profileBodySchema.safeParse(confirmed).success).toBe(true);
  expect(m.profileBodySchema.safeParse({ ...confirmed, competencies: [{ ...relevant, rationale: " " }, ...rest] }).success).toBe(false);
  expect(m.profileBodySchema.safeParse({ ...body, competencies: [{ ...body.competencies[0], rationale: "Motivo" }, ...rest] }).success).toBe(false);
  expect(m.profileBodySchema.safeParse({ ...body, competencies: [{ ...body.competencies[0], task: "Tarea" }, ...rest] }).success).toBe(false);
  expect(m.profileBodySchema.safeParse({ ...body, competencies: [{ ...relevant, rationale: "" }, ...rest] }).success).toBe(true);
});
it("allows a task only on key competencies and a string rationale on relevant drafts (L28)", () => {
  const importante = { competency_id: "comp.organizacion", importance: "importance.importante", desired_band: "band.medium", rationale: "", task: null };
  const rest = body.competencies.slice(1);
  expect(m.profileBodySchema.safeParse({ ...body, competencies: [importante, ...rest] }).success).toBe(true);
  expect(m.profileBodySchema.safeParse({ ...body, competencies: [{ ...importante, task: "Tarea" }, ...rest] }).success).toBe(false);
  expect(m.profileBodySchema.safeParse({ ...body, competencies: [{ ...importante, rationale: null }, ...rest] }).success).toBe(false);
  expect(m.profileBodySchema.safeParse({ ...body, competencies: [{ ...importante, importance: "importance.clave", task: "Tarea" }, ...rest] }).success).toBe(true);
});
