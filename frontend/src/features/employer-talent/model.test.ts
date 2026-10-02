import { describe, expect, it } from "vitest";

import {
  DEFAULT_TALENT_COLUMN_PINNING,
  TALENT_AVAILABILITIES,
  TALENT_COLUMN_IDS,
  TALENT_COLUMN_LABELS,
  TALENT_COLUMN_DEFAULT_VISIBILITY,
  TALENT_EMPLOYER_VACANCY_IDS,
  TALENT_EXPERIENCE_BUCKETS,
  TALENT_INDUSTRIES,
  TALENT_LANGUAGE_LEVELS,
  TALENT_LOCATIONS,
  TALENT_MODALITIES,
  TALENT_SKILLS,
  TALENT_SOURCES,
  TALENT_STAGES,
  applicationsByMostRecent,
  applyExperienceBucket,
  computeTalentTotals,
  countActiveTalentFilters,
  createEmptyTalentFilters,
  describeTalentFilters,
  experienceBucketValue,
  filterTalentPeople,
  formatTalentApplicationsCount,
  formatTalentDate,
  hasApplicationLevelFilters,
  moveIdToEdge,
  moveIdToIndex,
  moveIdWithin,
  normalizeSearchText,
  regionOfTalentColumn,
  removeTalentFilter,
  talentApplicationMatches,
  talentFullNameInitials,
  talentLastApplicationAt,
  talentPersonMatchesFilters,
  talentPersonSchema,
  type TalentFilters,
  type TalentPerson,
} from "./model";

/** Minimal valid person the schema accepts; overridden per case. */
const basePersonInput = {
  id: "persona-base",
  fullName: "Persona Base",
  professionalTitle: "Desarrolladora Frontend",
  email: "persona-base@ejemplo.mx",
  phone: "+52 55 1000 2000",
  location: "Guadalajara",
  industry: "Tecnología",
  currentCompany: "Estudio Base",
  yearsOfExperience: 5,
  skills: ["React"],
  education: "Licenciatura en Ingeniería en Software",
  languages: [{ name: "Español", level: "native" }],
  preferredModality: "remote",
  availability: "immediate",
  applications: [
    {
      id: "persona-base-postulacion-1",
      vacancyId: "frontend-engineer-react",
      stage: "submitted",
      source: "direct",
      appliedAt: "2026-03-01T00:00:00Z",
    },
  ],
};

function person(overrides: Partial<typeof basePersonInput> = {}): TalentPerson {
  return talentPersonSchema.parse({ ...basePersonInput, ...overrides });
}

/** Two separate applications to two vacancies — the "same application" case. */
const dualApplicant = person({
  id: "persona-dual",
  fullName: "Persona Dual",
  applications: [
    {
      id: "persona-dual-postulacion-1",
      vacancyId: "frontend-engineer-react",
      stage: "submitted",
      source: "direct",
      appliedAt: "2026-03-01T00:00:00Z",
    },
    {
      id: "persona-dual-postulacion-2",
      vacancyId: "backend-developer-senior",
      stage: "hired",
      source: "referral",
      appliedAt: "2026-03-05T00:00:00Z",
    },
  ],
});

function filters(overrides: Partial<TalentFilters> = {}): TalentFilters {
  return { ...createEmptyTalentFilters(), ...overrides };
}

describe("employer talent vocabularies", () => {
  it("reuses the employer vacancy ids and closed application stages", () => {
    expect(TALENT_STAGES).toEqual([
      "submitted",
      "in_review",
      "hired",
      "rejected",
    ]);
    expect(TALENT_SOURCES).toEqual([
      "direct",
      "referral",
      "linkedin",
      "job_board",
      "other",
    ]);
    expect(TALENT_EMPLOYER_VACANCY_IDS).toHaveLength(6);
    expect(TALENT_EMPLOYER_VACANCY_IDS).toContain("backend-developer-senior");
  });

  it("declares every facet vocabulary once, without duplicates", () => {
    for (const list of [
      TALENT_INDUSTRIES,
      TALENT_LOCATIONS,
      TALENT_SKILLS,
      TALENT_MODALITIES,
      TALENT_AVAILABILITIES,
      TALENT_LANGUAGE_LEVELS,
    ]) {
      expect(new Set(list).size).toBe(list.length);
    }
    expect(TALENT_SKILLS.length).toBeGreaterThanOrEqual(20);
    expect(TALENT_LOCATIONS.length).toBeGreaterThanOrEqual(6);
  });

  it("describes experience buckets as disjoint ranges", () => {
    const ranges = TALENT_EXPERIENCE_BUCKETS.map((bucket) => [
      bucket.min,
      bucket.max,
    ]);
    for (let index = 1; index < ranges.length; index += 1) {
      expect(ranges[index][0]).toBeGreaterThan(ranges[index - 1][1]);
    }
  });
});

