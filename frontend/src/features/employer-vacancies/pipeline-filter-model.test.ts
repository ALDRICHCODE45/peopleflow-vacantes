import { describe, expect, it } from "vitest";

import type { PipelineCandidate } from "./pipeline-model";
import {
  PIPELINE_EXPERIENCE_BUCKETS,
  applyExperienceBucket,
  countActivePipelineFilters,
  createEmptyPipelineFilters,
  describePipelineFilters,
  experienceBucketValue,
  filterPipelineCandidates,
  hasActivePipelineFilters,
  isReceivedRangeReversed,
  normalizePipelineSearchText,
  pipelineListEmptyCopy,
  pipelineNoResultsCopy,
  pipelineSkillOptions,
  pipelineSourceOptions,
  pipelineStatusOptions,
  removePipelineFilter,
  type PipelineFilters,
} from "./pipeline-filter-model";

/** One valid prototype candidate; every overridden field stays truthful. */
const candidate = (
  overrides: Partial<PipelineCandidate> & { readonly id: string },
): PipelineCandidate => ({
  vacancyId: "backend-developer-senior",
  fullName: "Nombre Apellido",
  professionalTitle: "Puesto Base",
  yearsOfExperience: 5,
  status: "submitted",
  source: "direct",
  receivedAt: "2026-03-10T09:15:00-06:00",
  lastActivityAt: "2026-03-10T09:15:00-06:00",
  owner: "Valeria Ortiz",
  skills: ["Node.js"],
  matchScore: 80,
  commentCount: 0,
  ...overrides,
});

const filters = (overrides: Partial<PipelineFilters> = {}): PipelineFilters => ({
  ...createEmptyPipelineFilters(),
  ...overrides,
});

const ids = (candidates: readonly PipelineCandidate[]) =>
  candidates.map((item) => item.id);

describe("pipeline filter model — empty state", () => {
  it("builds an empty filter set with no accidental matches", () => {
    const empty = createEmptyPipelineFilters();
    expect(empty).toEqual({
      query: "",
      statuses: [],
      sources: [],
      skills: [],
      receivedFrom: undefined,
      receivedTo: undefined,
      experienceMin: undefined,
      experienceMax: undefined,
    });
    const roster = [candidate({ id: "uno" }), candidate({ id: "dos" })];
    expect(filterPipelineCandidates(roster, empty)).toEqual(roster);
    expect(hasActivePipelineFilters(empty)).toBe(false);
    expect(countActivePipelineFilters(empty)).toBe(0);
    expect(describePipelineFilters(empty)).toEqual([]);
  });
});

describe("pipeline filter model — OR/AND composition", () => {
  const roster = [
    candidate({ id: "go-linkedin", status: "submitted", source: "linkedin", skills: ["Go"] }),
    candidate({ id: "react-referral", status: "in_review", source: "referral", skills: ["React"] }),
    candidate({ id: "go-direct", status: "hired", source: "direct", skills: ["Go", "SQL"] }),
  ];

  it("ORs values inside a status facet", () => {
    expect(ids(filterPipelineCandidates(roster, filters({ statuses: ["submitted", "hired"] })))).toEqual([
      "go-linkedin",
      "go-direct",
    ]);
  });

  it("ORs values inside a source facet", () => {
    expect(ids(filterPipelineCandidates(roster, filters({ sources: ["linkedin", "referral"] })))).toEqual([
      "go-linkedin",
      "react-referral",
    ]);
  });

  it("ORs values inside the skills facet and matches any candidate skill", () => {
    expect(ids(filterPipelineCandidates(roster, filters({ skills: ["React", "SQL"] })))).toEqual([
      "react-referral",
      "go-direct",
    ]);
  });

  it("ANDs independent facets", () => {
    expect(
      ids(filterPipelineCandidates(roster, filters({ statuses: ["hired"], sources: ["direct"], skills: ["Go"] }))),
    ).toEqual(["go-direct"]);
    expect(
      ids(filterPipelineCandidates(roster, filters({ statuses: ["hired"], sources: ["referral"] }))),
    ).toEqual([]);
  });
});

describe("pipeline filter model — search semantics", () => {
  const roster = [
    candidate({ id: "lucia", fullName: "Lucía Fernández", professionalTitle: "Backend Developer Senior", skills: ["PostgreSQL"] }),
    candidate({ id: "diego", fullName: "Diego Salazar", professionalTitle: "Ingeniero Backend", skills: ["Go"], status: "in_review" }),
  ];

  it("normalizes diacritics, case and surrounding whitespace", () => {
    expect(normalizePipelineSearchText("  MÉRIDA  ")).toBe("merida");
  });

  it("matches name, title and skill substrings diacritic- and case-insensitively", () => {
    expect(ids(filterPipelineCandidates(roster, filters({ query: "lucia" })))).toEqual(["lucia"]);
    expect(ids(filterPipelineCandidates(roster, filters({ query: "LUCÍA" })))).toEqual(["lucia"]);
    expect(ids(filterPipelineCandidates(roster, filters({ query: "backend" })))).toEqual(["lucia", "diego"]);
    expect(ids(filterPipelineCandidates(roster, filters({ query: "POSTGRES" })))).toEqual(["lucia"]);
    expect(ids(filterPipelineCandidates(roster, filters({ query: "arquitecta" })))).toEqual([]);
  });

  it("composes the search with facets using AND", () => {
    expect(
      ids(filterPipelineCandidates(roster, filters({ query: "backend", statuses: ["submitted"] }))),
    ).toEqual(["lucia"]);
  });
});

