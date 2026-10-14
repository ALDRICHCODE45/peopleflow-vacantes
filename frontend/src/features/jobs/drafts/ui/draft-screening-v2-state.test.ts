import { describe, expect, it } from "vitest";

import { createDraftModel, type DraftModel } from "../model";
import { screeningQuestionsV2Schema } from "../screening-v2/model";
import {
  SCREENING_OPTIONS_MAX,
  SCREENING_OPTIONS_MIN,
  SCREENING_QUESTIONS_MAX,
  addScreeningOptionV2,
  addScreeningQuestionV2,
  composeScreeningQuestionV2,
  composeScreeningQuestionsV2,
  createRowUUID,
  createScreeningQuestionV2,
  projectCandidateScreeningV2,
  removeScreeningOptionV2,
  setScreeningCorrectOptionV2,
  toDraftScreeningV2State,
  updateScreeningQuestionV2,
  validateLocalDraftV2FormState,
  validateScreeningQuestionsV2,
  type DraftScreeningV2Question,
  type DraftScreeningV2State,
} from "./draft-screening-v2-state";
import { initialDraftFormState, type DraftFormState } from "./draft-form-state";
import {
  SCREENING_EMPTY_ERROR,
  SCREENING_V2_CORRECT_ERROR,
  SCREENING_V2_OPTION_DUPLICATE_ERROR,
  SCREENING_V2_OPTIONS_MIN_ERROR,
  SCREENING_V2_QUESTION_LIMIT_ERROR,
} from "./draft-messages";

const QID = "b0f1c2d3-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const QID2 = "c1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c";
const OID1 = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const OID2 = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function evaluatedRow(): DraftScreeningV2State {
  return [
    {
      id: QID,
      type: "single_choice_evaluated",
      prompt: "¿Qué palabra clave declara una función en Go?",
      options: [
        { id: OID1, label: "func" },
        { id: OID2, label: "function" },
      ],
      correctOptionId: OID1,
    },
  ];
}

/** One valid open raw row with the required buffered keys present. */
function openRow(id: string, prompt: string): DraftScreeningV2Question {
  return { id, type: "open", prompt, options: [], correctOptionId: "" };
}

function emptyState(): { state: DraftFormState; baseModel: DraftModel } {
  const baseModel = createDraftModel();
  return { state: initialDraftFormState(baseModel), baseModel };
}

describe("createRowUUID", () => {
  it("creates a fresh UUIDv4 once per call, never a repeated value", () => {
    const first = createRowUUID();
    const second = createRowUUID();

    expect(first).toMatch(UUID_V4);
    expect(second).toMatch(UUID_V4);
    expect(first).not.toBe(second);
  });
});