describe("employer talent person schema", () => {
  it("accepts a coherent person with several applications", () => {
    expect(talentPersonSchema.safeParse(basePersonInput).success).toBe(true);
    expect(dualApplicant.applications).toHaveLength(2);
  });

  it("rejects a fabricated person-level status or match score", () => {
    for (const extra of [
      { status: "hired" },
      { matchScore: 92 },
      { stage: "hired" },
      { score: 0.8 },
    ]) {
      expect(
        talentPersonSchema.safeParse({ ...basePersonInput, ...extra }).success,
        `${Object.keys(extra)[0]} must not be a person field`,
      ).toBe(false);
    }
  });

  it("rejects duplicate application ids, empty histories and bad timestamps", () => {
    const shared = basePersonInput.applications[0];
    expect(
      talentPersonSchema.safeParse({
        ...basePersonInput,
        applications: [shared, shared],
      }).success,
    ).toBe(false);
    expect(
      talentPersonSchema.safeParse({ ...basePersonInput, applications: [] })
        .success,
    ).toBe(false);
    expect(
      talentPersonSchema.safeParse({
        ...basePersonInput,
        applications: [{ ...shared, appliedAt: "2026-03-01" }],
      }).success,
    ).toBe(false);
  });
});

describe("employer talent filters", () => {
  it("builds an empty filter set with no accidental matches", () => {
    const empty = createEmptyTalentFilters();
    expect(empty.query).toBe("");
    expect(empty.positions).toEqual([]);
    expect(empty.stages).toEqual([]);
    expect(empty.skills).toEqual([]);
    expect(empty.experienceMin).toBeUndefined();
    expect(filterTalentPeople([dualApplicant], empty)).toEqual([dualApplicant]);
    expect(countActiveTalentFilters(empty)).toBe(0);
  });

  it("ORs values inside a facet", () => {
    const personWith = person({
      id: "persona-go",
      skills: ["Go"],
      industry: "Fintech",
      location: "CDMX",
    });
    const personOther = person({ id: "persona-otra", skills: ["Figma"], industry: "Salud", location: "Mérida" });

    const bySkills = filterTalentPeople(
      [personWith, personOther],
      filters({ skills: ["React", "Go"] }),
    );
    expect(bySkills.map((item) => item.id)).toEqual(["persona-go"]);

    const byIndustry = filterTalentPeople(
      [personWith, personOther],
      filters({ industries: ["Fintech", "Salud"] }),
    );
    expect(byIndustry.map((item) => item.id)).toEqual([
      "persona-go",
      "persona-otra",
    ]);
  });

  it("ANDs across facets", () => {
    const mexicana = person({
      id: "persona-mx",
      industry: "Fintech",
      location: "CDMX",
      preferredModality: "remote",
    });
    const remota = person({
      id: "persona-remota",
      industry: "Salud",
      location: "CDMX",
      preferredModality: "remote",
    });
    const onsite = person({
      id: "persona-onsite",
      industry: "Fintech",
      location: "CDMX",
      preferredModality: "onsite",
    });

    const result = filterTalentPeople(
      [mexicana, remota, onsite],
      filters({ industries: ["Fintech"], locations: ["CDMX"], modalities: ["remote"] }),
    );
    expect(result.map((item) => item.id)).toEqual(["persona-mx"]);
  });

  it("matches a free-text query diacritic-insensitively across fields", () => {
    expect(normalizeSearchText("  MÉRIDA  ")).toBe("merida");
    const target = person({
      id: "persona-jose",
      fullName: "José Ángel Pérez",
      professionalTitle: "Ingeniero Backend",
      skills: ["GraphQL"],
    });
    const other = person({ id: "persona-other", fullName: "Ana López" });

    for (const query of ["JOSE", "josé", "backend", "graphql", "PEREZ"]) {
      expect(
        filterTalentPeople([target, other], filters({ query })).map(
          (item) => item.id,
        ),
        `${query} query`,
      ).toEqual(["persona-jose"]);
    }
  });

  it("applies the experience range inclusively", () => {
    const junior = person({ id: "persona-junior", yearsOfExperience: 2 });
    const mid = person({ id: "persona-mid", yearsOfExperience: 5 });
    const senior = person({ id: "persona-senior", yearsOfExperience: 12 });

    expect(
      filterTalentPeople(
        [junior, mid, senior],
        filters({ experienceMin: 3, experienceMax: 9 }),
      ).map((item) => item.id),
    ).toEqual(["persona-mid"]);
  });

  it("requires application criteria to match the SAME application", () => {
    const combined = filters({
      positions: ["frontend-engineer-react"],
      stages: ["hired"],
    });
    // No single application is both to the frontend vacancy and hired.
    expect(talentPersonMatchesFilters(dualApplicant, combined)).toBe(false);
    expect(filterTalentPeople([dualApplicant], combined)).toEqual([]);

    // Each criterion on its own does match one of the two applications.
    expect(
      talentPersonMatchesFilters(
        dualApplicant,
        filters({ positions: ["backend-developer-senior"], stages: ["hired"] }),
      ),
    ).toBe(true);
    expect(
      talentPersonMatchesFilters(
        dualApplicant,
        filters({
          positions: ["frontend-engineer-react"],
          stages: ["submitted"],
        }),
      ),
    ).toBe(true);
  });

  it("ORs positions inside the application facet but keeps them application-scoped", () => {
    expect(
      talentPersonMatchesFilters(
        dualApplicant,
        filters({ positions: ["frontend-engineer-react", "devops-engineer"] }),
      ),
    ).toBe(true);
    expect(
      talentPersonMatchesFilters(
        dualApplicant,
        filters({ positions: ["devops-engineer"] }),
      ),
    ).toBe(false);
  });

  it("filters by application source and applied date range", () => {
    expect(
      talentPersonMatchesFilters(
        dualApplicant,
        filters({ sources: ["referral"] }),
      ),
    ).toBe(true);
    expect(
      talentPersonMatchesFilters(
        dualApplicant,
        filters({ sources: ["job_board"] }),
      ),
    ).toBe(false);

    const inWindow = filters({ appliedFrom: "2026-03-04", appliedTo: "2026-03-06" });
    expect(talentPersonMatchesFilters(dualApplicant, inWindow)).toBe(true);
    expect(
      talentPersonMatchesFilters(
        dualApplicant,
        filters({ appliedFrom: "2026-04-01" }),
      ),
    ).toBe(false);
    expect(
      talentPersonMatchesFilters(
        dualApplicant,
        filters({ appliedTo: "2026-02-01" }),
      ),
    ).toBe(false);
  });

  it("classifies application-level criteria correctly", () => {
    expect(hasApplicationLevelFilters(createEmptyTalentFilters())).toBe(false);
    expect(
      hasApplicationLevelFilters(filters({ industries: ["Tecnología"] })),
    ).toBe(false);
    for (const partial of [
      { positions: ["fullstack-developer"] },
      { stages: ["hired"] },
      { sources: ["linkedin"] },
      { appliedFrom: "2026-03-01" },
      { appliedTo: "2026-03-31" },
    ] as const) {
      expect(
        hasApplicationLevelFilters(filters(partial)),
        JSON.stringify(partial),
      ).toBe(true);
    }
  });

  it("exposes one application predicate reused by the person predicate", () => {
    const application = dualApplicant.applications[1];
    expect(
      talentApplicationMatches(application, filters({ stages: ["hired"] })),
    ).toBe(true);
    expect(
      talentApplicationMatches(application, filters({ positions: ["fullstack-developer"] })),
    ).toBe(false);
  });
});

