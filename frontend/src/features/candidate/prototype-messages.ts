/**
 * Frozen candidate-facing application message fixture for `/candidato/dashboard`.
 * A message joins its application by the exact `applicationId`; the dashboard route
 * owns this fixture and passes it down, so no fetch, storage, backend call or schema
 * change is involved. The sender is the company recruiting team (no recruiter name,
 * email or phone is invented) and every date is deterministic.
 */
export type CandidateApplicationMessage = Readonly<{
  /** Exact candidate application id this message belongs to. */
  applicationId: string
  /** Company recruiting-team sender; never a named person or contact detail. */
  sender: string
  /** Deterministic offset timestamp, consistent with the application update. */
  sentAt: string
  subject: string
  /** Readable letter body, one entry per paragraph. */
  body: readonly string[]
}>

/** The single committed message for the `in_review` `Ingeniera Frontend` application. */
const MESSAGE_SOURCE: readonly CandidateApplicationMessage[] = [
  {
    applicationId: "7b1c2d3e-4f50-4a1b-8c2d-3e4f5a6b7c02",
    sender: "Equipo de Reclutamiento de Acme",
    sentAt: "2026-03-01T09:15:00-06:00",
    subject: "Siguiente paso: entrevista técnica",
    body: [
      "Hola Ximena:",
      "Gracias por postularte a la vacante de Ingeniera Frontend en Acme. Revisamos tu perfil y tu CV, y nos gustaría continuar con el proceso de selección.",
      "El siguiente paso es una entrevista técnica con el equipo. En los próximos días te compartiremos las opciones de horario para coordinarla.",
      "Saludos cordiales,",
      "Equipo de Reclutamiento de Acme",
    ],
  },
]

/** Freezes a value and every plain object and array reachable from it. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

/** The frozen candidate application messages, joined to rows by exact id. */
export const CANDIDATE_APPLICATION_MESSAGES: readonly CandidateApplicationMessage[] = deepFreeze(MESSAGE_SOURCE)