describe("raw v2 buffer", () => {
  it("starts a fresh question with a real id and no invented content", () => {
    const question = createScreeningQuestionV2();

    expect(question.id).toMatch(UUID_V4);
    expect(question.type).toBe("open");
    expect(question.prompt).toBe("");
    expect(question.options).toEqual([]);
    expect(question.correctOptionId).toBe("");
  });

  it("seeds validated questions verbatim without regenerating ids", () => {
    const validated = screeningQuestionsV2Schema.parse([
      { id: QID, type: "open", prompt: "Describe un proyecto." },
      {
        id: QID2,
        type: "single_choice_evaluated",
        prompt: "Elige",
        options: [
          { id: OID1, label: "func" },
          { id: OID2, label: "function" },
        ],
        correct_option_id: OID1,
      },
    ]);

    const state = toDraftScreeningV2State(validated);

    expect(state.map((question) => question.id)).toEqual([QID, QID2]);
    expect(state[0].options).toEqual([]);
    expect(state[1].options).toEqual([
      { id: OID1, label: "func" },
      { id: OID2, label: "function" },
    ]);
    expect(state[1].correctOptionId).toBe(OID1);
  });

  it("composes only the active variant keys and keeps inactive buffers", () => {
    let state = evaluatedRow();

    expect(composeScreeningQuestionV2(state[0])).toEqual({
      id: QID,
      type: "single_choice_evaluated",
      prompt: "¿Qué palabra clave declara una función en Go?",
      options: [
        { id: OID1, label: "func" },
        { id: OID2, label: "function" },
      ],
      correct_option_id: OID1,
    });

    // Switch to open: options and the correct reference stay buffered but are
    // not composed, so they can never leak into an `open` value.
    state = updateScreeningQuestionV2(state, QID, { type: "open" });
    expect(composeScreeningQuestionV2(state[0])).toEqual({
      id: QID,
      type: "open",
      prompt: "¿Qué palabra clave declara una función en Go?",
    });
    expect(state[0].options).toHaveLength(2);
    expect(state[0].correctOptionId).toBe(OID1);

    // Switching back restores the exact buffered values, ids unchanged.
    state = updateScreeningQuestionV2(state, QID, {
      type: "single_choice_evaluated",
    });
    expect(composeScreeningQuestionV2(state[0]).options).toEqual([
      { id: OID1, label: "func" },
      { id: OID2, label: "function" },
    ]);
    expect(composeScreeningQuestionV2(state[0]).correct_option_id).toBe(OID1);
  });

  it("clears a removed correct reference while preserving the remaining ids", () => {
    const removed = removeScreeningOptionV2(evaluatedRow(), QID, OID1);

    expect(removed[0].correctOptionId).toBe("");
    expect(removed[0].options).toEqual([{ id: OID2, label: "function" }]);
  });

  it("refuses an unknown correct reference instead of inventing one", () => {
    const unknown = setScreeningCorrectOptionV2(
      evaluatedRow(),
      QID,
      "999e4567-e89b-42d3-a456-426614174000",
    );
    expect(unknown[0].correctOptionId).toBe(OID1);
  });

  it("keeps the add controls inside the contract bounds", () => {
    const atLimit = Array.from({ length: SCREENING_QUESTIONS_MAX }, () =>
      createScreeningQuestionV2(),
    );
    expect(addScreeningQuestionV2(atLimit)).toBe(atLimit);

    let options = evaluatedRow();
    options = updateScreeningQuestionV2(options, QID, { type: "single_choice_informative" });
    options = addScreeningOptionV2(options, QID);
    expect(options[0].options).toHaveLength(3);
    while (options[0].options.length < SCREENING_OPTIONS_MAX) {
      options = addScreeningOptionV2(options, QID);
    }
    expect(addScreeningOptionV2(options, QID)[0].options).toHaveLength(
      SCREENING_OPTIONS_MAX,
    );
  });
});

describe("validateScreeningQuestionsV2", () => {
  it("accepts all three variants and preserves their ids and order", () => {
    const state: DraftScreeningV2State = [
      openRow(QID, "Describe un proyecto."),
      {
        id: QID2,
        type: "single_choice_informative",
        prompt: "¿Qué modalidad prefieres?",
        options: [
          { id: OID1, label: "Remoto" },
          { id: OID2, label: "Híbrido" },
        ],
        correctOptionId: "",
      },
      {
        id: "d2b3c4d5-e6f7-4a8b-9c0d-1e2f3a4b5c6d",
        type: "single_choice_evaluated",
        prompt: "Elige",
        options: [
          { id: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f", label: "func" },
          { id: "4d5e6f7a-8b9c-4d0e-9f1a-2b3c4d5e6f70", label: "function" },
        ],
        correctOptionId: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f",
      },
    ];

    const result = validateScreeningQuestionsV2(state);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.questions.map((question) => question.type)).toEqual([
      "open",
      "single_choice_informative",
      "single_choice_evaluated",
    ]);
    expect(result.questions.map((question) => question.id)).toEqual([
      QID,
      QID2,
      "d2b3c4d5-e6f7-4a8b-9c0d-1e2f3a4b5c6d",
    ]);
  });

  it("reports an empty prompt at its own composed path", () => {
    const result = validateScreeningQuestionsV2([
      openRow(QID, "   "),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors["screening_questions.0.prompt"]).toBe(SCREENING_EMPTY_ERROR);
  });

  it("reports too few options and duplicate labels at their own paths", () => {
    const tooFew = validateScreeningQuestionsV2([
      {
        id: QID,
        type: "single_choice_informative",
        prompt: "Elige",
        options: [{ id: OID1, label: "func" }],
        correctOptionId: "",
      },
    ]);
    expect(tooFew.ok).toBe(false);
    if (!tooFew.ok) {
      expect(tooFew.errors["screening_questions.0.options"]).toBe(
        SCREENING_V2_OPTIONS_MIN_ERROR,
      );
    }

    const duplicate = validateScreeningQuestionsV2([
      {
        id: QID,
        type: "single_choice_informative",
        prompt: "Elige",
        options: [
          { id: OID1, label: "func" },
          { id: OID2, label: " func " },
        ],
        correctOptionId: "",
      },
    ]);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.errors["screening_questions.0.options.1.label"]).toBe(
        SCREENING_V2_OPTION_DUPLICATE_ERROR,
      );
    }

    expect(SCREENING_OPTIONS_MIN).toBe(2);
  });

  it("requires exactly one correct option for an evaluated question", () => {
    const missing = validateScreeningQuestionsV2([
      {
        id: QID,
        type: "single_choice_evaluated",
        prompt: "Elige",
        options: [
          { id: OID1, label: "func" },
          { id: OID2, label: "function" },
        ],
        correctOptionId: "",
      },
    ]);

    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.errors["screening_questions.0.correct_option_id"]).toBe(
      SCREENING_V2_CORRECT_ERROR,
    );
  });

  it("reports the questionnaire limit for more than 100 questions", () => {
    const state = Array.from({ length: SCREENING_QUESTIONS_MAX + 1 }, () => ({
      id: createRowUUID(),
      type: "open" as const,
      prompt: "Pregunta",
      options: [],
      correctOptionId: "",
    }));

    const result = validateScreeningQuestionsV2(state);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.screening_questions).toBe(SCREENING_V2_QUESTION_LIMIT_ERROR);
  });

  it("never mutates the raw buffer it validates", () => {
    const state = evaluatedRow();
    const before = structuredClone(state);

    validateScreeningQuestionsV2(state);

    expect(state).toEqual(before);
  });
});