describe("employer talent active filter chips", () => {
  const titles = {
    "frontend-engineer-react": "Frontend Engineer (React)",
    "backend-developer-senior": "Backend Developer (Senior)",
  };

  it("describes every active criterion in a stable order with stable keys", () => {
    const chips = describeTalentFilters(
      filters({
        query: "react",
        positions: ["frontend-engineer-react"],
        stages: ["hired"],
        sources: ["linkedin"],
        industries: ["Fintech"],
        locations: ["CDMX"],
        skills: ["React"],
        modalities: ["remote"],
        availability: ["immediate"],
        experienceMin: 6,
        experienceMax: 9,
        appliedFrom: "2026-03-01",
        appliedTo: "2026-03-31",
      }),
      titles,
    );

    expect(chips.map((chip) => chip.key)).toEqual([
      "query",
      "position:frontend-engineer-react",
      "stage:hired",
      "source:linkedin",
      "appliedFrom",
      "appliedTo",
      "industry:Fintech",
      "location:CDMX",
      "skill:React",
      "modality:remote",
      "availability:immediate",
      "experience:6-9",
    ]);
    expect(chips[0].label).toBe("Búsqueda: react");
    expect(chips[1].label).toBe("Puesto: Frontend Engineer (React)");
    expect(chips.find((chip) => chip.key === "stage:hired")?.label).toBe(
      "Etapa: Contratado",
    );
  });

  it("counts and removes individual criteria without touching the rest", () => {
    const active = filters({ skills: ["React", "Go"], locations: ["CDMX"] });
    expect(countActiveTalentFilters(active)).toBe(3);

    const withoutReact = removeTalentFilter(active, "skill:React");
    expect(withoutReact.skills).toEqual(["Go"]);
    expect(withoutReact.locations).toEqual(["CDMX"]);

    const withoutLocation = removeTalentFilter(active, "location:CDMX");
    expect(withoutLocation.locations).toEqual([]);
    expect(withoutLocation.skills).toEqual(["React", "Go"]);
  });

  it("removes query, ranges and single application criteria", () => {
    const active = filters({
      query: "golang",
      positions: ["devops-engineer"],
      stages: ["submitted"],
      appliedFrom: "2026-03-01",
      experienceMin: 3,
      experienceMax: 5,
    });

    const cleared = [
      "query",
      "position:devops-engineer",
      "stage:submitted",
      "appliedFrom",
      "experience:3-5",
    ].reduce((current, key) => removeTalentFilter(current, key), active);

    expect(cleared).toEqual(createEmptyTalentFilters());
  });

  it("maps experience buckets onto the range and back", () => {
    const applied = applyExperienceBucket(createEmptyTalentFilters(), "6-9");
    expect(applied.experienceMin).toBe(6);
    expect(applied.experienceMax).toBe(9);
    expect(experienceBucketValue(applied)).toBe("6-9");
    expect(
      experienceBucketValue(applyExperienceBucket(applied, undefined)),
    ).toBeUndefined();
  });
});

