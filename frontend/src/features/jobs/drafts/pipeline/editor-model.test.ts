import { describe, expect, it } from "vitest";
import {
  STAGE_KIND_LABELS,
  addCustomStage,
  adoptSavedPipeline,
  canAddCustomStage,
  canMove,
  canMoveTo,
  canRemoveStage,
  criticalRenames,
  reconcileUncertainSave,
  editorFromPipeline,
  isEditorDirty,
  moveStage,
  moveStageTo,
  normalizeStageName,
  removeCustomStage,
  renameStage,
  stageNameError,
  stageNameKey,
  toPutBody,
  validateEditor,
  type EditorPipeline,
} from "./editor-model";

function pipeline(): EditorPipeline {
  return {
    version: "0",
    structure_locked: false,
    stages: [
      { id: "n", kind: "new", name: "Nuevos" },
      { id: "s", kind: "screening", name: "Screening" },
      { id: "o", kind: "screening_ok", name: "Screening OK" },
      { id: "i", kind: "in_process", name: "En proceso" },
      { id: "p", kind: "placement", name: "Placement" },
    ],
    exit: { id: "e", kind: "discarded", name: "Descartados" },
    limits: { maxCustomStages: 3, nameMaxLength: 40 },
  };
}

const fresh = () => editorFromPipeline(pipeline());

describe("stage names (S6)", () => {
  it.each([
    [" \t A\u00a0\u00a0B  C\n ", "A B C"],
    ["A\tB", "A B"],
    ["\u200b A \u200b", "\u200b A \u200b"],
    ["\ufeff A \ufeff", "\ufeff A \ufeff"],
    [" A\u0301rea ", "Área"],
  ])("normalizes %j to %j without dropping format characters", (raw, normalized) => {
    expect(normalizeStageName(raw)).toBe(normalized);
  });

  it("collapses the complete Unicode White_Space set", () => {
    const whitespace = "\u0009\u000a\u000b\u000c\u000d\u0020\u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000";
    expect(normalizeStageName(`${whitespace}A${whitespace}B${whitespace}`)).toBe("A B");
  });

  it("uses the agreed upper/lower NFC casefold approximation, preserving accents", () => {
    expect(stageNameKey("Área")).toBe(stageNameKey("ÁREA"));
    expect(stageNameKey("Area")).not.toBe(stageNameKey("Área"));
    expect(stageNameKey("ß")).toBe(stageNameKey("SS"));
    expect(stageNameKey("A\u0301REA")).toBe(stageNameKey("Área"));
  });

  it("validates required, normalized codepoint length, and Cc but not whitespace or Cf", () => {
    const limits = { maxCustomStages: 2, nameMaxLength: 10 };
    expect(stageNameError(" \t\u0085", limits)).toBe("required");
    expect(stageNameError(`  ${"😀".repeat(10)}  `, limits)).toBeNull();
    expect(stageNameError("😀".repeat(11), limits)).toBe("too_long");
    expect(stageNameError("A\u0301".repeat(10), limits)).toBeNull();
    expect(stageNameError("A\t\n\u0085B", limits)).toBeNull();
    expect(stageNameError("\u200b\ufeff", limits)).toBeNull();
    for (const control of [0, 8, 14, 31, 127, 128, 132, 134, 159]) {
      expect(stageNameError(`A${String.fromCodePoint(control)}B`, limits)).toBe("control_character");
    }
  });
});