describe("pipeline filter model — experience buckets", () => {
  it("exposes the four ordered buckets with the last one open-ended", () => {
    expect(PIPELINE_EXPERIENCE_BUCKETS.map((bucket) => bucket.value)).toEqual(["0-2", "3-5", "6-9", "10+"]);
    expect(PIPELINE_EXPERIENCE_BUCKETS.at(-1)).toMatchObject({ min: 10, max: undefined });
  });

  it("applies a bucket inclusively", () => {
    const roster = [
      candidate({ id: "junior", yearsOfExperience: 2 }),
      candidate({ id: "mid", yearsOfExperience: 5 }),
      candidate({ id: "senior", yearsOfExperience: 9 }),
    ];
    const applied = applyExperienceBucket(createEmptyPipelineFilters(), "3-5");
    expect(ids(filterPipelineCandidates(roster, applied))).toEqual(["mid"]);
  });

  it("keeps 10+ as a lower bound only, so no upper ceiling drops a senior", () => {
    // `PipelineCandidate` types `yearsOfExperience` as `number`, so a value above
    // the shared validator ceiling of 60 is structurally valid here: the frozen
    // schema is not broadened, the model simply must not cap what it is handed.
    const roster = [
      candidate({ id: "nine", yearsOfExperience: 9 }),
      candidate({ id: "ten", yearsOfExperience: 10 }),
      candidate({ id: "sixty", yearsOfExperience: 60 }),
      candidate({ id: "beyond-ceiling", yearsOfExperience: 72 }),
    ];
    const applied = applyExperienceBucket(createEmptyPipelineFilters(), "10+");
    expect(applied.experienceMin).toBe(10);
    expect(applied.experienceMax).toBeUndefined();
    expect(experienceBucketValue(applied)).toBe("10+");
    expect(ids(filterPipelineCandidates(roster, applied))).toEqual([
      "ten",
      "sixty",
      "beyond-ceiling",
    ]);
    // A closed upper bucket still rejects the same out-of-range candidate.
    const closed = applyExperienceBucket(createEmptyPipelineFilters(), "6-9");
    expect(closed.experienceMax).toBe(9);
    expect(ids(filterPipelineCandidates(roster, closed))).toEqual(["nine"]);
  });

  it("round-trips a bucket through the bounds and clears it", () => {
    const applied = applyExperienceBucket(createEmptyPipelineFilters(), "6-9");
    expect(applied.experienceMin).toBe(6);
    expect(applied.experienceMax).toBe(9);
    expect(experienceBucketValue(applied)).toBe("6-9");
    expect(experienceBucketValue(applyExperienceBucket(applied, undefined))).toBeUndefined();
  });
});

describe("pipeline filter model — received date range", () => {
  // Offset-aware timestamps: slice(0, 10) keeps the supplied civil day.
  const roster = [
    candidate({ id: "antes", receivedAt: "2026-03-01T23:30:00-06:00" }),
    candidate({ id: "borde-desde", receivedAt: "2026-03-10T00:05:00-06:00" }),
    candidate({ id: "medio", receivedAt: "2026-03-12T14:00:00-06:00" }),
    candidate({ id: "borde-hasta", receivedAt: "2026-03-15T22:00:00-06:00" }),
    candidate({ id: "despues", receivedAt: "2026-03-20T08:00:00-06:00" }),
  ];

  it("filters both bounds inclusively on the supplied local civil day", () => {
    expect(
      ids(filterPipelineCandidates(roster, filters({ receivedFrom: "2026-03-10", receivedTo: "2026-03-15" }))),
    ).toEqual(["borde-desde", "medio", "borde-hasta"]);
  });

  it("keeps a single bound open on the missing side", () => {
    expect(ids(filterPipelineCandidates(roster, filters({ receivedFrom: "2026-03-12" })))).toEqual([
      "medio",
      "borde-hasta",
      "despues",
    ]);
    expect(ids(filterPipelineCandidates(roster, filters({ receivedTo: "2026-03-10" })))).toEqual([
      "antes",
      "borde-desde",
    ]);
  });

  it("flags reversed bounds without silently swapping them", () => {
    const reversed = filters({ receivedFrom: "2026-03-15", receivedTo: "2026-03-10" });
    expect(isReceivedRangeReversed(reversed)).toBe(true);
    expect(isReceivedRangeReversed(filters({ receivedFrom: "2026-03-10", receivedTo: "2026-03-15" }))).toBe(false);
    expect(isReceivedRangeReversed(filters({ receivedFrom: "2026-03-15" }))).toBe(false);
    const snapshot = structuredClone(reversed);
    expect(filterPipelineCandidates(roster, reversed)).toEqual([]);
    expect(reversed).toEqual(snapshot);
  });
});

