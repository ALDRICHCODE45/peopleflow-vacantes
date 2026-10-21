export const id = "a12b3456-1234-4234-8234-123456789abc";
export const key = "b12b3456-1234-4234-8234-123456789abc";
export const questionId = "c12b3456-1234-4234-8234-123456789abc";
export const optionId = "d12b3456-1234-4234-8234-123456789abc";
export const screening = { questionnaire_revision: "revision-1", questions: [{ id, prompt: "Cuéntanos tu experiencia", type: "open" as const, options: null }, { id: questionId, prompt: "Disponibilidad", type: "single_choice" as const, options: [{ id: optionId, label: "Inmediata" }] }], limits: { open_answer_max_length: 2000 } };
export const body = { cv_id: key, questionnaire_revision: "revision-1", answers: [{ question_id: id, text: "Experiencia" }, { question_id: questionId, option_id: optionId }] };
export const submitted = { id: key, vacancy_id: id, status: "submitted" as const, applied_at: "2026-10-16T12:00:00Z" };
export const page = { items: [{ message: null, id: key, vacancy: { id, title: "Backend Go", state: "open" as const }, company: { id, name: "Acme" }, applied_at: submitted.applied_at, status: "submitted" as const }], next_cursor: null };
