import * as React from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CompanyCareersView } from "../../../../features/company-profile/company-careers-view";
import { siteContentFromProfile } from "../../../../features/company-profile/company-site-content";
import { findCompanyProfile } from "../../../../features/company-profile/model";
import { PROTOTYPE_COMPANY_PROFILES } from "../../../../features/company-profile/prototype-companies";
import { ACME_PROTOTYPE_JOBS } from "../../../../features/jobs/prototype-jobs";

// The profile lookup is local and per-request, and metadata reads the validated
// site origin, so the route is rendered on demand and never cached under an id.
export const dynamic = "force-dynamic";

type EmpresaPageProps = {
  params: Promise<{ companyId: string }>;
};

/**
 * The one prototype profile a route reference resolves to, by exact id or exact
 * source name; every other reference is unknown and renders not-found.
 */
function profileFor(companyId: string) {
  return findCompanyProfile(PROTOTYPE_COMPANY_PROFILES, { id: companyId, name: companyId });
}

export async function generateMetadata({ params }: EmpresaPageProps): Promise<Metadata> {
  const { companyId } = await params;
  const profile = profileFor(companyId);

  // Unknown companies render the framework not-found document, which Next
  // itself marks `noindex`; emitting robots metadata here would duplicate it.
  if (profile === undefined) {
    return {};
  }

  // Loaded lazily so route collection during offline builds never triggers the
  // eager environment validation.
  const { serverEnv } = await import("../../../../lib/env/server");
  return {
    title: `${profile.name} · Perfil de empresa`,
    description: profile.tagline,
    // A name reference is an alias, so both spellings advertise the canonical
    // company-id URL instead of competing as duplicate documents.
    alternates: {
      canonical: new URL(`/empresas/${profile.companyId}`, serverEnv.siteUrl).toString(),
    },
    robots: { index: true, follow: true },
  };
}

export default async function EmpresaPage({ params }: EmpresaPageProps) {
  const { companyId } = await params;
  const profile = profileFor(companyId);

  if (profile === undefined) {
    notFound();
  }

  // The vacancy list is a frozen local fixture read, not a request: only the
  // feature-local prototype-jobs module reaches the enrichment and the company
  // filter, so the route stays free of transport and client state. The approved
  // profile is mapped into the shared presentation contract, which the renderer
  // consumes without knowing which employer resolved it.
  return <CompanyCareersView content={siteContentFromProfile(profile)} jobs={ACME_PROTOTYPE_JOBS} />;
}
