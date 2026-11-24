import type { Metadata } from "next";
import type { PublicJobDetail } from "../types";

type Vacancy = Extract<PublicJobDetail, { source: "vacancy" }>;

const EMPLOYMENT_TYPE = { full_time: "FULL_TIME", part_time: "PART_TIME" } as const;
// schema.org has no semi-monthly unit: the salary is left out rather than misreported.
const SALARY_UNIT = { hourly: "HOUR", weekly: "WEEK", monthly: "MONTH", yearly: "YEAR" } as const;

function baseSalary(job: Vacancy) {
  const pay = job.compensation;
  if (pay === null || pay.pay_period === "semimonthly") return null;
  const value = pay.mode === "fixed" ? { value: Number(pay.amount) } : { minValue: Number(pay.min), maxValue: Number(pay.max) };
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

/** Open Graph and Twitter cards: the headline names the company, the logo is the only image (never invented). */
export function jobSocialMetadata(job: PublicJobDetail, url: string, description = job.excerpt ?? job.description_plain.slice(0, 160)): Pick<Metadata, "openGraph" | "twitter"> {
  const title = `${job.title} · ${job.company.name}`;
  const logo = job.company.logo_url;
  return {
    openGraph: { type: "website", title, description, url, siteName: "PeopleFlow", locale: "es_MX", ...(logo ? { images: [{ url: logo }] } : {}) },
    twitter: { card: "summary", title, description, ...(logo ? { images: [logo] } : {}) },
  };
}