describe("employer talent column metadata and ordering", () => {
  it("ships progressive detail with hidden advanced columns by default", () => {
    expect(TALENT_COLUMN_IDS.length).toBeGreaterThanOrEqual(12);
    const visible = TALENT_COLUMN_IDS.filter(
      (id) => TALENT_COLUMN_DEFAULT_VISIBILITY[id],
    );
    const hidden = TALENT_COLUMN_IDS.filter(
      (id) => !TALENT_COLUMN_DEFAULT_VISIBILITY[id],
    );
    expect(visible.length).toBeGreaterThan(0);
    expect(hidden.length).toBeGreaterThanOrEqual(3);
    for (const id of TALENT_COLUMN_IDS) {
      expect(TALENT_COLUMN_LABELS[id], `${id} label`).toBeTruthy();
    }
  });

  it("pins the identity column to the start by default", () => {
    expect(DEFAULT_TALENT_COLUMN_PINNING.start).toEqual(["fullName"]);
    expect(DEFAULT_TALENT_COLUMN_PINNING.end).toEqual([]);
  });

  it("resolves a column's pinning region", () => {
    const pinning = { start: ["fullName", "location"], end: ["phone"] };
    expect(regionOfTalentColumn(pinning, "fullName")).toBe("start");
    expect(regionOfTalentColumn(pinning, "phone")).toBe("end");
    expect(regionOfTalentColumn(pinning, "skills")).toBe("center");
  });

  it("moves an id within its list and clamps at the edges", () => {
    expect(moveIdWithin(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveIdWithin(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveIdWithin(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveIdWithin(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
    expect(moveIdWithin(["a", "b", "c"], "z", 1)).toEqual(["a", "b", "c"]);
  });

  it("moves an id to an edge or an explicit index", () => {
    expect(moveIdToEdge(["a", "b", "c"], "b", "start")).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(moveIdToEdge(["a", "b", "c"], "b", "end")).toEqual(["a", "c", "b"]);
    expect(moveIdToIndex(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
    expect(moveIdToIndex(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
    expect(moveIdToIndex(["a", "b", "c"], "b", 1)).toEqual(["a", "b", "c"]);
  });
});

describe("employer talent formatting helpers", () => {
  it("derives initials from the first and last name", () => {
    expect(talentFullNameInitials("Gabriela Soto")).toBe("GS");
    expect(talentFullNameInitials("José Ángel Pérez")).toBe("JP");
    expect(talentFullNameInitials("Madonna")).toBe("M");
  });

  it("formats dates in Spanish pinned to UTC", () => {
    expect(formatTalentDate("2026-03-05T02:25:00Z")).toBe("5 mar 2026");
    expect(formatTalentDate("2026-03-05T02:25:00Z")).not.toBe("4 mar 2026");
  });

  it("orders applications by most recent first", () => {
    expect(
      applicationsByMostRecent(dualApplicant).map((item) => item.id),
    ).toEqual([
      "persona-dual-postulacion-2",
      "persona-dual-postulacion-1",
    ]);
    expect(talentLastApplicationAt(dualApplicant)).toBe(
      "2026-03-05T00:00:00Z",
    );
  });

  it("pluralizes the applications counter", () => {
    expect(formatTalentApplicationsCount(1)).toBe("1 postulación");
    expect(formatTalentApplicationsCount(3)).toBe("3 postulaciones");
  });
});

describe("employer talent global totals", () => {
  function application(id: string, vacancyId: string) {
    return {
      id,
      vacancyId,
      stage: "submitted" as const,
      source: "direct" as const,
      appliedAt: "2026-03-01T00:00:00Z",
    };
  }

  it("reports zero for an empty base", () => {
    expect(computeTalentTotals([])).toEqual({
      people: 0,
      applications: 0,
      immediate: 0,
      vacancies: 0,
    });
  });

  it("counts people, their applications and the immediately available people", () => {
    const immediate = person({ id: "persona-inmediata" });
    const later = person({
      id: "persona-despues",
      availability: "two_weeks",
      applications: [
        application("persona-despues-1", "data-analyst"),
        application("persona-despues-2", "devops-engineer"),
      ],
    });

    expect(computeTalentTotals([immediate, later])).toEqual({
      people: 2,
      applications: 3,
      immediate: 1,
      vacancies: 3,
    });
  });

  it("counts a vacancy repeated across people and applications exactly once", () => {
    const first = person({
      id: "persona-uno",
      applications: [application("persona-uno-1", "data-analyst")],
    });
    const second = person({
      id: "persona-dos",
      applications: [
        application("persona-dos-1", "data-analyst"),
        application("persona-dos-2", "frontend-engineer-react"),
      ],
    });

    expect(computeTalentTotals([first, second])).toEqual({
      people: 2,
      applications: 3,
      immediate: 2,
      vacancies: 2,
    });
  });

  it("counts an immediate person once even with several applications", () => {
    const totals = computeTalentTotals([dualApplicant]);
    expect(totals.immediate).toBe(1);
    expect(totals.applications).toBe(2);
    expect(totals.vacancies).toBe(2);
  });
});
