"use client";

import * as React from "react";

import { TalentDetailSheet } from "./talent-detail-sheet";
import { TalentFilterBar } from "./talent-filters";
import { TalentSummary } from "./talent-summary";
import { TalentTable } from "./talent-table";
import {
  createEmptyTalentFilters,
  filterTalentPeople,
  type TalentPerson,
} from "./model";

/**
 * Local orchestrator of the employer talent base.
 *
 * It owns the filter state, the filtered projection and the selected person.
 * The detail sheet is mounted once, outside the table, and the selected person
 * is always resolved from the full person set, so filtering never closes or
 * rewrites the open detail. Everything is React state and nothing is fetched,
 * stored or persisted.
 */
export type TalentWorkspaceProps = {
  people: readonly TalentPerson[];
  vacancyTitleById: Readonly<Record<string, string>>;
  pageSize?: number;
};

export function TalentWorkspace({
  people,
  vacancyTitleById,
  pageSize = 10,
}: TalentWorkspaceProps) {
  const [filters, setFilters] = React.useState(createEmptyTalentFilters);
  const [selectedPersonId, setSelectedPersonId] = React.useState<string | null>(
    null,
  );

  const filteredPeople = React.useMemo(
    () => filterTalentPeople(people, filters),
    [people, filters],
  );

  const selectedPerson = React.useMemo(
    () => people.find((person) => person.id === selectedPersonId) ?? null,
    [people, selectedPersonId],
  );

  const clearFilters = React.useCallback(() => {
    setFilters(createEmptyTalentFilters());
    setSelectedPersonId(null);
  }, []);

  return (
    <div data-pf-talento-workspace="" className="flex flex-col gap-4">
      {/* Global counters read the complete `people` set on purpose: filtering,
          empty results, reset and pagination only narrow the table. */}
      <TalentSummary people={people} />
      <TalentFilterBar
        filters={filters}
        onChange={setFilters}
        vacancyTitleById={vacancyTitleById}
      />
      <TalentTable
        people={filteredPeople}
        onSelectPerson={setSelectedPersonId}
        selectedPersonId={selectedPersonId}
        pageSize={pageSize}
        onClearFilters={clearFilters}
      />
      <TalentDetailSheet
        person={selectedPerson}
        vacancyTitleById={vacancyTitleById}
        open={selectedPerson !== null}
        onOpenChange={(next) => {
          if (!next) setSelectedPersonId(null);
        }}
      />
    </div>
  );
}