describe("pipeline filter model — chips and removal", () => {
  const active = filters({
    query: "lucia",
    statuses: ["submitted", "hired"],
    sources: ["linkedin"],
    skills: ["Node.js"],
    receivedFrom: "2026-03-01",
    receivedTo: "2026-03-31",
    experienceMin: 3,
    experienceMax: 5,
  });

  it("describes one chip per active value and bound in a stable order", () => {
    expect(describePipelineFilters(active)).toEqual([
      { key: "query", label: "Búsqueda: lucia" },
      { key: "status:submitted", label: "Etapa: Nuevos" },
      { key: "status:hired", label: "Etapa: Contratados" },
      { key: "source:linkedin", label: "Origen: LinkedIn" },
      { key: "receivedFrom", label: "Recibidos desde: 2026-03-01" },
      { key: "receivedTo", label: "Recibidos hasta: 2026-03-31" },
      { key: "skill:Node.js", label: "Habilidad: Node.js" },
      { key: "experience:3-5", label: "Experiencia: 3 a 5 años" },
    ]);
    expect(countActivePipelineFilters(active)).toBe(8);
  });

  it("removes exactly one value and preserves every other criterion", () => {
    const withoutOne = removePipelineFilter(active, "status:submitted");
    expect(withoutOne.statuses).toEqual(["hired"]);
    expect(withoutOne.sources).toEqual(["linkedin"]);
    expect(withoutOne.skills).toEqual(["Node.js"]);
    expect(withoutOne.receivedFrom).toBe("2026-03-01");
    expect(withoutOne.receivedTo).toBe("2026-03-31");
    expect(withoutOne.experienceMin).toBe(3);
    expect(withoutOne.experienceMax).toBe(5);

    expect(removePipelineFilter(active, "query").query).toBe("");
    expect(removePipelineFilter(active, "receivedFrom").receivedFrom).toBeUndefined();
    expect(removePipelineFilter(active, "receivedTo").receivedTo).toBeUndefined();
    const noExperience = removePipelineFilter(active, "experience:3-5");
    expect(noExperience.experienceMin).toBeUndefined();
    expect(noExperience.experienceMax).toBeUndefined();
    expect(removePipelineFilter(active, "skill:Node.js").skills).toEqual([]);
  });

  it("matches a chip label back to its own value even when values contain dots", () => {
    const withDotted = filters({ skills: ["Node.js", "Next.js"] });
    const next = removePipelineFilter(withDotted, "skill:Node.js");
    expect(next.skills).toEqual(["Next.js"]);
  });
});

describe("pipeline filter model — stable options", () => {
  const roster = [
    candidate({ id: "uno", status: "submitted", source: "linkedin", skills: ["Node.js", "SQL"] }),
    candidate({ id: "dos", status: "hired", source: "direct", skills: ["SQL"] }),
  ];

  it("derives status and source options from the unfiltered input in canonical order", () => {
    expect(pipelineStatusOptions(roster)).toEqual([
      { value: "submitted", label: "Nuevos" },
      { value: "hired", label: "Contratados" },
    ]);
    expect(pipelineSourceOptions(roster)).toEqual([
      { value: "direct", label: "Directo" },
      { value: "linkedin", label: "LinkedIn" },
    ]);
  });

  it("derives distinct sorted skill options from the unfiltered input", () => {
    expect(pipelineSkillOptions(roster)).toEqual([
      { value: "Node.js", label: "Node.js" },
      { value: "SQL", label: "SQL" },
    ]);
  });

  it("reads only the passed input, so options never shrink with active filters", () => {
    const full = pipelineStatusOptions(roster);
    const filteredRoster = filterPipelineCandidates(roster, filters({ statuses: ["hired"] }));
    expect(ids(filteredRoster)).toEqual(["dos"]);
    expect(pipelineStatusOptions(roster)).toEqual(full);
  });
});

describe("pipeline filter model — empty copy", () => {
  it("distinguishes input-empty from filtered-zero for the list", () => {
    expect(pipelineListEmptyCopy(createEmptyPipelineFilters())).toBe("Sin candidatos en esta vacante.");
    expect(pipelineListEmptyCopy(filters({ query: "zzz" }))).toBe("Sin candidatos que coincidan con la búsqueda.");
    expect(pipelineListEmptyCopy(filters({ statuses: ["hired"] }))).toBe("Sin candidatos que coincidan con los filtros.");
  });

  it("names the query in the recovery copy and the filters otherwise", () => {
    expect(pipelineNoResultsCopy(filters({ query: "  zzz  " }))).toBe("No hay candidatos que coincidan con la búsqueda «zzz».");
    expect(pipelineNoResultsCopy(filters({ sources: ["linkedin"] }))).toBe("No hay candidatos que coincidan con los filtros aplicados.");
  });
});