describe("pipeline editor operations (S3, S6)", () => {
  it("loads entries, limits and an independent saved baseline; renames raw text immutably", () => {
    const response = pipeline();
    const state = editorFromPipeline(response);
    expect(state.stages.map(({ key, id }) => [key, id])).toEqual(response.stages.map(({ id }) => [id, id]));
    expect(state.baseline).toEqual(response);
    expect(state.baseline).not.toBe(response);
    response.stages[0].name = "External mutation";
    response.limits.nameMaxLength = 1;
    expect(state.stages[0].name).toBe("Nuevos");
    expect(state.baseline.stages[0].name).toBe("Nuevos");
    expect(state.limits.nameMaxLength).toBe(40);
    const next = renameStage(state, "e", "  Salida  ");
    expect(next.exit.name).toBe("  Salida  ");
    expect(next.exit.kind).toBe("discarded");
    expect(state.exit.name).toBe("Descartados");
    expect(renameStage(state, "missing", "Nada")).toBe(state);
  });

  it("never removes built-ins including the exit", () => {
    const state = fresh();
    for (const entry of [...state.stages, state.exit]) {
      expect(canRemoveStage(state, entry.key)).toBe(false);
      expect(removeCustomStage(state, entry.key)).toBe(state);
    }
    expect(canRemoveStage(state, "missing")).toBe(false);
    expect(removeCustomStage(state, "missing")).toBe(state);
  });

  it("fixes Nuevos first and Placement last, refusing crossings and unknown keys", () => {
    const state = fresh();
    for (const key of ["n", "p", "e", "missing"]) {
      for (const direction of ["up", "down"] as const) {
        expect(canMove(state, key, direction)).toBe(false);
        expect(moveStage(state, key, direction)).toBe(state);
      }
    }
    expect(canMove(state, "s", "up")).toBe(false);
    expect(moveStage(state, "s", "up")).toBe(state);
    expect(canMove(state, "i", "down")).toBe(false);
    expect(moveStage(state, "i", "down")).toBe(state);
    expect(canMove(state, "s", "down")).toBe(true);
    const moved = moveStage(state, "s", "down");
    expect(moved.stages.map(({ key }) => key)).toEqual(["n", "o", "s", "i", "p"]);
    expect(moveStage(moved, "s", "up")).toEqual(state);
    expect(state.stages.map(({ key }) => key)).toEqual(["n", "s", "o", "i", "p"]);
  });

  it("adds before Placement with stable unique local keys, uses response limits, removes only custom", () => {
    const response = pipeline();
    response.limits = { maxCustomStages: 2, nameMaxLength: 10 };
    const original = editorFromPipeline(response);
    const one = addCustomStage(original, "  Técnica ");
    const first = one.stages[4];
    expect(first).toMatchObject({ id: null, kind: "custom", name: "  Técnica " });
    expect(first.key).toBeTruthy();
    expect(one.stages[5].kind).toBe("placement");
    expect(canMove(one, first.key, "up")).toBe(true);
    expect(canMove(one, first.key, "down")).toBe(false);
    const two = addCustomStage(one);
    expect(two.stages[5].name).toBe("");
    expect(two.stages[5].key).not.toBe(first.key);
    expect(canAddCustomStage(two)).toBe(false);
    expect(addCustomStage(two, "Tercera")).toBe(two);
    expect(canRemoveStage(two, first.key)).toBe(true);
    const removed = removeCustomStage(two, first.key);
    expect(canAddCustomStage(removed)).toBe(true);
    expect(removed.stages.some(({ key }) => key === first.key)).toBe(false);
    const readded = addCustomStage(removed);
    expect(readded.stages[5].key).not.toBe(first.key);
    expect(original.stages).toHaveLength(5);
  });

  it("exposes semantic Spanish labels independently of editable names", () => {
    expect(STAGE_KIND_LABELS).toEqual({
      new: "Nuevos", screening: "Screening", screening_ok: "Screening OK",
      in_process: "En proceso", placement: "Placement", custom: "Columna propia", discarded: "Descartados",
    });
  });
});

describe("direct stage movement (S8, S10)", () => {
  it.each([0, 4, -1, 5, 1.5, NaN, Infinity])("refuses target index %s without changing state", target => {
    const state = fresh();
    expect(canMoveTo(state, "s", target)).toBe(false);
    expect(moveStageTo(state, "s", target)).toBe(state);
  });

  it.each(["n", "p", "e", "missing"])("refuses moving fixed, exit or unknown key %s", key => {
    const state = fresh();
    expect(canMoveTo(state, key, 2)).toBe(false);
    expect(moveStageTo(state, key, 2)).toBe(state);
  });

  it("keeps the same state object for the same index", () => {
    const state = fresh();
    expect(canMoveTo(state, "s", 1)).toBe(false);
    expect(moveStageTo(state, "s", 1)).toBe(state);
  });

  it("moves multiple positions in either direction preserving all other relative order and identities", () => {
    const state = addCustomStage(fresh(), "Técnica");
    expect(canMoveTo(state, "s", 4)).toBe(true);
    const moved = moveStageTo(state, "s", 4);
    expect(moved.stages.map(stage => stage.key)).toEqual(["n", "o", "i", "local:custom:1", "s", "p"]);
    expect(moved.stages.filter(stage => stage.key !== "s")).toEqual(state.stages.filter(stage => stage.key !== "s"));
    expect(moved.stages.every(stage => state.stages.includes(stage))).toBe(true);
    expect(moveStageTo(moved, "s", 1)).toEqual(state);
    expect(isEditorDirty(moved)).toBe(true);
    expect(moved.exit).toBe(state.exit);
    expect(moved.baseline).toBe(state.baseline);
    expect(state.stages.map(stage => stage.key)).toEqual(["n", "s", "o", "i", "local:custom:1", "p"]);
  });
});

