import * as React from "react";
import { PublicShell } from "../../components/shells/PublicShell";

export default function MarketingPage() {
  return (
    <PublicShell>
      <section className="py-12 sm:py-16">
        <h1 className="font-heading text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Explora las vacantes de PeopleFlow
        </h1>
        <p className="mt-4 max-w-prose text-lg text-muted-foreground">
          Encuentra oportunidades actuales y entra a la lista de vacantes cuando
          quieras.
        </p>
      </section>
    </PublicShell>
  );
}
