import { VACANCY_PIPELINE_STAGES } from "./model";
import { CANDIDATE_STATUS_LABELS } from "./pipeline-model";
import type { CandidateStatus, PipelineCandidate } from "./pipeline-model";

/**
 * Pure, server-safe interaction model of the vacancy pipeline: the confirmed
 * stage moves, the optional candidate message composed with each move, the
 * local preview of both intended channels, and the reduced detail projection the
 * shared talent Sheet renders.
 *
 * A move is a local override over the frozen candidate roster and a prepared
 * message stays a draft. Nothing here fetches, sends, stores or persists, and no
 * function reads a clock: every derived value is a pure function of its inputs.
 */

/** Confirmed stage overrides keyed by candidate id; an absent id is untouched. */
export type PipelineStageMoves = Readonly<Partial<Record<string, CandidateStatus>>>;

/** Maximum length of the optional candidate message, shared with the textarea. */
export const PIPELINE_MESSAGE_MAX_LENGTH = 600;

/** One pending move: which candidate leaves which stage for which stage. */
export type PipelineMoveIntent = {
  readonly candidateId: string;
  readonly from: CandidateStatus;
  readonly to: CandidateStatus;
};

/** Optional notification draft of one move. It defaults to off and empty. */
export type PipelineNotificationDraft = {
  readonly enabled: boolean;
  readonly message: string;
};

/** The draft every new movement starts from, so no other candidate's text leaks. */
export function createPipelineNotificationDraft(): PipelineNotificationDraft {
  return { enabled: false, message: "" };
}

/** Exact stage membership test for a drag/drop target id. */
export function isCandidateStatus(value: string): value is CandidateStatus {
  return (VACANCY_PIPELINE_STAGES as readonly string[]).includes(value);
}

/**
 * The pending move of one drop or menu choice, or `null` when the destination is
 * already the candidate's stage. A `null` result is the only correct answer for
 * a same-stage drop: it opens no confirmation and mutates nothing.
 */
export function pipelineMoveIntent(
  candidate: PipelineCandidate,
  to: CandidateStatus,
): PipelineMoveIntent | null {
  if (to === candidate.status) return null;
  return { candidateId: candidate.id, from: candidate.status, to };
}

/** Records one confirmed move as a local override, leaving the input untouched. */
export function recordPipelineStageMove(
  moves: PipelineStageMoves,
  candidateId: string,
  to: CandidateStatus,
): PipelineStageMoves {
  return { ...moves, [candidateId]: to };
}

/**
 * Applies the confirmed overrides over the frozen roster. Only the stage and the
 * now-meaningless `nextStep` change: the fixture next step described the stage
 * the candidate just left, so keeping it next to the new stage would be a stale
 * claim. The local move record carries the truthful context instead.
 */
export function applyPipelineStageMoves(
  candidates: readonly PipelineCandidate[],
  moves: PipelineStageMoves,
): readonly PipelineCandidate[] {
  return candidates.map((candidate) => {
    const status = moves[candidate.id];
    if (status === undefined) return candidate;
    return { ...candidate, status, nextStep: undefined };
  });
}

/** The trimmed message that is actually recorded locally; empty when opted out. */
export function confirmedPipelineMessage(draft: PipelineNotificationDraft): string {
  return draft.enabled ? draft.message.trim() : "";
}

/**
 * Validates the notification draft. An opted-out notification is always valid;
 * an opted-in one needs a non-blank message inside the shared bound. Returns the
 * Spanish error the form shows, or `undefined` when the draft may be confirmed.
 */
export function validatePipelineNotification(
  draft: PipelineNotificationDraft,
): string | undefined {
  if (!draft.enabled) return undefined;
  const message = draft.message.trim();
  if (message === "") {
    return "Escribe un mensaje para avisar a la persona candidata.";
  }
  if (message.length > PIPELINE_MESSAGE_MAX_LENGTH) {
    return `El mensaje no puede superar los ${PIPELINE_MESSAGE_MAX_LENGTH} caracteres.`;
  }
  return undefined;
}

