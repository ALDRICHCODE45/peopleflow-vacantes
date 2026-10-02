import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";

import { VACANCY_PIPELINE_STAGES } from "./model";
import { CANDIDATE_STATUS_LABELS, type PipelineCandidate } from "./pipeline-model";
import {
  PIPELINE_MESSAGE_MAX_LENGTH,
  appendPipelineMoveRecord,
  applyPipelineStageMoves,
  confirmedPipelineMessage,
  createPipelineNotificationDraft,
  isCandidateStatus,
  pipelineActivityItems,
  pipelineCandidateDetailView,
  pipelineMoveIntent,
  pipelineMoveRecordsOf,
  pipelineNotificationPreview,
  pipelineStageTransition,
  recordPipelineStageMove,
  validatePipelineNotification,
  type PipelineMoveRecord,
  type PipelineNotificationDraft,
  type PipelineStageMoves,
} from "./pipeline-move-model";
import { NEXO_CANDIDATES } from "./prototype-candidates";

const source = readFileSync(
  join(process.cwd(), "src/features/employer-vacancies/pipeline-move-model.ts"),
  "utf8",
);

const lucia = NEXO_CANDIDATES.find((candidate) => candidate.id === "lucia-fernandez") as PipelineCandidate;
const diego = NEXO_CANDIDATES.find((candidate) => candidate.id === "diego-salazar") as PipelineCandidate;

const draft = (overrides: Partial<PipelineNotificationDraft> = {}): PipelineNotificationDraft => ({
  ...createPipelineNotificationDraft(),
  ...overrides,
});

describe("pipeline move intents", () => {
  it("accepts only the four committed stages as drop targets", () => {
    for (const stage of VACANCY_PIPELINE_STAGES) expect(isCandidateStatus(stage), stage).toBe(true);
    for (const value of ["", "screening", "hired ", "En revisión", "0"]) {
      expect(isCandidateStatus(value), value).toBe(false);
    }
  });

  it("opens no confirmation for the stage the candidate already has", () => {
    for (const stage of VACANCY_PIPELINE_STAGES) {
      expect(pipelineMoveIntent(lucia, stage) === null, stage).toBe(stage === lucia.status);
    }
    expect(pipelineMoveIntent(lucia, "submitted")).toBeNull();
  });

  it("describes a real move with the candidate id and the exact stages", () => {
    expect(pipelineMoveIntent(lucia, "hired")).toEqual({
      candidateId: "lucia-fernandez",
      from: "submitted",
      to: "hired",
    });
  });
});

describe("confirmed stage moves", () => {
  it("overrides only the stage of the moved candidate and leaves the input untouched", () => {
    const moves = recordPipelineStageMove({}, "lucia-fernandez", "hired");
    const roster = applyPipelineStageMoves(NEXO_CANDIDATES, moves);

    expect(roster.find((candidate) => candidate.id === "lucia-fernandez")?.status).toBe("hired");
    for (const candidate of NEXO_CANDIDATES) {
      if (candidate.id !== "lucia-fernandez") {
        expect(roster.find((entry) => entry.id === candidate.id)).toBe(candidate);
      }
    }
    // The frozen fixture is never rewritten.
    expect(lucia.status).toBe("submitted");
    expect(Object.isFrozen(lucia)).toBe(true);
  });

  it("drops the stale next step of a moved card instead of keeping an obsolete claim", () => {
    const roster = applyPipelineStageMoves(NEXO_CANDIDATES, { "diego-salazar": "hired" });
    const moved = roster.find((candidate) => candidate.id === "diego-salazar") as PipelineCandidate;
    expect(diego.nextStep).toBe("Agendar entrevista técnica");
    expect(moved.nextStep).toBeUndefined();
    expect(moved.status).toBe("hired");
    expect(moved.skills).toBe(diego.skills);
  });

  it("does not resurrect a stale next step after returning to the original stage", () => {
    const first = recordPipelineStageMove({}, lucia.id, "in_review");
    const returned: PipelineStageMoves = recordPipelineStageMove(first, lucia.id, "submitted");
    const candidate = applyPipelineStageMoves([lucia], returned)[0];
    expect(candidate.status).toBe("submitted");
    expect(candidate.nextStep).toBeUndefined();
    expect(lucia.nextStep).toBeDefined();
    expect(applyPipelineStageMoves(NEXO_CANDIDATES, { "no-such-candidate": "hired" })).toEqual(
      NEXO_CANDIDATES,
    );
    expect(applyPipelineStageMoves(NEXO_CANDIDATES, {})).toEqual(NEXO_CANDIDATES);
  });

  it("stacks successive moves of the same candidate, latest confirmed stage winning", () => {
    const first = recordPipelineStageMove({}, "lucia-fernandez", "in_review");
    const second = recordPipelineStageMove(first, "lucia-fernandez", "rejected");
    expect(first["lucia-fernandez"]).toBe("in_review");
    expect(second["lucia-fernandez"]).toBe("rejected");
    expect(applyPipelineStageMoves([lucia], second)[0]?.status).toBe("rejected");
  });
});

