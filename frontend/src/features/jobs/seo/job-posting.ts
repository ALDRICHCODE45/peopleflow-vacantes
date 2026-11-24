import type { Metadata } from "next";
import { shareHeadline } from "../components/share-links";
import type { PublicJobDetail } from "../types";

type Vacancy = Extract<PublicJobDetail, { source: "vacancy" }>;

const EMPLOYMENT_TYPE = { full_time: "FULL_TIME", part_time: "PART_TIME" } as const;
// schema.org has no semi-monthly unit: the salary is left out rather than misreported.
const SALARY_UNIT = { hourly: "HOUR", weekly: "WEEK", monthly: "MONTH", yearly: "YEAR" } as const;

/** Characters of plain description a social card shows when the vacancy has no excerpt. */
const SOCIAL_DESCRIPTION_LIMIT = 160;

/** Only the amounts the vacancy states: `Number(null)` is `0`, which would publish a salary or a bound nobody offered. `null` when none is stated. */
function stated(amounts: Record<string, string | null>): Record<string, number> | null {
  const present = Object.entries(amounts).flatMap(([key, amount]) => amount === null ? [] : [[key, Number(amount)] as const]);
  return present.length ? Object.fromEntries(present) : null;
}

function baseSalary(job: Vacancy) {
  const pay = job.compensation;
  if (pay === null || pay.pay_period === "semimonthly") return null;
  const value = stated(pay.mode === "fixed" ? { value: pay.amount } : { minValue: pay.min, maxValue: pay.max });
  if (value === null) return null;
  return { "@type": "MonetaryAmount", currency: pay.currency, value: { "@type": "QuantitativeValue", ...value, unitText: SALARY_UNIT[pay.pay_period] } };
}

/**
 * schema.org JobPosting for a published vacancy; `null` for catalog (legacy) rows, which take no online applications.
 * Only what the public detail already shows is emitted: the salary only when it is public, the careers URL only when a site exists.
 */
export function jobPostingJsonLd(job: PublicJobDetail, { siteUrl, careersHref }: { siteUrl: string; careersHref: string | null }) {
  if (job.source !== "vacancy") return null;
  const remote = job.work_mode === "remote";
  const countries = job.remote_scope?.kind === "countries" ? job.remote_scope.countries : [];
  const address = job.location && {
    "@type": "PostalAddress", addressCountry: job.location.country.id,
    ...(job.location.state ? { addressRegion: job.location.state.name } : {}),
    ...(job.location.municipality ? { addressLocality: job.location.municipality.name } : {}),
    ...(job.location.postal_code ? { postalCode: job.location.postal_code } : {}),
  };
  const salary = baseSalary(job);
  return {
    "@context": "https://schema.org", "@type": "JobPosting",
    title: job.title, description: job.description_plain, datePosted: job.published_at.slice(0, 10),
    url: new URL(`/vacantes/${job.id}`, siteUrl).toString(),
    employmentType: EMPLOYMENT_TYPE[job.work_schedule],
    hiringOrganization: {
      "@type": "Organization", name: job.company.name,
      ...(job.company.logo_url ? { logo: job.company.logo_url } : {}),
      ...(careersHref ? { sameAs: new URL(careersHref, siteUrl).toString() } : {}),
    },
    ...(remote
      ? { jobLocationType: "TELECOMMUTE", ...(countries.length ? { applicantLocationRequirements: countries.map(country => ({ "@type": "Country", name: country.name })) } : {}) }
      : address ? { jobLocation: { "@type": "Place", address } } : {}),
    ...(salary ? { baseSalary: salary } : {}),
  };
}

/** Open Graph and Twitter cards: the headline (the same one the share links use) names the company, the logo is the only image (never invented). */
export function jobSocialMetadata(job: PublicJobDetail, url: string, description = job.excerpt ?? job.description_plain.slice(0, SOCIAL_DESCRIPTION_LIMIT)): Pick<Metadata, "openGraph" | "twitter"> {
  const title = shareHeadline({ title: job.title, company: job.company.name });
  const logo = job.company.logo_url;
  return {
    openGraph: { type: "website", title, description, url, siteName: "PeopleFlow", locale: "es_MX", ...(logo ? { images: [{ url: logo }] } : {}) },
    twitter: { card: "summary", title, description, ...(logo ? { images: [logo] } : {}) },
  };
}