/** The local (`origen → destino`) stage summary both the dialog and the record show. */
export function pipelineStageTransition(from: CandidateStatus, to: CandidateStatus): string {
  return `${CANDIDATE_STATUS_LABELS[from]} → ${CANDIDATE_STATUS_LABELS[to]}`;
}

/** One confirmed local move, in confirmation order and with no clock involved. */
export type PipelineMoveRecord = {
  readonly candidateId: string;
  readonly from: CandidateStatus;
  readonly to: CandidateStatus;
  /** Trimmed message kept as a local draft; empty when nothing was prepared. */
  readonly message: string;
  /** 1-based confirmation order inside the current visit. */
  readonly sequence: number;
};

/** Appends one confirmed move, deriving its sequence from the current records. */
export function appendPipelineMoveRecord(
  records: readonly PipelineMoveRecord[],
  move: Omit<PipelineMoveRecord, "sequence">,
): readonly PipelineMoveRecord[] {
  return [...records, { ...move, sequence: records.length + 1 }];
}

/** Confirmed local moves of one candidate, in confirmation order. */
export function pipelineMoveRecordsOf(
  records: readonly PipelineMoveRecord[],
  candidateId: string,
): readonly PipelineMoveRecord[] {
  return records.filter((record) => record.candidateId === candidateId);
}

/** Local preview of the two channels one prepared message targets. */
export type PipelineNotificationPreview = {
  /** The pipeline roster carries no email, so the recipient stays unavailable. */
  readonly emailRecipient: string | null;
  readonly emailSubject: string;
  readonly emailBody: string;
  readonly processEntry: string;
  readonly processMessage: string;
};

/**
 * The reviewed preview of the intended notification. It is a description of what
 * the message would look like, never a delivery report: the recipient is
 * unavailable because the pipeline model owns no email, and nothing is sent.
 */
export function pipelineNotificationPreview(input: {
  readonly vacancyTitle: string;
  readonly to: CandidateStatus;
  readonly message: string;
}): PipelineNotificationPreview {
  return {
    emailRecipient: null,
    emailSubject: `Actualización de tu postulación: ${input.vacancyTitle}`,
    emailBody: input.message,
    processEntry: `Etapa actualizada a ${CANDIDATE_STATUS_LABELS[input.to]}`,
    processMessage: input.message,
  };
}

/** One read-only entry of the detail Sheet activity slot. */
export type PipelineActivityItem = {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly message: string | null;
  readonly note: string;
};

/** Honest scope of the demo: a prepared message is never delivered. */
export const PIPELINE_LOCAL_ONLY_NOTE =
  "Solo en esta sesión local: no se envió ningún correo ni notificación.";

/** The locally recorded movements of one candidate, ready for the detail Sheet. */
export function pipelineActivityItems(
  records: readonly PipelineMoveRecord[],
): readonly PipelineActivityItem[] {
  return records.map((record) => ({
    key: `movimiento-${record.sequence}`,
    title: "Movimiento confirmado",
    detail: pipelineStageTransition(record.from, record.to),
    message: record.message === "" ? null : record.message,
    note: PIPELINE_LOCAL_ONLY_NOTE,
  }));
}

/**
 * The truthful read-only projection of one pipeline candidate for the shared
 * talent detail Sheet: exactly the four facts the pipeline model proves. Contact
 * data, formation, preferences and history do not exist here, so they are left
 * undefined and the Sheet renders them as unavailable instead of inventing them.
 */
export type PipelineCandidateDetailView = {
  readonly fullName: string;
  readonly professionalTitle: string;
  readonly yearsOfExperience: number;
  readonly skills: readonly string[];
};

export function pipelineCandidateDetailView(
  candidate: PipelineCandidate,
): PipelineCandidateDetailView {
  return {
    fullName: candidate.fullName,
    professionalTitle: candidate.professionalTitle,
    yearsOfExperience: candidate.yearsOfExperience,
    skills: candidate.skills,
  };
}
