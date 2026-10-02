"use client";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { computeTalentTotals, type TalentPerson } from "./model";

/**
 * Global counters of the talent base.
 *
 * It always receives the complete person set, never the filtered projection, so
 * the four cards keep answering "how big is my base" while the table narrows to
 * the active criteria. Counts only: no trend, growth or comparison the fixture
 * cannot prove.
 */

export type TalentSummaryProps = {
  readonly people: readonly TalentPerson[];
};

type StatId = "people" | "applications" | "immediate" | "vacancies";

export function TalentSummary({ people }: TalentSummaryProps) {
  const totals = computeTalentTotals(people);
  const stats: readonly { readonly id: StatId; readonly label: string; readonly value: number }[] = [
    { id: "people", label: "Personas en la base", value: totals.people },
    { id: "applications", label: "Postulaciones", value: totals.applications },
    {
      id: "immediate",
      label: "Disponibilidad inmediata",
      value: totals.immediate,
    },
    {
      id: "vacancies",
      label: "Vacantes representadas",
      value: totals.vacancies,
    },
  ];

  return (
    <section
      data-pf-talento-summary=""
      aria-label="Totales de la base de talento completa"
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
    >
      {stats.map((stat) => (
        <Card key={stat.id} data-pf-talento-stat={stat.id} className="@container/card">
          <CardHeader>
            <CardDescription>{stat.label}</CardDescription>
            <CardTitle
              data-pf-talento-stat-value={stat.id}
              className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl"
            >
              {stat.value}
            </CardTitle>
          </CardHeader>
        </Card>
      ))}
    </section>
  );
}