describe("notification draft validation", () => {
  it("defaults to an opted-out, empty draft", () => {
    expect(createPipelineNotificationDraft()).toEqual({ enabled: false, message: "" });
  });

  it("accepts the opted-out draft with any message text", () => {
    expect(validatePipelineNotification(draft())).toBeUndefined();
    expect(validatePipelineNotification(draft({ message: "   " }))).toBeUndefined();
    expect(validatePipelineNotification(draft({ message: "x".repeat(9999) }))).toBeUndefined();
  });

  it("requires a trimmed, non-blank message once the notification is opted in", () => {
    expect(validatePipelineNotification(draft({ enabled: true, message: "" }))).toMatch(
      /escribe un mensaje/iu,
    );
    expect(validatePipelineNotification(draft({ enabled: true, message: "   \n " }))).toMatch(
      /escribe un mensaje/iu,
    );
    expect(validatePipelineNotification(draft({ enabled: true, message: " Hola " }))).toBeUndefined();
  });

  it("bounds the opted-in message at the shared maximum", () => {
    expect(PIPELINE_MESSAGE_MAX_LENGTH).toBe(600);
    const atBound = "x".repeat(PIPELINE_MESSAGE_MAX_LENGTH);
    expect(validatePipelineNotification(draft({ enabled: true, message: atBound }))).toBeUndefined();
    expect(
      validatePipelineNotification(draft({ enabled: true, message: "x".repeat(PIPELINE_MESSAGE_MAX_LENGTH + 1) })),
    ).toMatch(/600/u);
    // Surrounding whitespace never counts toward the bound.
    expect(
      validatePipelineNotification(
        draft({ enabled: true, message: `  ${"x".repeat(PIPELINE_MESSAGE_MAX_LENGTH)}  ` }),
      ),
    ).toBeUndefined();
  });

  it("keeps only the trimmed message of an opted-in draft as the confirmed text", () => {
    expect(confirmedPipelineMessage(draft({ enabled: false, message: "  Hola  " }))).toBe("");
    expect(confirmedPipelineMessage(draft({ enabled: true, message: "  Hola  " }))).toBe("Hola");
    expect(confirmedPipelineMessage(draft({ enabled: true, message: "   " }))).toBe("");
  });
});