describe("editor validation (S3, S6)", () => {
  it("accepts a valid configuration and reports per-key name errors", () => {
    expect(validateEditor(fresh())).toEqual({ ok: true, errors: {} });
    let state = renameStage(fresh(), "n", " \t ");
    state = renameStage(state, "s", "x".repeat(41));
    state = renameStage(state, "e", "Bad\u0000");
    expect(validateEditor(state)).toEqual({
      ok: false, errors: { n: "required", s: "too_long", e: "control_character" },
    });
  });

  it("reports empty names as required, never as duplicates of each other", () => {
    const state = addCustomStage(addCustomStage(fresh()));
    const keys = state.stages.filter((entry) => entry.kind === "custom").map((entry) => entry.key);
    expect(validateEditor(state)).toEqual({
      ok: false, errors: { [keys[0]]: "required", [keys[1]]: "required" },
    });
  });

  it("marks every duplicate across progression and exit, normalizing and casefolding", () => {
    let state = renameStage(fresh(), "n", "  A\u0301rea\t Norte ");
    state = renameStage(state, "s", "ÁREA  NORTE");
    state = renameStage(state, "e", "área\u00a0norte");
    state = renameStage(state, "i", "Area Norte");
    expect(validateEditor(state)).toEqual({
      ok: false, errors: { n: "duplicate", s: "duplicate", e: "duplicate" },
    });
    expect(validateEditor(renameStage(renameStage(fresh(), "s", "ß"), "e", "SS")).errors)
      .toEqual({ s: "duplicate", e: "duplicate" });
  });

  it("rejects malformed structure: missing/repeated built-ins, wrong endpoints/exit, and too many customs", () => {
    const state = fresh();
    const invalid = [
      { ...state, stages: state.stages.filter(({ kind }) => kind !== "screening") },
      { ...state, stages: [...state.stages.slice(0, 2), { ...state.stages[1], key: "another" }, ...state.stages.slice(2)] },
      { ...state, stages: [...state.stages].reverse() },
      { ...state, stages: [...state.stages.slice(1), state.stages[0]] },
      { ...state, stages: [state.stages[4], ...state.stages.slice(0, 4)] },
      // Simulate a corrupted state even though the public types exclude discarded here.
      { ...state, stages: [...state.stages, state.exit] } as unknown as typeof state,
      { ...state, exit: { ...state.exit, kind: "custom" } } as unknown as typeof state,
    ];
    for (const malformed of invalid) {
      expect(validateEditor(malformed)).toMatchObject({ ok: false, errors: { $structure: "invalid_structure" } });
    }
    const overLimit = { ...addCustomStage(state, "Extra"), limits: { maxCustomStages: 0, nameMaxLength: 40 } };
    expect(validateEditor(overLimit)).toEqual({ ok: false, errors: { $structure: "too_many_custom_stages" } });
  });
});

describe("uncertain save reconciliation (S5, S9)", () => {
  it("matches normalized names, ids and order, assigning new custom ids by position", () => {
    const state = addCustomStage(renameStage(fresh(), "s", " Filtro  inicial "), " Técnica ");
    const fetched: EditorPipeline = {
      ...pipeline(), version: "1",
      stages: state.stages.map(({ id, kind, name }) => ({ id: id ?? "server-custom", kind, name: normalizeStageName(name) })),
    };
    expect(reconcileUncertainSave(state, fetched)).toBe("saved");
    expect(reconcileUncertainSave(state, pipeline())).toBe("not_saved");
    expect(reconcileUncertainSave(state, { ...pipeline(), version: "2" })).toBe("conflict");
    expect(reconcileUncertainSave(state, { ...fetched, stages: [...fetched.stages].reverse() })).toBe("conflict");
    expect(reconcileUncertainSave(state, { ...fetched, stages: fetched.stages.map(stage => stage.id === "s" ? { ...stage, id: "other" } : stage) })).toBe("conflict");
    expect(reconcileUncertainSave(state, { ...fetched, stages: fetched.stages.map(stage => stage.kind === "custom" ? { ...stage, kind: "screening" } : stage) })).toBe("conflict");
    expect(reconcileUncertainSave(state, { ...fetched, exit: { ...fetched.exit, name: "Otro" } })).toBe("conflict");
    expect(reconcileUncertainSave(state, { ...fetched, exit: { ...fetched.exit, id: "other" } })).toBe("conflict");
  });
  it("recognizes saved before checking the version, including a no-op", () => {
    expect(reconcileUncertainSave(fresh(), pipeline())).toBe("saved");
  });
});

