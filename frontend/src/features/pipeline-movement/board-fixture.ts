import type { Board, History, ParticipationDetail } from "./model";
export const vacancyId = "123e4567-e89b-42d3-a456-426614174000";
export function boardFixture(): Board {
  return {
    stages: [
      { id: "new", kind: "new", name: "Entrada", count: 1 },
      { id: "screen", kind: "screening", name: "Revisión", count: 0 },
      { id: "interview", kind: "custom", name: "Entrevista", count: 0 },
      { id: "hire", kind: "placement", name: "Contratación", count: 0 },
    ],
    exit: { id: "exit", kind: "discarded", name: "Descartados", count: 0 },
    coverage: { covered: 0, required: 2, full_coverage_reached_at: null },
    participations: [{ discard: null, id: "person", stage_id: "new", version: "4", etag: '"opaque-item-tag"', candidate: { id: "candidate", full_name: "Ana Pérez" }, applied_at: "2026-10-16T12:00:00Z", source: "organic", cv: { id: "cv", name: "CV Ana.pdf" }, moved_at: "2026-10-16T12:00:00Z" }],
  };
}
export function detailFixture(): ParticipationDetail {
  return { ...boardFixture().participations[0], comment: null, candidate_message: null, screening: [
    { question_id: "q1", prompt: "¿Disponibilidad?", type: "single_choice", answer: { option_id: "o1", label: "Inmediata" } },
    { question_id: "q2", prompt: "¿Por qué te interesa?", type: "open", answer: { text: "Quiero aportar al equipo." } },
  ] };
}
export function historyFixture(): History {
  return { items: [
    { kind: "intake", from_stage_id: null, to_stage_id: "new", hire: false, departure: false, actor: { kind: "candidate", id: "candidate", full_name: "Ana Pérez" }, at: "2026-10-16T12:00:00Z" },
    { kind: "move", from_stage_id: "interview", to_stage_id: "hire", hire: true, departure: false, actor: { kind: "recruiter", id: "recruiter", full_name: "Luis López" }, at: "2026-10-17T12:00:00Z" },
    { kind: "move", from_stage_id: "hire", to_stage_id: "screen", hire: false, departure: true, actor: { kind: "recruiter", id: "recruiter", full_name: "Luis López" }, at: "2026-10-18T12:00:00Z" },
  ] };
}