describe("local move records", () => {
  it("numbers confirmations in order and never mutates the previous list", () => {
    const empty: readonly PipelineMoveRecord[] = [];
    const first = appendPipelineMoveRecord(empty, {
      candidateId: "lucia-fernandez",
      from: "submitted",
      to: "in_review",
      message: "",
    });
    const second = appendPipelineMoveRecord(first, {
      candidateId: "lucia-fernandez",
      from: "in_review",
      to: "hired",
      message: "Hola Lucía.",
    });

    expect(empty).toHaveLength(0);
    expect(first.map((record) => record.sequence)).toEqual([1]);
    expect(second.map((record) => record.sequence)).toEqual([1, 2]);
    expect(second[1]?.message).toBe("Hola Lucía.");
  });

  it("filters the records of one candidate without renumbering them", () => {
    const records: readonly PipelineMoveRecord[] = [
      { candidateId: "lucia-fernandez", from: "submitted", to: "in_review", message: "", sequence: 1 },
      { candidateId: "diego-salazar", from: "in_review", to: "hired", message: "", sequence: 2 },
      { candidateId: "lucia-fernandez", from: "in_review", to: "rejected", message: "", sequence: 3 },
    ];
    expect(pipelineMoveRecordsOf(records, "lucia-fernandez").map((record) => record.sequence)).toEqual([1, 3]);
    expect(pipelineMoveRecordsOf(records, "martin-bustos")).toEqual([]);
  });

  it("turns records into read-only activity entries without a delivery claim or a prototype notice", () => {
    const records: readonly PipelineMoveRecord[] = [
      { candidateId: "lucia-fernandez", from: "submitted", to: "in_review", message: "", sequence: 1 },
      { candidateId: "lucia-fernandez", from: "in_review", to: "hired", message: "Hola Lucía.", sequence: 2 },
    ];
    expect(pipelineActivityItems(records)).toEqual([
      {
        key: "movimiento-1",
        title: "Movimiento confirmado",
        detail: "Nuevos → En revisión",
        message: null,
      },
      {
        key: "movimiento-2",
        title: "Movimiento confirmado",
        detail: "En revisión → Contratados",
        message: "Hola Lucía.",
      },
    ]);
    expect(pipelineActivityItems([])).toEqual([]);
    for (const item of pipelineActivityItems(records)) {
      expect(JSON.stringify(item)).not.toMatch(/prototipo|demostración|sesión local|enviado|entregado|éxito/iu);
    }
  });

  it("labels every stage transition in Spanish without inventing a stage", () => {
    for (const from of VACANCY_PIPELINE_STAGES) {
      for (const to of VACANCY_PIPELINE_STAGES) {
        expect(pipelineStageTransition(from, to)).toBe(
          `${CANDIDATE_STATUS_LABELS[from]} → ${CANDIDATE_STATUS_LABELS[to]}`,
        );
      }
    }
  });
});

describe("notification preview", () => {
  it("previews both intended channels without inventing a recipient or a delivery", () => {
    const preview = pipelineNotificationPreview({
      vacancyTitle: "Backend Developer (Senior)",
      to: "in_review",
      message: "Hola Lucía, queremos conocer más de tu experiencia.",
    });
    expect(preview.emailRecipient).toBeNull();
    expect(preview.emailSubject).toBe("Actualización de tu postulación: Backend Developer (Senior)");
    expect(preview.emailBody).toBe("Hola Lucía, queremos conocer más de tu experiencia.");
    expect(preview.processEntry).toBe("Etapa actualizada a En revisión");
    expect(preview.processMessage).toBe(preview.emailBody);
    expect(preview.processEntry).not.toMatch(/enviado|entregado/iu);
  });
});

describe("pipeline candidate detail projection", () => {
  it("projects exactly the four provable fields and invents nothing else", () => {
    const view = pipelineCandidateDetailView(diego);
    expect(view).toEqual({
      fullName: "Diego Salazar",
      professionalTitle: "Ingeniero Backend",
      yearsOfExperience: 6,
      skills: diego.skills,
    });
    expect(Object.keys(view).sort()).toEqual([
      "fullName",
      "professionalTitle",
      "skills",
      "yearsOfExperience",
    ]);
  });

  it("keeps the projected type free of every field the pipeline cannot prove", () => {
    expectTypeOf<ReturnType<typeof pipelineCandidateDetailView>>().toEqualTypeOf<{
      readonly fullName: string;
      readonly professionalTitle: string;
      readonly yearsOfExperience: number;
      readonly skills: readonly string[];
    }>();
  });

  it("never carries another person's identity or invented personal data", () => {
    const view = pipelineCandidateDetailView(diego);
    const serialized = JSON.stringify(view);
    for (const forbidden of ["Diego Molina", "@", "phone", "email", "education", "languages", "industry"]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});

describe("pipeline move model boundary", () => {
  it("stays free of React, browser, transport, storage and clock access", () => {
    const modules = [...new Set([...source.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]))].sort();
    expect(modules).toEqual(["./model", "./pipeline-model"]);
    expect(source).not.toMatch(
      /\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|window\.|document\.|useState\(|"use client"/u,
    );
    expect(source).not.toMatch(/Date\.now|Math\.random|new Date\(|randomUUID/u);
  });
});