describe("save lifecycle (S5)", () => {
  it("compares normalized PUT payloads, not raw names or casefold keys", () => {
    const state = fresh();
    expect(isEditorDirty(state)).toBe(false);
    let renamed = renameStage(state, "n", "Otro");
    expect(isEditorDirty(renamed)).toBe(true);
    renamed = renameStage(renamed, "n", " \tNuevos\u00a0");
    expect(isEditorDirty(renamed)).toBe(false);
    expect(isEditorDirty(renameStage(state, "n", "NUEVOS"))).toBe(true);
    expect(isEditorDirty(moveStage(state, "s", "down"))).toBe(true);
    const added = addCustomStage(state, "Extra");
    expect(isEditorDirty(added)).toBe(true);
    expect(isEditorDirty(removeCustomStage(added, added.stages[4].key))).toBe(false);
    const savedCustom = pipeline();
    savedCustom.stages.splice(4, 0, { id: "c", kind: "custom", name: "Extra" });
    expect(isEditorDirty(removeCustomStage(editorFromPipeline(savedCustom), "c"))).toBe(true);
  });

  it("emits exactly the wire PUT shape: normalized names, no kind, new id absent entirely", () => {
    const state = addCustomStage(renameStage(fresh(), "e", " \tSalida  final "), " Te\u0301cnica\u00a0 final ");
    const body = toPutBody(state);
    expect(body).toEqual({
      stages: [
        { id: "n", name: "Nuevos" }, { id: "s", name: "Screening" },
        { id: "o", name: "Screening OK" }, { id: "i", name: "En proceso" },
        { name: "Técnica final" }, { id: "p", name: "Placement" },
      ],
      exit: { id: "e", name: "Salida final" },
    });
    expect(Object.keys(body.stages[4])).toEqual(["name"]);
    expect(JSON.stringify(body)).not.toContain('"kind"');
    expect(JSON.parse(JSON.stringify(body))).toEqual(body);
  });

  it("adopts server ids/version/limits while retaining request-order local keys and a clean baseline", () => {
    let state = addCustomStage(fresh(), "Técnica");
    state = moveStage(state, state.stages[4].key, "up");
    const keys = state.stages.map(({ key }) => key);
    const response: EditorPipeline = {
      version: "1",
      structure_locked: false,
      stages: state.stages.map(({ id, kind, name }) => ({ id: id ?? "server-custom", kind, name })),
      exit: { id: "e", kind: "discarded", name: "Descartados" },
      limits: { maxCustomStages: 2, nameMaxLength: 10 },
    };
    const saved = adoptSavedPipeline(state, response);
    expect(saved.stages.map(({ key }) => key)).toEqual(keys);
    expect(saved.exit.key).toBe(state.exit.key);
    expect(saved.stages.find(({ kind }) => kind === "custom")?.id).toBe("server-custom");
    expect(saved.baseline.version).toBe("1");
    expect(saved.limits).toEqual(response.limits);
    expect(isEditorDirty(saved)).toBe(false);
    expect(criticalRenames(saved)).toEqual([]);
    expect(toPutBody(saved).stages[3]).toEqual({ id: "server-custom", name: "Técnica" });
    expect(state.stages[3].id).toBeNull();
    expect(addCustomStage(saved).stages[5].key).not.toBe(saved.stages[3].key);
  });

  it("reports only actual normalized critical renames, not whitespace or non-critical names", () => {
    let state = renameStage(fresh(), "i", " \tEn  proceso\u00a0");
    state = renameStage(state, "s", "Filtro");
    state = addCustomStage(state, "Extra");
    expect(criticalRenames(state)).toEqual([]);
    state = renameStage(state, "i", "Entrevista");
    state = renameStage(state, "p", "Contratado");
    state = renameStage(state, "e", "Fuera");
    expect(criticalRenames(state)).toEqual([
      { key: "i", kind: "in_process", previousName: "En proceso", nextName: "Entrevista" },
      { key: "p", kind: "placement", previousName: "Placement", nextName: "Contratado" },
      { key: "e", kind: "discarded", previousName: "Descartados", nextName: "Fuera" },
    ]);
  });
});
