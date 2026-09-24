import * as React from "react";
import Link from "next/link";

// Branded not-found for the company careers route: an unknown company id never
// renders a profile, it renders this one-heading document with a single
// truthful path back to the public vacancy board.
export default function CompanyCareersNotFound() {
  return (
    <section className="flex flex-col items-start gap-3 py-6">
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
        No encontramos esta empresa
      </h1>
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        Todavía no tenemos un perfil para esta empresa.
        Puedes revisar las vacantes publicadas en PeopleFlow.
      </p>
      <Link
        href="/vacantes"
        className="rounded-md text-sm font-medium text-primary underline-offset-4 transition-colors hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Ver vacantes publicadas
      </Link>
    </section>
  );
}
