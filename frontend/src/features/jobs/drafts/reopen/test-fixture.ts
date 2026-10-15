import { draftReadEnvelopeV2Schema } from "../read-v2";

/** Filled read response shared by reopen boundary tests, never used by product UI. */
export function filledDraftRead() {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  const option = "223e4567-e89b-42d3-a456-426614174000";
  const other = "323e4567-e89b-42d3-a456-426614174000";
  return draftReadEnvelopeV2Schema.parse({
    schema_version: 2, id, status: "draft", principal_recruiter_id: id,
    version: "7", created_at: "2026-10-06T03:00:00.123456Z", updated_at: "2026-10-06T03:00:00.123456Z",
    fields: {
      title: "Desarrollador backend", location: "Ciudad de México", work_mode: "hybrid",
      work_schedule: "full_time", contract_type: "indefinite", seniority: "senior",
      professional_area: "technology_systems", required_requirements: "Cinco años con Go.",
      preferred_requirements: "Experiencia con AWS.", skills: ["Go", "SQL"],
      custom_benefits: ["Bono de transporte"], benefits: ["health_insurance", "flexible_schedule"],
      requester: { kind: "client", id: other, name: "Acme S.A." },
      languages: [{ language: "es", custom_name: null, level: "native" }, { language: "other", custom_name: "Portugués", level: "basic" }],
      compensation: { mode: "range", amount: null, min: "30000.00", max: "45000.50", currency: "MXN", pay_period: "monthly", basis: "gross", public_visible: true },
      description: { schema_version: 1, document: { type: "doc", content: [
        { type: "paragraph", content: [{ type: "text", text: "Buscamos talento", marks: [{ type: "bold" }] }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Go" }] }] }] },
      ] } }, description_plain: "Buscamos talento\nGo",
      screening_questions: [
        { id, type: "open", prompt: "Cuéntanos de un proyecto." },
        { id: option, type: "single_choice_evaluated", prompt: "¿Qué declara una función?", options: [{ id: option, label: "func" }, { id: other, label: "function" }], correct_option_id: option },
        { id: other, type: "single_choice_informative", prompt: "¿Qué modalidad prefieres?", options: [{ id: option, label: "Remoto" }, { id: other, label: "Híbrido" }] },
      ],
    },
  });
}

export function storedWriteFields(read = filledDraftRead()) {
  const { description_plain: derived, requester, ...fields } = read.fields;
  void derived;
  return { ...fields, requester: requester && { kind: requester.kind, id: requester.id } };
}