describe("validateLocalDraftV2FormState", () => {
  it("returns a clearly local v2 snapshot, never a v1 body", () => {
    const { state, baseModel } = emptyState();
    state.title = "  Backend Go  ";

    const result = validateLocalDraftV2FormState(state, baseModel, evaluatedRow());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 16 non-screening fields plus the v2 questions; no v1 `{ prompt }` list.
    expect(Object.keys(result.model.fields)).toHaveLength(16);
    expect("screening_questions" in result.model.fields).toBe(false);
    expect(result.model.fields.title).toBe("Backend Go");
    expect(result.model.screening_questions[0].type).toBe("single_choice_evaluated");
  });

  it("combines other-field and screening errors atomically with no model", () => {
    const { state, baseModel } = emptyState();
    state.title = "a".repeat(201);

    const result = validateLocalDraftV2FormState(state, baseModel, [
      openRow(QID, ""),
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.title).toBeDefined();
    expect(result.errors["screening_questions.0.prompt"]).toBe(SCREENING_EMPTY_ERROR);
    expect(result).not.toHaveProperty("model");
  });

  it("keeps a valid other-field set with no questions as a valid v2 snapshot", () => {
    const { state, baseModel } = emptyState();

    const result = validateLocalDraftV2FormState(state, baseModel, []);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.screening_questions).toEqual([]);
  });
});

describe("projectCandidateScreeningV2", () => {
  it("projects valid questions through the candidate allowlist only", () => {
    const projection = projectCandidateScreeningV2(evaluatedRow());

    expect(projection.ok).toBe(true);
    if (!projection.ok) return;
    expect(projection.questions).toEqual([
      {
        id: QID,
        type: "single_choice",
        prompt: "¿Qué palabra clave declara una función en Go?",
        options: [
          { id: OID1, label: "func" },
          { id: OID2, label: "function" },
        ],
      },
    ]);
    expect(JSON.stringify(projection.questions)).not.toContain("correct_option_id");
  });

  it("returns explicit errors for invalid questions instead of empty success", () => {
    const projection = projectCandidateScreeningV2([
      openRow(QID, ""),
    ]);

    expect(projection.ok).toBe(false);
    if (projection.ok) return;
    expect(projection.errors["screening_questions.0.prompt"]).toBe(SCREENING_EMPTY_ERROR);
  });

  it("composes the whole buffer in order without dropping inactive buffers", () => {
    const composed = composeScreeningQuestionsV2(evaluatedRow());
    expect(composed).toHaveLength(1);
    expect(composed[0]).toHaveProperty("correct_option_id");
  });
});
